import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker,{fields,SCAN_AUTH_FUNCTION} from './worker.mjs';

const origin='https://treylove1.github.io';
const fixture={...Object.fromEntries(fields.map(field=>[field,null])),recipient_name:'SAMPLE RECEIVER',address_line:'123 EXAMPLE AVE',unit:'UNIT 04',city:'SAMPLE CITY',state:'FL',zip:'00331',tracking:'1ZTEST000000000001',confidence:.95};
const env=()=>({VISION_PROVIDER:'openai',OPENAI_API_KEY:'fictional-test-secret',OPENAI_MODEL:'gpt-4o',SUPABASE_URL:'https://auth.example.invalid',SUPABASE_PUBLISHABLE_KEY:'public-test',ALLOWED_ORIGIN:origin,RATE_LIMITER:{limit:async()=>({success:true})}});
const request=(headers={})=>new Request('https://worker.example.invalid/scan',{method:'POST',headers:{Origin:origin,Authorization:'Bearer fictional-user', 'Content-Type':'application/json',...headers},body:JSON.stringify({image_data_url:'data:image/jpeg;base64,AA=='})});
async function mocked(handler,run){const original=globalThis.fetch;globalThis.fetch=handler;try{return await run();}finally{globalThis.fetch=original;}}
const active=()=>Response.json({state:'ACTIVE',company:{role:'OWNER'}});

test('production uses only verified read-only auth before the unchanged OpenAI provider',async()=>{
 const calls=[];
 await mocked(async(url,options)=>{
  calls.push({url,options});
  if(calls.length===1){
   assert.equal(url,'https://auth.example.invalid/functions/v1/'+SCAN_AUTH_FUNCTION);
   assert.equal(options.method,'POST');assert.equal(options.body,'{}');assert.equal(options.redirect,'error');
   assert.equal(options.headers.Authorization,'Bearer fictional-user');assert.equal(options.headers.apikey,'public-test');
   assert.ok(options.signal instanceof AbortSignal);return active();
  }
  assert.equal(url,'https://api.openai.com/v1/chat/completions');
  const body=JSON.parse(options.body);assert.equal(body.model,'gpt-4o');assert.equal(body.max_completion_tokens,1000);
  assert.equal(body.response_format.json_schema.strict,true);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(fixture)}}]});
 },async()=>{
  const response=await worker.fetch(request(),env()),body=await response.json();
  assert.equal(response.status,200);assert.equal(calls.length,2);assert.deepEqual(body.result,fixture);
  assert.equal(body.provider,'openai');assert.equal(body.model,'gpt-4o');assert.equal(body.model_attempts,1);assert.equal(body.needs_review,true);
  assert.ok(Array.isArray(body.review_warnings));assert.ok(body.timing_ms.authorization>=0);
 });
});
test('existing production default remains OpenAI even if Cloudflare code is available',async()=>{
 const bindings=env();delete bindings.VISION_PROVIDER;bindings.AI={run(){assert.fail('must not switch providers')}};
 await mocked(async url=>url.includes('/functions/v1/')?active():Response.json({choices:[{message:{content:JSON.stringify(fixture)}}]}),async()=>{
  assert.equal((await (await worker.fetch(request(),bindings)).json()).provider,'openai');
 });
});
test('production and staging fail closed for missing auth or rate-limit bindings',async()=>{
 await mocked(()=>assert.fail('no external request expected'),async()=>{
  for(const missing of ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','RATE_LIMITER']){
   const bindings=env();delete bindings[missing];
   const response=await worker.fetch(request(),bindings);assert.equal(response.status,503);
   assert.equal((await response.json()).error,'SCAN_BINDINGS_NOT_CONFIGURED');
  }
 });
});
test('auth denial, invalid roles, unavailable service and malformed responses never reach inference',async()=>{
 const scenarios=[
  {reply:()=>Response.json({error:'ACCESS_DENIED'},{status:403}),status:403},
  {reply:()=>Response.json({state:'ACTIVE',company:{role:'CUSTOMER'}}),status:403},
  {reply:()=>Response.json({state:'ACTIVE',company:{role:'DRIVER'}}),status:403},
  {reply:()=>Response.json({state:'PAYMENT_REQUIRED',company:{role:'OWNER'}}),status:403},
  {reply:()=>Response.json({error:'AUTHORIZATION_UNAVAILABLE'},{status:503}),status:503},
  {reply:()=>new Response('not json'),status:503},
  {reply:()=>Response.json(null),status:503},
  {reply:()=>Response.json([]),status:503},
  {reply:()=>{throw Error('network error');},status:503}
 ];
 for(const scenario of scenarios){let count=0;await mocked(async url=>{count++;assert.ok(url.endsWith('/'+SCAN_AUTH_FUNCTION));return scenario.reply();},async()=>{const response=await worker.fetch(request(),env());assert.equal(response.status,scenario.status);assert.equal(count,1);});}
});
test('public apikey compatibility never authorizes a missing bearer session',async()=>{
 await mocked(()=>assert.fail('must not call auth or inference'),async()=>{
  const r=request({apikey:'public-test'});r.headers.delete('Authorization');
  assert.equal((await worker.fetch(r,env())).status,401);
 });
});
test('preflight supports browser adapter headers only for the configured origin',async()=>{
 await mocked(()=>assert.fail('preflight must not make network requests'),async()=>{
  const requestHeaders={Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type,apikey'};
  const response=await worker.fetch(new Request('https://worker.example.invalid/scan',{method:'OPTIONS',headers:requestHeaders}),env());
  assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
  assert.match(response.headers.get('Access-Control-Allow-Headers'),/apikey/);
  const denied=await worker.fetch(new Request('https://worker.example.invalid/scan',{method:'OPTIONS',headers:{...requestHeaders,Origin:'https://other.invalid'}}),env());
  assert.equal(denied.status,403);
 });
});
test('rate-limited requests never call the model and do not fall back to another provider',async()=>{
 const bindings=env();bindings.RATE_LIMITER={limit:async()=>({success:false})};let calls=0;
 await mocked(async url=>{calls++;assert.ok(url.endsWith('/'+SCAN_AUTH_FUNCTION));return active();},async()=>{const response=await worker.fetch(request(),bindings);assert.equal(response.status,429);assert.equal(calls,1);});
});
test('OpenAI truncation, refusal and quota errors remain review failures with no retry',async()=>{
 for(const scenario of [
  {reply:()=>Response.json({choices:[{finish_reason:'length',message:{content:JSON.stringify(fixture)}}]}),error:'VISION_TRUNCATED',status:502},
  {reply:()=>Response.json({choices:[{message:{refusal:'cannot read'}}]}),error:'VISION_REFUSED',status:422},
  {reply:()=>Response.json({error:{code:'insufficient_quota'}},{status:429}),error:'OpenAI API credits unavailable — check API billing',status:502}
 ]){let calls=0;await mocked(async url=>{calls++;return url.includes('/functions/v1/')?active():scenario.reply();},async()=>{const response=await worker.fetch(request(),env());assert.equal(response.status,scenario.status);assert.equal((await response.json()).error,scenario.error);assert.equal(calls,2);});}
});
test('Worker source cannot dispatch the mutating workspace or notify/save routes',()=>{
 const source=readFileSync(new URL('./worker.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/parcel-snap-portal|action\s*:\s*['"]workspace['"]|send_notification|receive_package/);
});
