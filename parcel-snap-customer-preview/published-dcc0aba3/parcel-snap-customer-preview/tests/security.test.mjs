import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {handle as rawHandle,AUTH_URL,CSP} from '../dist/worker.mjs';
import {build,sha256,transform,APP_FILES} from '../build.mjs';
const handle=(request,transport)=>rawHandle(request,transport,{limit:async()=>({success:true})});
const origin='https://fictional-preview.example.invalid';
const mockJWT='fixture.header.signature';
const request=(body={action:'workspace'},options={})=>new Request(origin+(options.path||'/portal'),{method:options.method||'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+mockJWT,...options.headers},body:JSON.stringify(body)});
const forbidden=()=>{throw Error('Unexpected external call');};

test('blank and non-JWT tokens cannot reach fictional workspace or auth endpoint',async()=>{
  for(const token of ['', 'Bearer fake','Bearer null','Bearer ..','Bearer a.b.c extra']){
    const r=await handle(request(undefined,{headers:{Authorization:token}}),forbidden);assert.equal(r.status,401);
    assert.equal((await r.json()).error,'PREVIEW_AUTH_REQUIRED');
  }
});
test('JWT-looking fake token never grants workspace when real verifier rejects it',async()=>{
  let calls=0;const r=await handle(request(),async url=>{calls++;assert.equal(url,AUTH_URL);return Response.json({error:'invalid JWT'},{status:401});});
  assert.equal(calls,1);assert.equal(r.status,403);assert(!(await r.text()).includes('customers'));
});
test('only ACTIVE allowed-role verifier response yields fictional workspace; real metadata is discarded',async()=>{
  for(const value of [{},{state:'ACTIVE',company:{role:'CUSTOMER'}},{state:'PAYMENT_REQUIRED',company:{role:'OWNER'}}])assert.equal((await handle(request(),async()=>Response.json(value))).status,403);
  let calls=0;
  const r=await handle(request(),async(url,options)=>{calls++;assert.equal(url,AUTH_URL);assert.equal(options.redirect,'error');assert.equal(options.body,'{}');assert.equal(options.headers.Authorization,'Bearer '+mockJWT);assert(options.headers.apikey.startsWith('sb_publishable_'));assert(!('Origin' in options.headers));return Response.json({state:'ACTIVE',company:{role:'OWNER',name:'REAL PRIVATE COMPANY'},customers:[{email:'private@real.example'}]});});
  const value=await r.json();assert.equal(calls,1);assert.equal(value.state,'ACTIVE');assert.equal(value.preview.fictional,true);assert.equal(value.company.name,'FICTIONAL Parcel Snap Preview');assert(!JSON.stringify(value).includes('REAL PRIVATE'));assert(!JSON.stringify(value).includes('private@real'));
});
test('auth failures are fail-closed and do not expose exception or credential text',async()=>{
  const r=await handle(request(),async()=>{throw Error('sensitive-token-details');});assert.equal(r.status,503);assert(!(await r.text()).includes('sensitive'));
});
test('server denies unapproved actions, raw private data and out-of-fixture IDs before auth',async()=>{
  const bad=[{action:'onboard'},{action:'create_staff_invite'},{action:'send_email'},{action:'save_business_profile'},{action:'workspace',photo_data_url:'PRIVATE'},
    {action:'create_customer',fixture_customer:'real-customer'}, {action:'create_customer',fixture_customer:'fixture-customer-alex',email:'real@email.test'},
    {action:'receive_package',fixture_customer:'fixture-customer-jordan',fixture_facility:'real-facility',confirmed:true},
    {action:'destination_arrival',fixture_package:'real-package',fixture_facility:'fixture-destination',confirmed:true}];
  for(const body of bad)assert.equal((await handle(request(body),forbidden)).status,403);
});
test('server prevents cross-origin and missing-origin requests without wildcard CORS',async()=>{
  for(const value of ['', 'https://evil.example.invalid']){
    const r=await handle(request(undefined,{headers:{Origin:value}}),forbidden);assert.equal(r.status,403);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
  }
  assert.equal((await handle(request(undefined,{headers:{'Sec-Fetch-Site':'cross-site'}}),forbidden)).status,403);
});
test('server body cap applies to streamed requests, invalid JSON and content types',async()=>{
  assert.equal((await handle(request({action:'workspace',extra:'x'.repeat(2048)}),forbidden)).status,400);
  assert.equal((await handle(request(undefined,{headers:{'Content-Type':'text/plain'}}),forbidden)).status,400);
  const req=new Request(origin+'/portal',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{'});assert.equal((await handle(req,forbidden)).status,400);
});
test('every allowed simulated write rechecks auth and never saves photos or sends notifications',async()=>{
  const actions=[{action:'create_customer',fixture_customer:'fixture-customer-alex'},
    {action:'receive_package',fixture_customer:'fixture-customer-jordan',fixture_facility:'fixture-origin',confirmed:true},
    {action:'destination_arrival',fixture_package:'fixture-package-jordan',fixture_facility:'fixture-destination',confirmed:true}];
  let calls=0;
  for(const body of actions){const r=await handle(request(body),async url=>{calls++;assert.equal(url,AUTH_URL);return Response.json({state:'ACTIVE',company:{role:'STAFF'}});});assert.equal(r.status,200);const data=await r.json();assert.equal(data.simulated,true);assert.equal(data.persisted,false);assert.equal(data.notifications_sent,0);if(body.action!=='create_customer'){assert.equal(data.photo_saved,false);assert.equal(data.email.status,'SIMULATED_DISABLED');}}
  assert.equal(calls,actions.length);
  const fresh=await handle(request(),async()=>Response.json({state:'ACTIVE',company:{role:'OWNER'}}));assert.equal((await fresh.json()).customers.length,1);
});
test('/scan never calls auth/model or consumes request body, regardless of token',async()=>{
  const req=request({image_data_url:'PRIVATE_PHOTO'},{path:'/scan'});const r=await handle(req,forbidden);assert.equal(r.status,403);assert.equal(req.bodyUsed,false);assert.equal((await r.json()).error,'PREVIEW_INFERENCE_TEST_NOT_APPROVED');
});
test('asset route is closed; all responses carry defensive CSP and no-store',async()=>{
  for(const path of ['/','/app.js?v=20261008-ocr','/preview-bootstrap.js']){const r=await handle(new Request(origin+path),forbidden);assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Content-Security-Policy'),CSP);}
  for(const path of ['/backend/portal.ts','/sources.lock.json','/metadata.proposal.json','/../secrets','/eng.traineddata','/functions/v1/parcel-snap-portal'])assert.equal((await handle(new Request(origin+path),forbidden)).status,404);
  assert(CSP.includes("form-action 'none'"));assert(CSP.includes("frame-ancestors 'none'"));assert(!CSP.includes('/functions/v1/'));assert(!CSP.includes('api.openai.com'));assert(!CSP.includes('https: '));
});
test('build only transforms reviewed constants/markup and is deterministic',()=>{
  const first=build({write:false}),second=build({write:false});assert.deepEqual(first,second);
  const manifest=JSON.parse(readFileSync(new URL('../dist/MANIFEST.json',import.meta.url)));
  assert.deepEqual(manifest.source_files.map(x=>x.name),APP_FILES);
  for(const entry of manifest.source_files){const original=readFileSync(new URL('../../parcel-snap-customer/'+entry.name,import.meta.url),'utf8');const output=readFileSync(new URL('../dist/public/'+entry.name,import.meta.url),'utf8');assert.equal(sha256(original),entry.original_sha256);let reversed=output;for(const change of [...entry.transformations].reverse())reversed=reversed.replace(change.to,change.from);assert.equal(reversed,original);}
  assert.deepEqual(readdirSync(new URL('../dist/public/',import.meta.url)).sort(),[...APP_FILES,'preview-bootstrap.js','preview-policy.js','preview.css'].sort());
});
test('changed or unexpected transport patterns fail before generating assets',()=>{
  const app=readFileSync(new URL('../../parcel-snap-customer/app.js',import.meta.url),'utf8');
  assert.throws(()=>transform('app.js',app.replace('const PORTAL_API=','let PORTAL_API=')),/Unexpected/);
  assert.throws(()=>transform('app.js',app+'\nfetch("https://evil.invalid");'),/Unexpected/);
  assert.throws(()=>transform('known-customer-matcher.js','fetch("anything")'),/Unexpected/);
});
test('proposal inherits existing secret/rate bindings without new resources or AI/storage/email bindings',()=>{
  const metadata=JSON.parse(readFileSync(new URL('../metadata.proposal.json',import.meta.url)));
  assert.deepEqual(metadata.bindings.map(b=>b.name),['OPENAI_API_KEY','RATE_LIMITER','VISION_PROVIDER','OPENAI_MODEL']);assert.equal(metadata.bindings[0].type,'inherit');assert.equal(metadata.bindings[0].version_id,'2c980fc3-0c50-4267-a624-cf3fa7177ffe');
});

test('missing/denied/error inherited limiter fails closed before read-only auth',async()=>{
  assert.equal((await rawHandle(request(),forbidden)).status,503);
  assert.equal((await rawHandle(request(),forbidden,{limit:async()=>({success:false})})).status,429);
  assert.equal((await rawHandle(request(),forbidden,{limit:async()=>{throw Error('limiter failure');}})).status,503);
});
test('limiter uses only a preview-prefixed bearer digest and runs before auth',async()=>{
  const events=[],keys=[];
  const result=await rawHandle(request(),async()=>{events.push('auth');return Response.json({state:'ACTIVE',company:{role:'OWNER'}});},{limit:async value=>{events.push('limit');keys.push(value.key);return {success:true};}});
  assert.equal(result.status,200);assert.deepEqual(events,['limit','limit','auth']);assert.equal(keys[0],'preview-fixture-v1:aggregate');assert.match(keys[1],/^preview-fixture-v1:[0-9a-f]{64}$/);assert(!keys[1].includes(mockJWT));
});

test('rotating JWT-shaped input always shares the isolated preview aggregate bucket',async()=>{
  const keys=[];for(const token of ['a.b.one','a.b.two']){
    const r=await rawHandle(request(undefined,{headers:{Authorization:'Bearer '+token}}),forbidden,{limit:async value=>{keys.push(value.key);return {success:false};}});assert.equal(r.status,429);
  }
  assert.deepEqual(keys,['preview-fixture-v1:aggregate','preview-fixture-v1:aggregate']);
});
