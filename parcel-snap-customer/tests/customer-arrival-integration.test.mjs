import './isolated-network-guard.mjs';
// Cross-layer local validation: real customer event handlers and PostgreSQL-WASM adapter.
// DOM, auth/portal envelope, private Storage and mail delivery are isolated substitutes.
// No network, physical camera, hosted inference, real Storage or real email is exercised.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {processArrival,reviewSavedArrival,createArrivalRepository,sha256,customerContactVersion,packageReviewVersion} from '../backend/arrival-workflow.mjs';
const require=createRequire(import.meta.url);
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const {createWorker}=require('tesseract.js');
const moduleURL=process.env.PGLITE_MODULE?pathToFileURL(process.env.PGLITE_MODULE):new URL('./sql-runtime/node_modules/@electric-sql/pglite/dist/index.js',import.meta.url);
const {PGlite}=await import(moduleURL);
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const matcher=fs.readFileSync(new URL('../known-customer-matcher.js',import.meta.url),'utf8');
const photo=fs.readFileSync(new URL('../../parcel-snap-vision-test/fixtures/synthetic-label-unmarked.jpg',import.meta.url));
const id=n=>String(n).padStart(8,'0')+'-2222-4222-8222-222222222222';
const customer={id:id(2),company_id:id(1),name:'Jordan Sample',email:'jordan@example.invalid',customer_type:'PERSON'};
async function contactVersion(db,contact=customer){
 const row=(await db.query('select xmin::text as contact_revision from parcel_snap.customers where id=$1',[contact.id])).rows[0];
 return customerContactVersion(id(1),{...contact,contact_revision:row.contact_revision});
}
const decodePhoto=data=>Buffer.from(data.split(',')[1],'base64');

