// Actual PostgreSQL WASM execution. No network, production data, or provider sends.
// Dependency stays outside the app; see backend/ARRIVAL-REPAIR-VALIDATION.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {processArrival,createArrivalRepository} from '../backend/arrival-workflow.mjs';
const pgliteModule=process.env.PGLITE_MODULE?pathToFileURL(process.env.PGLITE_MODULE):new URL('./sql-runtime/node_modules/@electric-sql/pglite/dist/index.js',import.meta.url);
const {PGlite}=await import(pgliteModule);
const id=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const image=fs.readFileSync(new URL('../../parcel-snap-vision-test/fixtures/synthetic-label-unmarked.jpg',import.meta.url));

test('actual PostgreSQL schema/adapter validation, isolated in-memory with synthetic mail capture',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(fs.readFileSync(new URL('./arrival-baseline-fixture.sql',import.meta.url),'utf8'));
 await db.exec(fs.readFileSync(new URL('../backend/schema-proposals/arrival-notices.sql',import.meta.url),'utf8'));
 const sql={unsafe:async(q,p=[])=>(await db.query(q,p)).rows,begin:fn=>db.transaction(tx=>fn({unsafe:async(q,p=[])=>(await tx.query(q,p)).rows}))};
 await db.query('insert into parcel_snap.companies(id,name) values($1,$2),($3,$4)',[id(1),'Synthetic Shipping',id(11),'Other Tenant']);
 await db.query('insert into parcel_snap.customers(id,company_id,name,email) values($1,$2,$3,$4),($5,$2,$6,$7),($8,$9,$10,$11)',[id(2),id(1),'Synthetic Recipient','recipient@example.test',id(22),'Corrected Recipient','corrected@example.test',id(12),id(11),'Other Recipient','other@example.test']);
 await db.query("insert into parcel_snap.facilities(id,company_id,code,name,facility_type,city) values($1,$2,'TEST-O','Origin','ORIGIN','Test City'),($3,$2,'TEST-D','Destination','DESTINATION','Other City'),($4,$5,'OTHER','Other Tenant Facility','DESTINATION','Elsewhere')",[id(3),id(1),id(4),id(13),id(11)]);
 await db.query("insert into parcel_snap.company_profiles(company_id,needs_customer_notifications,notification_channels) values($1,true,array['EMAIL'])",[id(1)]);
 let sequence=100;
 function harness(){
  const objects=new Map(),calls=[];const flags={status:200,throw:false,finishFailures:0};
  const repository=createArrivalRepository(sql);
  const repo={...repository,finish:async(...args)=>{if(flags.finishFailures-->0)throw Error('Synthetic persistence failure');return repository.finish(...args);}};
  const deps={repo,assertPrivateStorage:async()=>{},canOperate:async()=>true,secret:async()=>'synthetic-test-key',storage:{upload:async(path,bytes)=>{if(objects.has(path))return {error:Error('exists')};objects.set(path,Buffer.from(bytes));return {error:null};},download:async path=>objects.has(path)?{data:new Blob([objects.get(path)])}:{error:Error('missing')}},fetch:async(url,init={})=>{calls.push({url,...init});if(flags.throw)throw Error('Synthetic timeout');if(!init.method){const n=(await db.query('select * from parcel_snap.arrival_notices where package_id=$1',[input.body.intake_package_id||input.body.package_id])).rows[0];return new Response(JSON.stringify({id:n.provider_message_id,...n.payload,last_event:'delivered'}));}return new Response(JSON.stringify({id:'synthetic-provider-'+sequence}),{status:flags.status});}};
  const input={companyId:id(1),userId:id(6),role:'OWNER',actor:'owner@example.test',kind:'origin',body:{intake_package_id:id(sequence++),customer_id:id(2),origin_facility_id:id(3),destination_facility_id:id(4),tracking_number:'0012345678901234567890',photo_data_url:'data:image/jpeg;base64,'+image.toString('base64'),label_confirmed:true,confirmed_customer_id:id(2)}};
  return {input,deps,calls,flags,objects,run:()=>processArrival(input,deps)};
 }
 await t.test('migration produces private RLS-enabled ledger and durable unique event identity',async()=>{
  const r=(await db.query("select c.relrowsecurity,has_table_privilege('anon',c.oid,'select') as anon_read,has_table_privilege('authenticated',c.oid,'insert') as user_write from pg_class c where c.oid='parcel_snap.arrival_notices'::regclass")).rows[0];assert.equal(r.relrowsecurity,true);assert.equal(r.anon_read,false);assert.equal(r.user_write,false);
 });
 await t.test('actual INSERT/transaction/claim SQL sends exact attachment once across retries',async()=>{
  const h=harness(),r=await h.run();assert.equal(r.email.status,'SENT');assert.deepEqual(Buffer.from(JSON.parse(h.calls[0].body).attachments[0].content,'base64'),image);assert.equal((await h.run()).email.status,'SENT');assert.equal(h.calls.length,1);
  const n=(await db.query('select status,attempt_count,confirmed_by from parcel_snap.arrival_notices where package_id=$1',[h.input.body.intake_package_id])).rows[0];assert.equal(n.status,'SENT');assert.equal(n.attempt_count,1);assert.equal(n.confirmed_by,id(6));
  await assert.rejects(()=>db.query('insert into parcel_snap.arrival_notices(company_id,package_id,customer_id,facility_id,event_type,photo_id,photo_path,photo_mime,photo_sha256,fingerprint,payload) select company_id,package_id,customer_id,facility_id,event_type,photo_id,photo_path,photo_mime,photo_sha256,fingerprint,payload from parcel_snap.arrival_notices where package_id=$1',[h.input.body.intake_package_id]),e=>e.code==='23505');
 });
 await t.test('deferred ownership FK permits only unattempted draft correction under same intake ID',async()=>{
  const h=harness();h.input.body.label_confirmed=false;assert.equal((await h.run()).email.status,'REVIEW_REQUIRED');h.input.body.customer_id=id(22);h.input.body.confirmed_customer_id=id(22);h.input.body.tracking_number='000NEW123456';h.input.body.label_confirmed=true;assert.equal((await h.run()).email.status,'SENT');assert.deepEqual(JSON.parse(h.calls[0].body).to,['corrected@example.test']);
 });
 await t.test('composite FKs reject another tenant customer or photo and event constraint rejects wrong facility event',async()=>{
  const h=harness();h.input.body.label_confirmed=false;await h.run();const n=(await db.query('select * from parcel_snap.arrival_notices where package_id=$1',[h.input.body.intake_package_id])).rows[0];
  await assert.rejects(()=>db.query('update parcel_snap.arrival_notices set customer_id=$1 where id=$2',[id(12),n.id]),e=>e.code==='23503');
  const otherPhoto=(await db.query('select id from parcel_snap.package_photos where package_id<>$1 limit 1',[h.input.body.intake_package_id])).rows[0];
  await assert.rejects(()=>db.query('update parcel_snap.arrival_notices set photo_id=$1 where id=$2',[otherPhoto.id,n.id]),e=>e.code==='23503');
  await assert.rejects(()=>db.query('update parcel_snap.arrival_notices set facility_id=$1 where id=$2',[id(13),n.id]),e=>e.code==='23503');
  await assert.rejects(()=>db.query('update parcel_snap.arrival_notices set event_type=$1 where id=$2',['FACILITY_ARRIVAL_'+id(99),n.id]),e=>e.code==='23514');
 });
 await t.test('atomic claim rejects stale edited fingerprint and only one of concurrent claim attempts wins',async()=>{
  const h=harness();h.input.body.label_confirmed=false;await h.run();const old=(await db.query('select * from parcel_snap.arrival_notices where package_id=$1',[h.input.body.intake_package_id])).rows[0];h.input.body.tracking_number='CHANGED12345';await h.run();assert.equal(await h.deps.repo.claim(old,id(6)),null);const fresh=(await db.query('select * from parcel_snap.arrival_notices where id=$1',[old.id])).rows[0];const claims=await Promise.all([h.deps.repo.claim(fresh,id(6)),h.deps.repo.claim(fresh,id(6))]);assert.equal(claims.filter(Boolean).length,1);
 });
 await t.test('destination preference gating and historical exact-facility photo guard execute in real SQL',async()=>{
  const h=harness();await h.run();const packageId=h.input.body.intake_package_id;h.input.kind='destination';h.input.body={package_id:packageId,facility_id:id(4),photo_data_url:'data:image/jpeg;base64,'+image.toString('base64'),label_confirmed:true,confirmed_customer_id:id(2)};
  await db.query('update parcel_snap.company_profiles set needs_customer_notifications=false where company_id=$1',[id(1)]);assert.equal((await h.run()).email.status,'DISABLED');assert.equal(h.calls.length,1);await db.query('update parcel_snap.company_profiles set needs_customer_notifications=true where company_id=$1',[id(1)]);assert.equal((await h.run()).email.status,'SENT');assert.equal(h.calls.length,2);
  const g=harness();await g.run();const pid=g.input.body.intake_package_id;await db.query("insert into parcel_snap.package_photos(company_id,package_id,facility_id,kind,storage_path,mime_type) values($1,$2,$3,'DESTINATION','synthetic-legacy.jpg','image/jpeg')",[id(1),pid,id(4)]);await db.query("update parcel_snap.packages set stage='IN_TRANSIT',current_facility_id=$2 where id=$1",[pid,id(3)]);g.input.kind='destination';g.input.body={package_id:pid,facility_id:id(4),photo_data_url:'data:image/jpeg;base64,'+image.toString('base64'),label_confirmed:true,confirmed_customer_id:id(2)};assert.equal((await g.run()).email.status,'UNKNOWN');assert.equal(g.calls.length,1);
 });
 await t.test('UNKNOWN survives repository recreation; no resend and GET-only reconciliation bypasses new email/photo',async()=>{
  const h=harness();h.flags.finishFailures=1;assert.equal((await h.run()).email.status,'UNKNOWN');await db.query('update parcel_snap.customers set email=$1 where id=$2',['changed@example.test',id(2)]);h.deps.repo=createArrivalRepository(sql);h.input.body.reconcile_notification=true;delete h.input.body.photo_data_url;assert.equal((await h.run()).email.status,'SENT');assert.equal(h.calls.length,2);assert.equal(h.calls[1].method,undefined);await db.query('update parcel_snap.customers set email=$1 where id=$2',['recipient@example.test',id(2)]);
 });
 await t.test('explicit rejected-response retry reuses frozen payload and exact idempotency key',async()=>{const h=harness();h.flags.status=429;assert.equal((await h.run()).email.status,'FAILED');h.flags.status=200;assert.equal((await h.run()).email.status,'SENT');assert.equal(h.calls[0].body,h.calls[1].body);assert.equal(h.calls[0].headers['Idempotency-Key'],h.calls[1].headers['Idempotency-Key']);});
});
