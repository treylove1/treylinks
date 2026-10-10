// Prepared for a suitable local environment. NOT executed here: Unix sockets are denied.
// Actual GitHub CI may use an explicitly opted-in fresh fixed-loopback service; no local TCP fallback.
// Uses only the baseline fixture already public in this repository; no captured full schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {processArrival,createArrivalRepository,customerContactVersion,buildArrivalPayload} from '../../backend/arrival-workflow.mjs';
import {nativeTestConfig} from './native-test-config.mjs';
const config=nativeTestConfig();
const {default:postgres}=await import(new URL('./node_modules/postgres/src/index.js',import.meta.url));
const id=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';

const photo=fs.readFileSync(new URL('../../../parcel-snap-vision-test/fixtures/synthetic-label-unmarked.jpg',import.meta.url));
const client=()=>postgres(config);

test('native PostgreSQL independent connections, advisory locks, concurrent claims, preflight rejection and UNKNOWN barriers',async t=>{
 const a=client(),b=client(),observer=client();t.after(()=>Promise.all([a.end(),b.end(),observer.end()]));
 const pids=await Promise.all([a,b,observer].map(s=>s`select pg_backend_pid() as pid`));assert.equal(new Set(pids.map(r=>r[0].pid)).size,3);
 const [server]=await a`select current_database() as db,current_user as username,current_setting('server_version_num')::int as version,to_regnamespace('parcel_snap') as app_schema,to_regnamespace('auth') as auth_schema`;
 assert.equal(server.db,config.database);assert.equal(server.username,config.username);assert(server.version>=170000&&server.version<180000,'requires PostgreSQL 17');assert.equal(server.app_schema,null,'requires fresh disposable database');assert.equal(server.auth_schema,null,'refuses an existing Auth schema');
 t.diagnostic(JSON.stringify({postgres_version_num:server.version,independent_backend_pids:pids.map(r=>r[0].pid),synthetic_database:server.db}));
 await a.unsafe(fs.readFileSync(new URL('../arrival-baseline-fixture.sql',import.meta.url),'utf8')).simple();
 await a.unsafe(fs.readFileSync(new URL('../../backend/schema-proposals/arrival-notices.sql',import.meta.url),'utf8')).simple();
 await a`insert into parcel_snap.companies(id,name) values(${id(1)},'Synthetic Shipping')`;
 await a`insert into parcel_snap.customers(id,company_id,name,email) values(${id(2)},${id(1)},'Synthetic Recipient','recipient@example.test')`;
 await a`insert into parcel_snap.facilities(id,company_id,code,name,facility_type,city) values(${id(3)},${id(1)},'ORIGIN','Origin','ORIGIN','Test City')`;
 await a`insert into parcel_snap.company_profiles(company_id,needs_customer_notifications,notification_channels) values(${id(1)},true,array['EMAIL'])`;
 const [customerRevision]=await a`select id,xmin::text as contact_revision from parcel_snap.customers where id=${id(2)}`;
 const contactVersion=await customerContactVersion(id(1),customerRevision);
 let sequence=100;const objects=new Map();
 const storage={async upload(path,bytes){if(objects.has(path))return {error:Error('exists')};objects.set(path,Buffer.from(bytes));return {error:null};},async download(path){return objects.has(path)?{data:new Blob([objects.get(path)])}:{error:Error('missing')};}};
 function scenario(){
  const input={kind:'origin',companyId:id(1),userId:id(6),role:'OWNER',actor:'owner@example.test',body:{intake_package_id:id(sequence++),customer_id:id(2),origin_facility_id:id(3),tracking_number:'0012345678901234567890',photo_data_url:'data:image/jpeg;base64,'+photo.toString('base64'),label_confirmed:true,confirmed_customer_id:id(2),confirmed_customer_contact_version:contactVersion}};
  const calls=[];const flags={timeout:false};
  const deps=s=>({repo:createArrivalRepository(s),storage,assertPrivateStorage:async()=>{},canOperate:async()=>true,secret:async()=>'synthetic-only',fetch:async(url,init)=>{calls.push({url,...init});await new Promise(r=>setTimeout(r,40));if(flags.timeout)throw Error('Synthetic uncertain provider acceptance');return new Response(JSON.stringify({id:'synthetic-message'}));}});
  return {input,calls,flags,run:s=>processArrival(input,deps(s)),repo:s=>createArrivalRepository(s)};
 }
 await t.test('pinned native driver binds serialized JSON through text without double encoding',async()=>{
  const payload={to:['recipient@example.test'],text:'Quotes " and backslash \\ and Unicode café'};
  const text=JSON.stringify(payload);
  const [inferred]=await a.unsafe('select jsonb_typeof($1::jsonb) as shape',[text]);
  assert.equal(inferred.shape,'string','pins the native-driver behavior that caused the regression');
  const [explicit]=await a.unsafe('select jsonb_typeof($1::text::jsonb) as shape,$1::text::jsonb as payload',[text]);
  assert.equal(explicit.shape,'object');assert.deepEqual(explicit.payload,payload);
 });
 await t.test('ledger INSERT and pending UPDATE preserve an object envelope and send the exact corrected payload',async()=>{
  const h=scenario();h.input.body.label_confirmed=false;
  assert.equal((await h.run(a)).email.status,'REVIEW_REQUIRED');
  const [first]=await observer`select id,payload,jsonb_typeof(payload) as shape,attempt_count from parcel_snap.arrival_notices where package_id=${h.input.body.intake_package_id}`;
  assert.equal(first.shape,'object');assert(Array.isArray(first.payload.to));assert.equal(first.attempt_count,0);
  h.input.body.tracking_number='CORRECTED "QUOTE" \\ café';
  assert.equal((await h.run(b)).email.status,'REVIEW_REQUIRED');
  const [updated]=await observer`select id,payload,jsonb_typeof(payload) as shape,attempt_count from parcel_snap.arrival_notices where package_id=${h.input.body.intake_package_id}`;
  const expected=buildArrivalPayload({customer:{name:'Synthetic Recipient',email:'recipient@example.test'},tracking:h.input.body.tracking_number,facility:{name:'Origin',city:'Test City'},companyName:'Synthetic Shipping'});
  assert.equal(updated.id,first.id);assert.equal(updated.shape,'object');assert.equal(updated.attempt_count,0);assert.deepEqual(updated.payload,expected);
  h.input.body.label_confirmed=true;assert.equal((await h.run(a)).email.status,'SENT');assert.equal(h.calls.length,1);
  const sent=JSON.parse(h.calls[0].body),{attachments,...envelope}=sent;
  assert.deepEqual(envelope,expected);assert.equal(attachments.length,1);assert.deepEqual(Buffer.from(attachments[0].content,'base64'),photo);
 });
 await t.test('prepare waits on an advisory lock owned by an independent backend then resumes',async()=>{
  const h=scenario();let release,locked;
  const wait=new Promise(r=>release=r),ready=new Promise(r=>locked=r);
  const owner=a.begin(async tx=>{await tx`select pg_advisory_xact_lock(hashtextextended(${id(1)+'/'+h.input.body.intake_package_id},0))`;locked();await wait;});
  await ready;const request=h.run(b);
  try{let seen=false;for(let n=0;n<250;n++){const rows=await observer`select wait_event_type,wait_event from pg_stat_activity where pid=${pids[1][0].pid}`;if(rows[0]?.wait_event_type==='Lock'&&rows[0]?.wait_event==='advisory'){seen=true;break;}await new Promise(r=>setTimeout(r,20));}assert(seen,'independent backend must visibly wait on the actual advisory lock');}finally{release();}
  await owner;assert.equal((await request).email.status,'SENT');assert.equal(h.calls.length,1);
 });
 await t.test('overlapping complete arrivals on independent connections produce one provider request',async()=>{
  const h=scenario();const results=await Promise.all([h.run(a),h.run(b)]);assert.equal(h.calls.length,1);assert(results.some(x=>x.email.status==='SENT'));
  const rows=await observer`select (select count(*) from parcel_snap.packages where id=${h.input.body.intake_package_id}) as parcels,(select count(*) from parcel_snap.package_photos where package_id=${h.input.body.intake_package_id}) as photos,(select count(*) from parcel_snap.arrival_notices where package_id=${h.input.body.intake_package_id}) as notices`;
  assert.equal(Number(rows[0].parcels),1);assert.equal(Number(rows[0].photos),1);assert.equal(Number(rows[0].notices),1);
 });
 await t.test('concurrent atomic claims return one winner',async()=>{
  const h=scenario();h.input.body.label_confirmed=false;await h.run(a);const [notice]=await a`select * from parcel_snap.arrival_notices where package_id=${h.input.body.intake_package_id}`;
  const wins=await Promise.all([h.repo(a).claim(notice,id(6),customerRevision.contact_revision,h.input.body.tracking_number),h.repo(b).claim(notice,id(6),customerRevision.contact_revision,h.input.body.tracking_number)]);assert.equal(wins.filter(Boolean).length,1);
 });
 await t.test('invalid preflight rejects before parcel, event and ledger writes, then same-ID retry succeeds',async()=>{
  const h=scenario();h.input.body.size_class='INVALID';await assert.rejects(()=>h.run(a),e=>e.status===400);const [r]=await observer`select count(*) as count from parcel_snap.packages where id=${h.input.body.intake_package_id}`;assert.equal(Number(r.count),0);assert.equal(h.calls.length,0);h.input.body.size_class='UNKNOWN';assert.equal((await h.run(b)).email.status,'SENT');
 });
 await t.test('UNKNOWN persists across independent connection/repository and blocks another send',async()=>{
  const h=scenario();h.flags.timeout=true;assert.equal((await h.run(a)).email.status,'UNKNOWN');h.flags.timeout=false;assert.equal((await h.run(b)).email.status,'UNKNOWN');assert.equal(h.calls.length,1);
 });
 await t.test('new synthetic assignment stub returns the final persisted stage/location contract',async()=>{
  // Independently authored test stub; intentionally does not reproduce real warehouse assignment.
  await a.unsafe("create or replace function parcel_snap.assign_suggested_location(uuid,text) returns uuid language plpgsql as $$ begin update parcel_snap.packages set stage='WAREHOUSED', current_location_id='00000088-1111-4111-8111-111111111111'::uuid where id=$1; return '00000088-1111-4111-8111-111111111111'::uuid; end $$").simple();
  const h=scenario(),result=await h.run(a);const [saved]=await observer`select stage,current_location_id from parcel_snap.packages where id=${h.input.body.intake_package_id}`;
  assert.equal(saved.stage,'WAREHOUSED');assert.equal(result.stage,saved.stage);assert.equal(result.assigned_location_id,saved.current_location_id);
 });

});