async function database(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(fs.readFileSync(new URL('./arrival-baseline-fixture.sql',import.meta.url),'utf8'));
 await db.exec(fs.readFileSync(new URL('../backend/schema-proposals/arrival-notices.sql',import.meta.url),'utf8'));
 await db.query('insert into parcel_snap.companies(id,name) values($1,$2)',[id(1),'Fictional Cross-layer Shipping']);
 await db.query('insert into parcel_snap.customers(id,company_id,name,email) values($1,$2,$3,$4)',[customer.id,id(1),customer.name,customer.email]);
 customer.contact_version=await contactVersion(db);
 await db.query("insert into parcel_snap.facilities(id,company_id,code,name,facility_type,city) values($1,$2,'FIX-O','Fictional Origin','ORIGIN','Example City'),($3,$2,'FIX-D','Fictional Destination','DESTINATION','Sample City')",[id(3),id(1),id(4)]);
 await db.query("insert into parcel_snap.company_profiles(company_id,needs_customer_notifications,notification_channels) values($1,true,array['EMAIL'])",[id(1)]);
 return db;
}
let sequence=100;
function harness(db,objects=new Map(),role="OWNER"){
 const nodes=new Map(),requests=[],responses=[],mail=[],alerts=[];
 const flags={storageFail:false,finishFailures:0};let refreshes=0,workspaceReads=0;
 const node=id=>{if(!nodes.has(id)){const classes=new Set();nodes.set(id,{id,value:'',textContent:'',innerHTML:'',checked:false,disabled:false,dataset:{},classList:{add(...xs){xs.forEach(x=>classes.add(x));},remove(...xs){xs.forEach(x=>classes.delete(x));},toggle(x,force){const on=force??!classes.has(x);if(on)classes.add(x);else classes.delete(x);return on;},contains:x=>classes.has(x)}});}return nodes.get(id);};
 const ctx=vm.createContext({console,performance,setTimeout,crypto:{randomUUID:()=>id(sequence++)},document:{getElementById:node,createElement:()=>createCanvas(1,1),querySelector:()=>({click(){}})},supabase:{createClient:()=>({})},alert:value=>alerts.push(value),fetch(){throw Error('Real network forbidden');}});ctx.window=ctx;ctx.confirm=()=>true;
 vm.runInContext(matcher,ctx);vm.runInContext(app.slice(0,app.indexOf('function setMode(')),ctx);
 ctx.fixtureCustomer={...structuredClone(customer),contact_email_visible:role!=="STAFF",...(role==="STAFF"?{email:null}:{})};ctx.fixtureRole=role;
 vm.runInContext(`workspace={company:{id:'${id(1)}',role:fixtureRole},customers:[fixtureCustomer],packages:[]};intakePhotoDataUrl='data:image/jpeg;base64,${photo.toString('base64')}';intakeReadToken=1;intakeOcrName='Jordan Sample';intakeOcrText='Jordan Sample';intakeOcrAddress='123 Test Parcel Way, Unit 04, Miami FL 33101';`,ctx);
 const sql={unsafe:async(q,p=[])=>(await db.query(q,p)).rows,begin:fn=>db.transaction(tx=>fn({unsafe:async(q,p=[])=>(await tx.query(q,p)).rows}))};
 const repository=createArrivalRepository(sql);
 const repo={...repository,finish:async(...args)=>{if(flags.finishFailures-->0)throw Error('Fictional status-persistence failure');return repository.finish(...args);}};
 const deps={repo,assertPrivateStorage:async()=>{},canOperate:async()=>true,secret:async()=> 'fictional-test-value',storage:{
  upload:async(path,bytes)=>{if(flags.storageFail)return {error:Error('Fictional upload failure')};if(objects.has(path))return {error:Error('exists')};objects.set(path,Buffer.from(bytes));return {error:null};},
  download:async path=>objects.has(path)?{data:new Blob([objects.get(path)])}:{error:Error('missing')}
 },fetch:async(url,options={})=>{
  mail.push({url,...options});
  if(options.method==='POST')return Response.json({id:'fictional-mail-'+mail.length});
  const providerId=url.split('/').at(-1);const notice=(await db.query('select * from parcel_snap.arrival_notices where provider_message_id=$1',[providerId])).rows[0];
  return Response.json({id:providerId,...notice.payload,last_event:'delivered'});
 }};
 const listPackages=async()=>{const rows=(await db.query('select p.*,c.name as customer_name from parcel_snap.packages p join parcel_snap.customers c on c.id=p.customer_id')).rows;const pending=new Set((await repo.pendingOriginReviews(id(1),rows.map(p=>p.id))).map(p=>p.package_id));return Promise.all(rows.map(async p=>({...p,origin_review_pending:pending.has(p.id),review_version:await packageReviewVersion(id(1),p)})));};
 const refresh=async()=>{refreshes++;ctx.savedPackages=await listPackages();vm.runInContext('workspace.packages=savedPackages',ctx);};
 ctx.loadWorkspace=refresh;
 ctx.api=async body=>{
  const sent=JSON.parse(JSON.stringify(body));
  if(sent.action==='workspace'){workspaceReads++;return {state:'ACTIVE',company:{id:id(1)},packages:await listPackages(),attention:[]};}
  requests.push(sent);
  const input={kind:sent.action==='destination_arrival'?'destination':'origin',body:sent,companyId:id(1),userId:id(6),role,actor:'tester@example.invalid'};
  const result=sent.action==='review_saved_arrival'?await reviewSavedArrival(input,deps):await processArrival(input,deps);
  const received=JSON.parse(JSON.stringify(result));responses.push(received);return received;
 };
 const list=app.indexOf('function renderAttention(){');vm.runInContext(app.slice(list,app.indexOf('function renderCustomers()',list)),ctx);
 const receive=app.indexOf('async function receivePackage(){');vm.runInContext(app.slice(receive,app.indexOf('function renderTransferControls()',receive)),ctx);
 const handlers=app.indexOf('$("receiveCustomer").onchange=');vm.runInContext(app.slice(handlers,app.indexOf('$("packagePhoto").onchange=',handlers)),ctx);
 const transfer=app.indexOf('for(const id of ["transferPackage","transferFacility"])');vm.runInContext(app.slice(transfer,app.indexOf('document.querySelectorAll(".tab")',transfer)),ctx);
 node('receiveCustomer').value=customer.id;node('receiveOrigin').value=id(3);node('receiveDestination').value=id(4);node('receiveTracking').value='001234567890';node('receiveCarrier').value='TEST';node('receiveSize').value='UNKNOWN';node('receivePayment').value='UNKNOWN';
 vm.runInContext('renderLabelReadout();renderTransferRecipient()',ctx);
 return {ctx,node,requests,responses,mail,objects,alerts,flags,refresh,get refreshes(){return refreshes;},get workspaceReads(){return workspaceReads;},run:code=>vm.runInContext(code,ctx),receive:()=>node('receivePackageButton').onclick()};
}

