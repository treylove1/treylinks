import './isolated-network-guard.mjs';
// Real SQL against an isolated synthetic fixture; storage/mail stay in memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createArrivalRepository,processArrival,reviewSavedArrival,customerContactVersion,packageReviewVersion} from '../backend/arrival-workflow.mjs';
const {PGlite}=await import(process.env.PGLITE_MODULE?pathToFileURL(process.env.PGLITE_MODULE):new URL('./sql-runtime/node_modules/@electric-sql/pglite/dist/index.js',import.meta.url));
const id=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';

const bytes=fs.readFileSync(new URL('../../parcel-snap-vision-test/fixtures/synthetic-label-unmarked.jpg',import.meta.url));
const photo='data:image/jpeg;base64,'+bytes.toString('base64');
test('saved origin review and metadata correction, isolated PostgreSQL',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(fs.readFileSync(new URL('./arrival-baseline-fixture.sql',import.meta.url),'utf8'));
 const queries=[];
 const sql={unsafe:async(q,p=[])=>{queries.push(q);return (await db.query(q,p)).rows;},begin:fn=>db.transaction(tx=>fn({unsafe:async(q,p=[])=>{queries.push(q);return (await tx.query(q,p)).rows;}}))};
 const repo=createArrivalRepository(sql);
 await t.test('workspace enrichment remains compatible before migration',async()=>assert.deepEqual(await repo.pendingOriginReviews(id(1),[id(100)]),[]));
 await db.exec(fs.readFileSync(new URL('../backend/schema-proposals/arrival-notices.sql',import.meta.url),'utf8'));
 await db.query('insert into parcel_snap.companies(id,name) values($1,$2)',[id(1),'Synthetic Company']);
 await db.query('insert into parcel_snap.customers(id,company_id,name,email) values($1,$2,$3,$4),($5,$2,$6,null)',[id(2),id(1),'Synthetic Recipient','recipient@example.test',id(22),'No Email Recipient']);
 await db.query("insert into parcel_snap.facilities(id,company_id,code,name,facility_type) values($1,$2,'O','Origin','ORIGIN'),($3,$2,'D','Destination','DESTINATION')",[id(3),id(1),id(4)]);
 await db.query("insert into parcel_snap.company_profiles(company_id,needs_customer_notifications,notification_channels) values($1,true,array['EMAIL'])",[id(1)]);
 const readContactVersion=async customerId=>customerContactVersion(id(1),(await db.query('select id,xmin::text as contact_revision from parcel_snap.customers where id=$1',[customerId])).rows[0]);
 let contactVersion=await readContactVersion(id(2)),correctedContactVersion=await readContactVersion(id(22));
 let seq=100;
 async function harness(){
  contactVersion=await readContactVersion(id(2));correctedContactVersion=await readContactVersion(id(22));
  const objects=new Map(),calls=[],effects={upload:0,download:0,secret:0},flags={private:true,operate:true,corrupt:false,missing:false,onDownload:null,status:200};
  const input={companyId:id(1),userId:id(6),role:'OWNER',kind:'origin',body:{intake_package_id:id(seq++),customer_id:id(2),origin_facility_id:id(3),destination_facility_id:id(4),tracking_number:'0012345678901234567890',photo_data_url:photo,label_confirmed:false,confirmed_customer_id:id(2),confirmed_customer_contact_version:contactVersion,carrier:'UPS',size_class:'SMALL',weight_lb:'2.50',payment_status:'UNPAID',ocr_name:'Synthetic Recipient',ocr_raw_text:'Fictional label',ocr_recipient_address:'123 Fictional Way'}};
  const deps={repo,canOperate:async()=>flags.operate,assertPrivateStorage:async()=>{if(!flags.private)throw Object.assign(Error('Private storage required'),{status:503});},secret:async()=>{effects.secret++;return 'synthetic-key';},storage:{upload:async(path,b)=>{effects.upload++;if(!objects.has(path))objects.set(path,Buffer.from(b));return {error:null};},download:async path=>{effects.download++;if(flags.onDownload)await flags.onDownload();return flags.missing?{error:Error('Missing')}:{data:new Blob([flags.corrupt?Buffer.from('bad'):objects.get(path)||''])};}},fetch:async(url,init)=>{calls.push({url,...init});return new Response(JSON.stringify({id:'synthetic-'+seq}),{status:flags.status});}};
  const reviewInput=()=>({companyId:input.companyId,userId:input.userId,role:input.role,body:{package_id:input.body.intake_package_id,origin_facility_id:input.body.origin_facility_id}});
  return {input,deps,flags,objects,calls,effects,reviewInput,run:()=>processArrival(input,deps),review:()=>reviewSavedArrival(reviewInput(),deps),package:async()=>(await db.query('select * from parcel_snap.packages where id=$1',[input.body.intake_package_id])).rows[0],notice:async()=>(await db.query('select * from parcel_snap.arrival_notices where package_id=$1',[input.body.intake_package_id])).rows[0]};
 }
 await t.test('same-fingerprint correction preserves every editable field before a single send',async()=>{
  const h=await harness();await h.run();const old=await h.notice();Object.assign(h.input.body,{ocr_recipient_address:'124 Corrected Way, Unit 009, Miami FL 33101',ocr_name:'Reviewed Name',ocr_raw_text:'Corrected label text',carrier:'FedEx',size_class:'MEDIUM',weight_lb:'4.25',payment_status:'PAID',label_confirmed:true});assert.equal((await h.run()).email.status,'SENT');const p=await h.package(),n=await h.notice();for(const k of ['ocr_recipient_address','ocr_name','ocr_raw_text','carrier','size_class','payment_status'])assert.equal(p[k],h.input.body[k]);assert.equal(Number(p.weight_lb),4.25);assert.equal(n.fingerprint,old.fingerprint);assert.equal(n.attempt_count,1);assert.equal(h.calls.length,1);
 });
 await t.test('fingerprint-changing correction retains omitted metadata and same package',async()=>{const h=await harness();await h.run();delete h.input.body.ocr_recipient_address;h.input.body.tracking_number='009999999999';await h.run();assert.equal((await h.package()).ocr_recipient_address,'123 Fictional Way');assert.equal((await h.package()).tracking_number,'009999999999');});
 for(const status of ['SENT','FAILED','UNKNOWN','SENDING'])await t.test(status+' blocks metadata edits without resetting fingerprint or claim',async()=>{const h=await harness();await h.run();await db.query('update parcel_snap.arrival_notices set status=$1,attempt_count=1 where package_id=$2',[status,h.input.body.intake_package_id]);const before=await h.notice();h.input.body.ocr_recipient_address='Altered after attempt';await assert.rejects(h.run,e=>e.status===409);assert.equal((await h.package()).ocr_recipient_address,'123 Fictional Way');assert.deepEqual(await h.notice(),before);assert.equal(h.calls.length,0);});
 await t.test('review restores verified bytes and snapshot with no writes, secret access or send',async()=>{const h=await harness();await h.run();const beforeP=await h.package(),beforeN=await h.notice(),uploads=h.effects.upload,q=queries.length;const r=await h.review();assert.equal(r.editable,true);assert.equal(r.snapshot.intake_package_id,h.input.body.intake_package_id);assert.equal(r.snapshot.photo_data_url,photo);assert.equal(r.snapshot.ocr_recipient_address,'123 Fictional Way');assert.deepEqual(r.snapshot.customer,{id:id(2),name:'Synthetic Recipient',email:'recipient@example.test',contact_version:contactVersion,contact_email_visible:true});assert.deepEqual(r.snapshot.destination_facility,{id:id(4),name:'Destination'});assert(!JSON.stringify(r).includes('photo_path'));assert.equal(r.snapshot.label_confirmed,undefined);assert(queries.slice(q).every(q=>q.startsWith('select ')));assert.deepEqual(await h.package(),beforeP);assert.deepEqual(await h.notice(),beforeN);assert.equal(h.effects.upload,uploads);assert.equal(h.effects.secret,0);assert.equal(h.calls.length,0);});
 await t.test('staff snapshot masks customer email, exposes opaque version and marks contact hidden; null-email draft can recover',async()=>{const h=await harness();await h.run();h.input.role='STAFF';const c=(await h.review()).snapshot.customer;assert.equal(c.email,null);assert.equal(c.contact_version,contactVersion);assert.equal(c.contact_email_visible,false);const n=await harness();n.input.body.customer_id=id(22);await n.run();assert.equal((await n.review()).snapshot.customer.email,null);});
 for(const scope of ['tenant','facility','permission','role'])await t.test('review rejects wrong '+scope+' before photo exposure',async()=>{const h=await harness();await h.run();const r=h.reviewInput(),downloads=h.effects.download;if(scope==='tenant')r.companyId=id(99);if(scope==='facility')r.body.origin_facility_id=id(4);if(scope==='permission')h.flags.operate=false;if(scope==='role')r.role='VIEWER';await assert.rejects(()=>reviewSavedArrival(r,h.deps),e=>[403,404].includes(e.status));assert.equal(h.effects.download,downloads);});
 for(const state of ['SENT','UNKNOWN','FAILED','SENDING','MOVED'])await t.test('review refuses '+state+' draft',async()=>{const h=await harness();await h.run();if(state==='MOVED')await db.query("update parcel_snap.packages set stage='IN_TRANSIT',current_facility_id=$2 where id=$1",[h.input.body.intake_package_id,id(4)]);else await db.query('update parcel_snap.arrival_notices set status=$1 where package_id=$2',[state,h.input.body.intake_package_id]);await assert.rejects(h.review,e=>e.status===409);assert.equal(h.calls.length,0);});
 for(const mode of ['private','corrupt','missing','ownership'])await t.test('review fails closed for '+mode+' photo condition',async()=>{const h=await harness();await h.run();if(mode==='private')h.flags.private=false;if(mode==='corrupt')h.flags.corrupt=true;if(mode==='missing')h.flags.missing=true;if(mode==='ownership')await db.query("update parcel_snap.package_photos set kind='OTHER' where package_id=$1",[h.input.body.intake_package_id]);await assert.rejects(h.review,e=>[409,503].includes(e.status));assert.equal(h.calls.length,0);});
 await t.test('claim or metadata change during download invalidates snapshot',async()=>{for(const change of ['claim','metadata']){const h=await harness();await h.run();h.flags.onDownload=async()=>{if(change==='claim')await db.query("update parcel_snap.arrival_notices set status='SENDING',attempt_count=1 where package_id=$1",[h.input.body.intake_package_id]);else await db.query("update parcel_snap.packages set ocr_recipient_address='Concurrent edit',updated_at=now() where id=$1",[h.input.body.intake_package_id]);};await assert.rejects(h.review,/changed during review/);}});
 await t.test('workspace marks only editable current-origin rows',async()=>{const h=await harness();await h.run();const ids=await repo.pendingOriginReviews(id(1),[h.input.body.intake_package_id]);assert.deepEqual(ids,[{package_id:h.input.body.intake_package_id,facility_id:id(3)}]);assert.deepEqual(await repo.pendingOriginReviews(id(99),[h.input.body.intake_package_id]),[]);h.input.body.label_confirmed=true;await h.run();assert.deepEqual(await repo.pendingOriginReviews(id(1),[h.input.body.intake_package_id]),[]);});
 await t.test('moved draft cannot be edited through direct receive retry',async()=>{const h=await harness();await h.run();await db.query("update parcel_snap.packages set stage='IN_TRANSIT' where id=$1",[h.input.body.intake_package_id]);h.input.body.ocr_recipient_address='Changed';await assert.rejects(h.run,/beyond origin review/);assert.equal((await h.package()).ocr_recipient_address,'123 Fictional Way');});
 await t.test('initial destination note persists and changed retry is explicit conflict',async()=>{const h=await harness();await h.run();const pid=h.input.body.intake_package_id;h.input.kind='destination';h.input.body={package_id:pid,facility_id:id(4),photo_data_url:photo,note:'Fragile: fictional test',label_confirmed:false};h.input.body.confirmed_package_review_version=await packageReviewVersion(id(1),(await db.query('select id,customer_id,tracking_number from parcel_snap.packages where id=$1',[h.input.body.package_id])).rows[0]);await h.run();const rows=(await db.query("select note from parcel_snap.package_events where package_id=$1 and event_type='DESTINATION_RECEIVED'",[pid])).rows;assert.equal(rows[0].note,h.input.body.note);h.input.body.note='Changed';await assert.rejects(h.run,/note is already saved/);assert.equal(h.calls.length,0);});
 await t.test('invalid metadata rejects before storage effects',async()=>{for(const fields of [{weight_lb:-1},{size_class:'INVALID'},{ocr_recipient_address:{}},{ocr_raw_text:'x'.repeat(20001)}]){const h=await harness();Object.assign(h.input.body,fields);await assert.rejects(h.run,e=>e.status===400);assert.equal(h.effects.upload,0);}});
 for(const version of [undefined,null,'', 'not-a-version',correctedContactVersion])await t.test('missing or mismatched reviewed contact rejects before any save/send: '+String(version),async()=>{
  const h=await harness();h.input.body.label_confirmed=true;h.input.body.confirmed_customer_contact_version=version;
  await assert.rejects(h.run,e=>e.status===409&&/contact.*review/i.test(e.message));
  assert.equal(await h.package(),undefined);assert.equal(await h.notice(),undefined);assert.equal(h.effects.upload,0);assert.equal(h.effects.secret,0);assert.equal(h.calls.length,0);
 });
 await t.test('email changed after form display rejects stale confirmation, then fresh saved review authorizes only the displayed contact',async()=>{
  const h=await harness();await h.run();const beforeP=await h.package(),beforeN=await h.notice(),uploads=h.effects.upload;
  await db.query('update parcel_snap.customers set email=$1 where id=$2',['newly-reviewed@example.test',id(2)]);
  try{
   h.input.body.label_confirmed=true;h.input.body.ocr_recipient_address='Must not save stale confirmation';
   await assert.rejects(h.run,e=>e.status===409&&/contact.*review/i.test(e.message));
   assert.deepEqual(await h.package(),beforeP);assert.deepEqual(await h.notice(),beforeN);assert.equal(h.effects.upload,uploads);assert.equal(h.calls.length,0);assert.equal(h.effects.secret,0);
   const review=await h.review();assert.equal(review.snapshot.customer.email,'newly-reviewed@example.test');assert.notEqual(review.snapshot.customer.contact_version,contactVersion);
   h.input.body.confirmed_customer_contact_version=review.snapshot.customer.contact_version;
   assert.equal((await h.run()).email.status,'SENT');assert.deepEqual(JSON.parse(h.calls[0].body).to,['newly-reviewed@example.test']);assert.equal((await h.notice()).attempt_count,1);
  }finally{await db.query('update parcel_snap.customers set email=$1 where id=$2',['recipient@example.test',id(2)]);}
 });
 await t.test('new origin and destination reject an email changed since display without arrival writes',async()=>{
  for(const kind of ['origin','destination']){
   const h=await harness();if(kind==='destination'){await h.run();h.input.kind='destination';h.input.body={package_id:h.input.body.intake_package_id,facility_id:id(4),photo_data_url:photo,label_confirmed:true,confirmed_customer_id:id(2),confirmed_customer_contact_version:contactVersion};h.input.body.confirmed_package_review_version=await packageReviewVersion(id(1),(await db.query('select id,customer_id,tracking_number from parcel_snap.packages where id=$1',[h.input.body.package_id])).rows[0]);}else h.input.body.label_confirmed=true;
   const pid=h.input.body.intake_package_id||h.input.body.package_id,old=(await db.query('select * from parcel_snap.packages where id=$1',[pid])).rows,uploads=h.effects.upload;
   await db.query('update parcel_snap.customers set email=$1 where id=$2',['unseen@example.test',id(2)]);
   try{await assert.rejects(h.run,e=>e.status===409);assert.deepEqual((await db.query('select * from parcel_snap.packages where id=$1',[pid])).rows,old);assert.equal(h.effects.upload,uploads);assert.equal(h.calls.length,0);}finally{await db.query('update parcel_snap.customers set email=$1 where id=$2',['recipient@example.test',id(2)]);}
  }
 });
 await t.test('email changed during upload is rejected by transaction before package writes',async()=>{
  const h=await harness();h.input.body.label_confirmed=true;h.flags.onDownload=async()=>db.query('update parcel_snap.customers set email=$1 where id=$2',['changed-during-upload@example.test',id(2)]);
  try{await assert.rejects(h.run,e=>e.status===409&&/Customer or warehouse changed/.test(e.message));assert.equal(await h.package(),undefined);assert.equal(await h.notice(),undefined);assert.equal(h.calls.length,0);assert.equal(h.effects.secret,0);}finally{await db.query('update parcel_snap.customers set email=$1 where id=$2',['recipient@example.test',id(2)]);}
 });
 await t.test('contact changed during saved photo read invalidates read-only recovery snapshot',async()=>{
  const h=await harness();await h.run();h.flags.onDownload=async()=>db.query('update parcel_snap.customers set email=$1 where id=$2',['changed-during-review@example.test',id(2)]);
  try{await assert.rejects(h.review,/changed during review/);assert.equal(h.calls.length,0);assert.equal(h.effects.secret,0);}finally{await db.query('update parcel_snap.customers set email=$1 where id=$2',['recipient@example.test',id(2)]);}
 });
 await t.test('atomic SQL claim blocks contact changed after attachment verification',async()=>{
  const h=await harness();h.input.body.label_confirmed=true;const original=h.deps.repo;h.deps.repo={...original,claim:async(...args)=>{await db.query('update parcel_snap.customers set email=$1 where id=$2',['changed-before-claim@example.test',id(2)]);return original.claim(...args);}};
  try{const result=await h.run();assert.equal(result.email.status,'UNKNOWN');assert.equal((await h.notice()).attempt_count,0);assert.equal((await h.notice()).status,'PENDING');assert.equal(h.calls.length,0);}finally{await db.query('update parcel_snap.customers set email=$1 where id=$2',['recipient@example.test',id(2)]);}
 });
 for(const status of ['SENT','FAILED','UNKNOWN','SENDING'])await t.test('fresh contact review cannot rewrite '+status+' attempted recipient',async()=>{
  const h=await harness();await h.run();await db.query('update parcel_snap.arrival_notices set status=$1,attempt_count=1 where package_id=$2',[status,h.input.body.intake_package_id]);const before=await h.notice();await db.query('update parcel_snap.customers set email=$1 where id=$2',['changed-after-attempt@example.test',id(2)]);
  try{h.input.body.label_confirmed=true;h.input.body.confirmed_customer_contact_version=await readContactVersion(id(2));await assert.rejects(h.run,e=>e.status===409);assert.deepEqual(await h.notice(),before);assert.equal(h.calls.length,0);}finally{await db.query('update parcel_snap.customers set email=$1 where id=$2',['recipient@example.test',id(2)]);}
 });
 await t.test('staff retains existing send authority with hidden contact revision and stale versions still fail closed',async()=>{
  const h=await harness();h.input.role='STAFF';await h.run();const before=(await h.review()).snapshot.customer;
  assert.equal(before.email,null);assert.equal(before.contact_email_visible,false);assert.equal(before.contact_version,contactVersion);assert(!('contact_revision' in before));
  await db.query('update parcel_snap.customers set email=$1 where id=$2',['staff-saved-contact@example.test',id(2)]);
  try{
   h.input.body.label_confirmed=true;h.input.body.confirmed_customer_contact_version=before.contact_version;
   await assert.rejects(h.run,e=>e.status===409);assert.equal(h.calls.length,0);
   const refreshed=(await h.review()).snapshot.customer;assert.equal(refreshed.email,null);assert.equal(refreshed.contact_email_visible,false);assert.notEqual(refreshed.contact_version,before.contact_version);
   h.input.body.confirmed_customer_contact_version=refreshed.contact_version;assert.equal((await h.run()).email.status,'SENT');assert.deepEqual(JSON.parse(h.calls[0].body).to,['staff-saved-contact@example.test']);
  }finally{await db.query('update parcel_snap.customers set email=$1 where id=$2',['recipient@example.test',id(2)]);}
 });
 await t.test('revision changes even when email updates omit updated_at; token contains no email-dependent material',async()=>{
  const h=await harness(),before=(await db.query('select id,email,updated_at,xmin::text as contact_revision from parcel_snap.customers where id=$1',[id(2)])).rows[0];
  const token=await customerContactVersion(id(1),before);
  assert.equal(token,await customerContactVersion(id(1),{...before,email:'guessed@example.test'}));
  assert.notEqual(token,await customerContactVersion(id(99),before));assert.notEqual(token,await customerContactVersion(id(1),{...before,id:id(99)}));
  await db.query('update parcel_snap.customers set email=$1 where id=$2',['changed-no-timestamp@example.test',id(2)]);
  try{const after=(await db.query('select id,email,updated_at,xmin::text as contact_revision from parcel_snap.customers where id=$1',[id(2)])).rows[0];assert.deepEqual(after.updated_at,before.updated_at);assert.notEqual(after.contact_revision,before.contact_revision);assert.notEqual(await customerContactVersion(id(1),after),token);}finally{await db.query('update parcel_snap.customers set email=$1 where id=$2',['recipient@example.test',id(2)]);}
 });
 await t.test('atomic SQL claim also blocks a same-email customer-row revision change',async()=>{
  const h=await harness();h.input.body.label_confirmed=true;const original=h.deps.repo;h.deps.repo={...original,claim:async(...args)=>{await db.query('update parcel_snap.customers set name=$1 where id=$2',['Concurrent name edit',id(2)]);return original.claim(...args);}};
  try{assert.equal((await h.run()).email.status,'UNKNOWN');assert.equal((await h.notice()).attempt_count,0);assert.equal(h.calls.length,0);}finally{await db.query('update parcel_snap.customers set name=$1 where id=$2',['Synthetic Recipient',id(2)]);}
 });
 await t.test('contact change after successful claim cannot redirect its frozen payload',async()=>{
  const h=await harness();h.input.body.label_confirmed=true;const original=h.deps.repo;h.deps.repo={...original,claim:async(...args)=>{const claim=await original.claim(...args);await db.query('update parcel_snap.customers set email=$1 where id=$2',['changed-after-claim@example.test',id(2)]);return claim;}};
  try{assert.equal((await h.run()).email.status,'SENT');assert.deepEqual(JSON.parse(h.calls[0].body).to,['recipient@example.test']);assert.equal((await h.notice()).attempt_count,1);}finally{await db.query('update parcel_snap.customers set email=$1 where id=$2',['recipient@example.test',id(2)]);}
 });
 await t.test('package metadata changed without updated_at invalidates recovery snapshot',async()=>{
  const h=await harness();await h.run();const before=await h.package();h.flags.onDownload=async()=>db.query("update parcel_snap.packages set ocr_recipient_address='Changed without timestamp' where id=$1",[h.input.body.intake_package_id]);
  await assert.rejects(h.review,/changed during review/);assert.deepEqual((await h.package()).updated_at,before.updated_at);assert.equal(h.calls.length,0);
 });
 await t.test('PENDING with any previous attempt is immutable, cannot recover or claim, and status-only remains blocked',async()=>{
  const h=await harness();await h.run();await db.query('update parcel_snap.arrival_notices set attempt_count=1 where package_id=$1',[h.input.body.intake_package_id]);const before=await h.notice();
  await assert.rejects(h.review,e=>e.status===409);assert.deepEqual(await repo.pendingOriginReviews(id(1),[h.input.body.intake_package_id]),[]);
  h.input.body.ocr_recipient_address='Forbidden correction';await assert.rejects(h.run,e=>e.status===409);h.input.body.ocr_recipient_address='123 Fictional Way';h.input.body.label_confirmed=true;
  assert.equal((await h.run()).email.status,'UNKNOWN');const revision=(await db.query('select xmin::text as revision from parcel_snap.customers where id=$1',[id(2)])).rows[0].revision;assert.equal(await repo.claim(before,id(6),revision,h.input.body.tracking_number),null);
  h.input.body.reconcile_notification=true;delete h.input.body.photo_data_url;assert.equal((await h.run()).email.status,'UNKNOWN');assert.deepEqual(await h.notice(),before);assert.equal(h.calls.length,0);
 });
 async function displayDestination(h){
  const p=await h.package();
  h.input.kind='destination';h.input.body={package_id:p.id,facility_id:id(4),photo_data_url:photo,label_confirmed:true,confirmed_customer_id:p.customer_id,confirmed_customer_contact_version:await readContactVersion(p.customer_id),confirmed_package_review_version:await packageReviewVersion(id(1),p)};
  return p;
 }
 async function destinationNotice(packageId){return (await db.query("select * from parcel_snap.arrival_notices where package_id=$1 and event_type=$2",[packageId,'FACILITY_ARRIVAL_'+id(4)])).rows[0];}
 await t.test('destination confirmation missing package-review version rejects before any arrival write',async()=>{
  const h=await harness();await h.run();const p=await displayDestination(h),uploads=h.effects.upload;delete h.input.body.confirmed_package_review_version;
  await assert.rejects(h.run,e=>e.status===409&&/Package details/.test(e.message));assert.equal(h.effects.upload,uploads);assert.equal(await destinationNotice(p.id),undefined);assert.equal(h.calls.length,0);
 });
 for(const change of ['tracking','customer'])await t.test('destination rejects '+change+' changed after display, without downgrading a confirmed action',async()=>{
  const h=await harness();await h.run();const p=await displayDestination(h),uploads=h.effects.upload;
  if(change==='tracking')await db.query('update parcel_snap.packages set tracking_number=$1 where id=$2',['UNSEEN-TRACKING',p.id]);
  else await db.transaction(async tx=>{await tx.query('update parcel_snap.packages set customer_id=$1 where id=$2',[id(22),p.id]);await tx.query('update parcel_snap.arrival_notices set customer_id=$1 where package_id=$2',[id(22),p.id]);});
  await assert.rejects(h.run,e=>e.status===409&&/Package details/.test(e.message));assert.equal(h.effects.upload,uploads);assert.equal(await destinationNotice(p.id),undefined);assert.equal((await db.query('select stage from parcel_snap.packages where id=$1',[p.id])).rows[0].stage,'ORIGIN_RECEIVED');assert.equal(h.calls.length,0);
 });
 await t.test('destination tracking changed during upload rolls back preparation before arrival writes',async()=>{
  const h=await harness();await h.run();const p=await displayDestination(h);h.flags.onDownload=async()=>db.query('update parcel_snap.packages set tracking_number=$1 where id=$2',['CHANGED-DURING-UPLOAD',p.id]);
  await assert.rejects(h.run,e=>e.status===409&&/Package details/.test(e.message));assert.equal(await destinationNotice(p.id),undefined);assert.equal(h.calls.length,0);
 });
 await t.test('destination tracking changed before attachment blocks private email',async()=>{
  const h=await harness();await h.run();const p=await displayDestination(h),original=h.deps.repo;h.deps.repo={...original,verifyPhoto:async(...args)=>{await db.query('update parcel_snap.packages set tracking_number=$1 where id=$2',['CHANGED-BEFORE-ATTACHMENT',p.id]);return original.verifyPhoto(...args);}};
  assert.equal((await h.run()).email.status,'FAILED');assert.equal((await destinationNotice(p.id)).attempt_count,0);assert.equal(h.calls.length,0);
 });
 await t.test('final SQL claim rejects destination tracking changed after attachment verification',async()=>{
  const h=await harness();await h.run();const p=await displayDestination(h),original=h.deps.repo;h.deps.repo={...original,claim:async(...args)=>{await db.query('update parcel_snap.packages set tracking_number=$1 where id=$2',['CHANGED-BEFORE-CLAIM',p.id]);return original.claim(...args);}};
  assert.equal((await h.run()).email.status,'UNKNOWN');assert.equal((await destinationNotice(p.id)).attempt_count,0);assert.equal(h.calls.length,0);
 });
 await t.test('post-claim tracking change cannot replace reviewed tracking in frozen destination payload',async()=>{
  const h=await harness();await h.run();const p=await displayDestination(h),original=h.deps.repo;h.deps.repo={...original,claim:async(...args)=>{const claim=await original.claim(...args);await db.query('update parcel_snap.packages set tracking_number=$1 where id=$2',['CHANGED-AFTER-CLAIM',p.id]);return claim;}};
  assert.equal((await h.run()).email.status,'SENT');const message=JSON.parse(h.calls[0].body);assert(message.text.includes(p.tracking_number));assert(!message.text.includes('CHANGED-AFTER-CLAIM'));assert.equal((await destinationNotice(p.id)).attempt_count,1);
 });
 await t.test('blank tracking is explicitly reviewable and package version ignores its own stage/location changes',async()=>{
  const h=await harness();h.input.body.tracking_number='';await h.run();const p=await displayDestination(h);
  assert.equal(await packageReviewVersion(id(1),p),await packageReviewVersion(id(1),{...p,stage:'DESTINATION_RECEIVED',current_facility_id:id(4)}));assert.notEqual(await packageReviewVersion(id(1),p),await packageReviewVersion(id(1),{...p,tracking_number:'NEW'}));
  assert.equal((await h.run()).email.status,'SENT');assert(JSON.parse(h.calls[0].body).text.includes('Tracking: Not recorded; please check the attached label'));
 });
});