test('customer events through actual SQL adapter with fictional Storage/mail capture',async t=>{
 const db=await database(t);
 await t.test('actual JPEG preparation/OCR → explicit recipient confirmation → saved tracking and exact attachment → form reset',async()=>{
  const h=harness(db),worker=await createWorker('eng',1,{langPath:process.env.TESSDATA_PREFIX||'/usr/share/tesseract-ocr/5/tessdata',gzip:false});
  try{
   const adapter={setParameters:p=>worker.setParameters(p),recognize:(image,...args)=>worker.recognize(image.toBuffer('image/png'),...args),terminate:async()=>{}};
   h.ctx.Tesseract={createWorker:async()=>adapter};h.ctx.readFileDataUrl=async bytes=>'data:image/jpeg;base64,'+bytes.toString('base64');h.ctx.loadImage=loadImage;
   const prepared=await h.ctx.preparePackageImages(photo);h.ctx.preparedPreview=prepared.preview;h.run('intakePhotoDataUrl=preparedPreview');
   await h.ctx.getParcelSnapOcrWorker();let recovery;const actual=h.ctx.runDeepRecovery;h.ctx.runDeepRecovery=(...args)=>(recovery=actual(...args));
   const result=await h.ctx.readPackagePhoto(prepared.ocrCanvas,{raw:prepared.rawOcrCanvas});if(recovery)await recovery;
   assert.equal(result.candidate,customer.name);assert.equal(result.tracking,'1ZTEST000000000001');assert.equal(result.status,'NEEDS_REVIEW');assert.equal(h.mail.length,0);assert.equal(h.requests.length,0);
   h.node('receiveCustomer').value=customer.id;h.node('receiveCustomer').onchange();h.node('receiveLabelConfirmed').checked=true;h.node('receiveLabelConfirmed').onchange();
   await h.receive();assert.equal(h.responses.at(-1).email.status,'SENT');assert.equal(h.mail.length,1);
   const sent=h.requests[0],payload=JSON.parse(h.mail[0].body),image=decodePhoto(sent.photo_data_url),attachment=Buffer.from(payload.attachments[0].content,'base64');
   assert.deepEqual(attachment,image);assert.deepEqual(payload.to,[customer.email]);assert.match(payload.text,/Tracking: 1ZTEST000000000001/);
   const saved=(await db.query('select * from parcel_snap.packages where id=$1',[sent.intake_package_id])).rows[0];assert.equal(saved.tracking_number,'1ZTEST000000000001');assert.match(saved.ocr_recipient_address,/UNIT 04/);
   const notice=(await db.query('select * from parcel_snap.arrival_notices where package_id=$1',[saved.id])).rows[0];assert.equal(notice.photo_sha256,await sha256(image));assert.deepEqual(h.objects.get(notice.photo_path),image);
   assert.equal(h.run('intakePhotoDataUrl'),null);assert.equal(h.node('receiveLabelConfirmed').checked,false);assert.equal(h.node('receiveTracking').value,'');assert.equal(h.refreshes,1);
   assert.match(h.node('receiveResult').textContent,/photo saved.*email SENT/);
   assert.equal(h.node('labelReadout').classList.contains('hidden'),true);assert.equal(h.node('labelFields').textContent,'');assert.equal(h.node('labelRawText').textContent,'');
  }finally{await worker.terminate();}
 });
 await t.test('unconfirmed review saves the photo and package but captures no email; explicit confirmation reuses the ID',async()=>{
  const h=harness(db);await h.receive();assert.equal(h.responses[0].email.status,'REVIEW_REQUIRED');assert.equal(h.mail.length,0);assert(h.run('intakePhotoDataUrl'));
  const packageId=h.requests[0].intake_package_id;assert.equal(h.workspaceReads,1);assert(h.run('workspace.packages').some(p=>p.id===packageId));assert(h.node('transferPackage').innerHTML.includes(packageId));assert.equal((await db.query('select count(*)::int n from parcel_snap.packages where id=$1',[packageId])).rows[0].n,1);
  h.node('receiveLabelConfirmed').checked=true;h.node('receiveLabelConfirmed').onchange();await h.receive();assert.equal(h.requests[1].intake_package_id,packageId);assert.equal(h.responses[1].email.status,'SENT');assert.equal(h.mail.length,1);assert.equal(h.run('intakePhotoDataUrl'),null);
 });
 await t.test('reload → verified saved-photo review → metadata correction → confirmation keeps original ID and sends once',async()=>{
  const first=harness(db);await first.receive();const packageId=first.requests[0].intake_package_id,objectCount=first.objects.size;
  const reloaded=harness(db,first.objects);reloaded.run('intakePhotoDataUrl=null;intakePackageId=null');await reloaded.refresh();
  assert(reloaded.run('workspace.packages').find(p=>p.id===packageId).origin_review_pending);
  await reloaded.node('packageList').onclick({target:{closest:()=>({dataset:{reviewIntake:packageId}})}});
  assert.equal(reloaded.requests[0].action,'review_saved_arrival');assert.equal(reloaded.run('intakePackageId'),packageId);assert.equal(reloaded.node('receiveLabelConfirmed').checked,false);
  assert.deepEqual(decodePhoto(reloaded.run('intakePhotoDataUrl')),photo);assert.equal(reloaded.objects.size,objectCount);assert.equal(reloaded.mail.length,0);
  reloaded.node('receiveAddress').value='124 Corrected Way, Unit 009, Miami FL 33101';reloaded.node('receiveAddress').oninput();
  reloaded.node('receiveCarrier').value='Corrected Carrier';reloaded.node('receiveSize').value='MEDIUM';reloaded.node('receiveWeight').value='2.75';reloaded.node('receivePayment').value='PAID';
  reloaded.node('receiveLabelConfirmed').checked=true;reloaded.node('receiveLabelConfirmed').onchange();await reloaded.receive();
  assert.equal(reloaded.requests[1].intake_package_id,packageId);assert.equal(reloaded.responses[1].email.status,'SENT');assert.equal(reloaded.mail.length,1);assert.equal(first.mail.length,0);
  const saved=(await db.query('select * from parcel_snap.packages where id=$1',[packageId])).rows[0];
  assert.equal(saved.ocr_recipient_address,'124 Corrected Way, Unit 009, Miami FL 33101');assert.equal(saved.carrier,'Corrected Carrier');assert.equal(saved.size_class,'MEDIUM');assert.equal(Number(saved.weight_lb),2.75);assert.equal(saved.payment_status,'PAID');
  assert.deepEqual(Buffer.from(JSON.parse(reloaded.mail[0].body).attachments[0].content,'base64'),photo);assert.equal(reloaded.run('intakePhotoDataUrl'),null);
  assert.equal((await db.query('select attempt_count from parcel_snap.arrival_notices where package_id=$1',[packageId])).rows[0].attempt_count,1);
 });
 await t.test('claim between resume and corrected save cannot discard edits or send a second notice',async()=>{
  const initial=harness(db);await initial.receive();const packageId=initial.requests[0].intake_package_id;
  const reviewing=harness(db,initial.objects);reviewing.run('intakePhotoDataUrl=null;intakePackageId=null');await reviewing.refresh();await reviewing.run('resumeSavedIntake("'+packageId+'")');
  const other=harness(db,initial.objects);other.ctx.savedId=packageId;other.run('intakePackageId=savedId');other.node('receiveLabelConfirmed').checked=true;other.node('receiveLabelConfirmed').onchange();await other.receive();assert.equal(other.responses[0].email.status,'SENT');
  reviewing.node('receiveAddress').value='125 Too Late Way, Unit 010';reviewing.node('receiveAddress').oninput();reviewing.node('receiveLabelConfirmed').checked=true;reviewing.node('receiveLabelConfirmed').onchange();await reviewing.receive();
  assert.equal(reviewing.mail.length,0);assert.equal(other.mail.length,1);assert.equal(reviewing.run('intakePackageId'),packageId);assert(reviewing.run('intakePhotoDataUrl'));assert.match(reviewing.node('receiveResult').textContent,/already|changed|metadata|attempt/i);
  assert.notEqual((await db.query('select ocr_recipient_address from parcel_snap.packages where id=$1',[packageId])).rows[0].ocr_recipient_address,'125 Too Late Way, Unit 010');
 });
 await t.test('notification preference suppression is saved honestly and clears completed intake without mail',async()=>{
  await db.query('update parcel_snap.company_profiles set needs_customer_notifications=false where company_id=$1',[id(1)]);
  try{const h=harness(db);h.node('receiveLabelConfirmed').checked=true;h.node('receiveLabelConfirmed').onchange();await h.receive();assert.equal(h.responses[0].email.status,'DISABLED');assert.equal(h.mail.length,0);assert.equal(h.run('intakePhotoDataUrl'),null);assert.match(h.node('receiveResult').textContent,/email DISABLED/);}
  finally{await db.query('update parcel_snap.company_profiles set needs_customer_notifications=true where company_id=$1',[id(1)]);}
 });
 await t.test('photo upload failure retains the same intake identity and evidence for a successful explicit retry',async()=>{
  const h=harness(db);h.flags.storageFail=true;h.node('receiveLabelConfirmed').checked=true;h.node('receiveLabelConfirmed').onchange();await h.receive();
  assert.match(h.node('receiveResult').textContent,/Photo upload failed/);assert(h.run('intakePhotoDataUrl'));assert.equal(h.mail.length,0);const packageId=h.requests[0].intake_package_id;
  assert.equal((await db.query('select count(*)::int n from parcel_snap.packages where id=$1',[packageId])).rows[0].n,0);
  h.flags.storageFail=false;await h.receive();assert.equal(h.requests[1].intake_package_id,packageId);assert.equal(h.responses[0].email.status,'SENT');assert.equal(h.mail.length,1);
 });
 await t.test('UNKNOWN recovery button uses frozen IDs and provider GET only after status persistence failure',async()=>{
  const h=harness(db);h.flags.finishFailures=1;h.node('receiveLabelConfirmed').checked=true;h.node('receiveLabelConfirmed').onchange();await h.receive();
  assert.equal(h.responses[0].email.status,'UNKNOWN');assert(h.run('intakePhotoDataUrl'));const original=h.requests[0];
  h.node('receiveTracking').value='EDITED-CURRENT-FORM';h.node('receiveCustomer').value='unrelated';
  await h.node('receiveCheckEmailStatus').onclick();
  assert.deepEqual(h.requests[1],{action:'receive_package',intake_package_id:original.intake_package_id,origin_facility_id:original.origin_facility_id,reconcile_notification:true});
  assert.equal(h.mail.length,2);assert.equal(h.mail.filter(x=>x.method==='POST').length,1);assert.equal(h.mail[1].method,undefined);assert.equal(h.responses[1].email.status,'SENT');assert.match(h.node('receiveEmailStatus').textContent,/provider acceptance confirmed/);
 });
 await t.test('email changed after the displayed review is rejected by actual SQL flow until fresh visible confirmation',async()=>{
  const h=harness(db),changed={...customer,email:'changed-contact@example.invalid',contact_email_visible:true};
  await db.query('update parcel_snap.customers set email=$1 where id=$2',[changed.email,customer.id]);
  changed.contact_version=await contactVersion(db,changed);
  try{
   h.node('receiveLabelConfirmed').checked=true;h.node('receiveLabelConfirmed').onchange();await h.receive();
   const first=h.requests[0];assert.equal(first.confirmed_customer_contact_version,customer.contact_version);
   assert.equal(h.mail.length,0);assert.equal(h.objects.size,0);assert.equal(h.responses.length,0);assert.match(h.node('receiveResult').textContent,/contact changed|not reviewed/i);
   assert.equal((await db.query('select count(*)::int n from parcel_snap.packages where id=$1',[first.intake_package_id])).rows[0].n,0);assert(h.run('intakePhotoDataUrl'));
   h.ctx.currentContact=changed;h.run('workspace.customers[0]=currentContact;renderLabelReadout()');
   assert.equal(h.node('receiveLabelConfirmed').checked,false);assert.match(h.node('labelFields').textContent,/changed-contact@example.invalid/);
   h.node('receiveLabelConfirmed').checked=true;h.node('receiveLabelConfirmed').onchange();await h.receive();
   assert.equal(h.requests[1].intake_package_id,first.intake_package_id);assert.equal(h.requests[1].confirmed_customer_contact_version,changed.contact_version);
   assert.equal(h.responses[0].email.status,'SENT');assert.equal(h.mail.length,1);assert.deepEqual(JSON.parse(h.mail[0].body).to,[changed.email]);
  }finally{await db.query('update parcel_snap.customers set email=$1 where id=$2',[customer.email,customer.id]);customer.contact_version=await contactVersion(db);}
 });
 await t.test('saved-review contact changes reject without duplicate packages and reopening requires fresh confirmation',async()=>{
  const first=harness(db);await first.receive();const packageId=first.requests[0].intake_package_id;
  const review=harness(db,first.objects);review.run('intakePhotoDataUrl=null');await review.refresh();await review.run('resumeSavedIntake("'+packageId+'")');
  await db.query('update parcel_snap.customers set email=$1 where id=$2',['saved-change@example.invalid',customer.id]);
  try{
   review.node('receiveLabelConfirmed').checked=true;review.node('receiveLabelConfirmed').onchange();await review.receive();
   assert.equal(review.mail.length,0);assert.match(review.node('receiveResult').textContent,/contact changed|not reviewed/i);assert.equal(review.run('intakePackageId'),packageId);
   assert.equal((await db.query('select count(*)::int n from parcel_snap.packages where id=$1',[packageId])).rows[0].n,1);
   await review.run('resumeSavedIntake("'+packageId+'")');assert.equal(review.node('receiveLabelConfirmed').checked,false);assert.match(review.node('labelFields').textContent,/saved-change@example.invalid/);
   review.node('receiveLabelConfirmed').checked=true;review.node('receiveLabelConfirmed').onchange();await review.receive();assert.equal(review.mail.length,1);assert.equal(review.responses.at(-1).email.status,'SENT');assert.deepEqual(JSON.parse(review.mail[0].body).to,['saved-change@example.invalid']);
  }finally{await db.query('update parcel_snap.customers set email=$1 where id=$2',[customer.email,customer.id]);customer.contact_version=await contactVersion(db);}
 });
 await t.test('STAFF hidden-contact confirmation rejects changed contact then permits fresh saved-customer review',async()=>{
  const h=harness(db,new Map(),'STAFF');assert.match(h.node('labelFields').textContent,/Email address hidden/);assert.doesNotMatch(h.node('labelFields').textContent,/jordan@example.invalid/);
  await db.query('update parcel_snap.customers set email=$1 where id=$2',['staff-changed@example.invalid',customer.id]);
  try{
   h.node('receiveLabelConfirmed').checked=true;h.node('receiveLabelConfirmed').onchange();await h.receive();
   assert.equal(h.requests[0].label_confirmed,true);assert.equal(h.mail.length,0);assert.equal(h.objects.size,0);assert.match(h.node('receiveResult').textContent,/contact changed|not reviewed/i);
   h.node('receiveLabelConfirmed').checked=false;h.node('receiveLabelConfirmed').onchange();await h.receive();assert.equal(h.responses.at(-1).email.status,'REVIEW_REQUIRED');
   const packageId=h.requests[0].intake_package_id;await h.run('resumeSavedIntake("'+packageId+'")');
   const snapshot=h.responses.at(-1).snapshot;assert.equal(snapshot.customer.email,null);assert.equal(snapshot.customer.contact_email_visible,false);assert(snapshot.customer.contact_version);assert.equal(h.node('receiveLabelConfirmed').checked,false);
   assert.match(h.node('receiveConfirmationText').textContent,/customer.s saved contact/);assert.doesNotMatch(h.node('labelFields').textContent,/staff-changed@example.invalid/);
   h.node('receiveLabelConfirmed').checked=true;h.node('receiveLabelConfirmed').onchange();await h.receive();assert.equal(h.responses.at(-1).email.status,'SENT');assert.equal(h.mail.length,1);assert.deepEqual(JSON.parse(h.mail[0].body).to,['staff-changed@example.invalid']);
   assert.equal((await db.query('select count(*)::int n from parcel_snap.packages where id=$1',[packageId])).rows[0].n,1);
  }finally{await db.query('update parcel_snap.customers set email=$1 where id=$2',[customer.email,customer.id]);customer.contact_version=await contactVersion(db);}
 });
 for(const role of ['OWNER','STAFF'])await t.test(role+' destination review pins the displayed contact revision through a server-side email change',async()=>{
  const h=harness(db,new Map(),role);h.node('receiveLabelConfirmed').checked=true;h.node('receiveLabelConfirmed').onchange();await h.receive();const packageId=h.requests[0].intake_package_id;
  h.node('transferPackage').value=packageId;h.node('transferFacility').value=id(4);h.ctx.arrivalPhoto='data:image/jpeg;base64,'+photo.toString('base64');h.run('transferPhotoDataUrl=arrivalPhoto');h.node('transferPackage').onchange();
  h.node('transferLabelConfirmed').checked=true;h.node('transferLabelConfirmed').onchange();
  await db.query('update parcel_snap.customers set email=$1 where id=$2',['arrival-changed@example.invalid',customer.id]);
  try{
   const objectsBefore=h.objects.size;await h.node('saveTransfer').onclick();assert.equal(h.requests[1].confirmed_customer_contact_version,customer.contact_version);assert.equal(h.mail.length,1);assert.equal(h.objects.size,objectsBefore);assert(h.run('transferPhotoDataUrl'));assert.match(h.node('transferResult').textContent,/contact changed|not reviewed/i);
   assert.equal((await db.query("select count(*)::int n from parcel_snap.arrival_notices where package_id=$1 and event_type=$2",[packageId,"FACILITY_ARRIVAL_"+id(4)])).rows[0].n,0);
   h.ctx.updatedContact={...customer,email:role==='STAFF'?null:'arrival-changed@example.invalid',contact_email_visible:role!=='STAFF',contact_version:await contactVersion(db)};
   h.run('workspace.customers[0]=updatedContact;renderTransferRecipient()');assert.equal(h.node('transferLabelConfirmed').checked,false);
   if(role==='STAFF')assert.doesNotMatch(h.node('transferRecipient').textContent,/arrival-changed@example.invalid/);else assert.match(h.node('transferRecipient').textContent,/arrival-changed@example.invalid/);
   h.node('transferLabelConfirmed').checked=true;h.node('transferLabelConfirmed').onchange();await h.node('saveTransfer').onclick();assert.equal(h.mail.length,2);assert.equal(h.responses.at(-1).email.status,'SENT');assert.deepEqual(JSON.parse(h.mail[1].body).to,['arrival-changed@example.invalid']);
  }finally{await db.query('update parcel_snap.customers set email=$1 where id=$2',[customer.email,customer.id]);customer.contact_version=await contactVersion(db);}
 });
 for(const role of ['OWNER','STAFF'])await t.test(role+' destination tracking changed only on server rejects the unseen package snapshot before any arrival effects',async()=>{
  const h=harness(db,new Map(),role);h.node('receiveLabelConfirmed').checked=true;h.node('receiveLabelConfirmed').onchange();await h.receive();const packageId=h.requests[0].intake_package_id;
  h.node('transferPackage').value=packageId;h.node('transferFacility').value=id(4);h.ctx.arrivalPhoto='data:image/jpeg;base64,'+photo.toString('base64');h.run('transferPhotoDataUrl=arrivalPhoto');h.node('transferPackage').onchange();
  const displayedVersion=h.run('displayedTransferPackage.review_version'),originalReadout=h.node('transferRecipient').textContent;
  h.node('transferLabelConfirmed').checked=true;h.node('transferLabelConfirmed').onchange();
  await db.query('update parcel_snap.packages set tracking_number=$1 where id=$2',['SERVER-CHANGED-0099',packageId]);
  const objectsBefore=h.objects.size;await h.node('saveTransfer').onclick();assert.equal(h.requests[1].confirmed_package_review_version,displayedVersion);assert.equal(h.node('transferRecipient').textContent,originalReadout);assert.equal(h.mail.length,1);assert.equal(h.objects.size,objectsBefore);assert(h.run('transferPhotoDataUrl'));assert.match(h.node('transferResult').textContent,/Package details changed|not reviewed/i);
  assert.equal((await db.query('select count(*)::int n from parcel_snap.arrival_notices where package_id=$1 and event_type=$2',[packageId,'FACILITY_ARRIVAL_'+id(4)])).rows[0].n,0);
  assert.equal((await db.query('select current_facility_id from parcel_snap.packages where id=$1',[packageId])).rows[0].current_facility_id,id(3));
  await h.refresh();h.run('renderTransferRecipient()');assert.equal(h.node('transferLabelConfirmed').checked,false);assert.match(h.node('transferRecipient').textContent,/SERVER-CHANGED-0099/);assert.notEqual(h.run('displayedTransferPackage.review_version'),displayedVersion);
  h.node('transferLabelConfirmed').checked=true;h.node('transferLabelConfirmed').onchange();await h.node('saveTransfer').onclick();assert.equal(h.responses.at(-1).email.status,'SENT');assert.equal(h.mail.length,2);assert.match(JSON.parse(h.mail[1].body).text,/Tracking: SERVER-CHANGED-0099/);
 });
 await t.test('actual destination handler attaches its arrival photo and resets after saved result',async()=>{
  const h=harness(db);h.node('receiveLabelConfirmed').checked=true;h.node('receiveLabelConfirmed').onchange();await h.receive();const packageId=h.requests[0].intake_package_id;
  h.node('transferPackage').value=packageId;h.node('transferFacility').value=id(4);h.ctx.arrivalPhoto='data:image/jpeg;base64,'+photo.toString('base64');h.run('transferPhotoDataUrl=arrivalPhoto');h.node('transferPackage').onchange();h.node('transferLabelConfirmed').checked=true;h.node('transferLabelConfirmed').onchange();
  await h.node('saveTransfer').onclick();assert.equal(h.responses[1].email.status,'SENT');assert.equal(h.mail.length,2);assert.deepEqual(Buffer.from(JSON.parse(h.mail[1].body).attachments[0].content,'base64'),photo);assert.equal(h.run('transferPhotoDataUrl'),null);assert.equal(h.node('transferLabelConfirmed').checked,false);assert.match(h.node('transferResult').textContent,/Arrival saved.*photo saved.*email SENT/);
 });
});
