import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const origin='https://camera-staging.example';
const env={STAGING_SCAN_ONLY:'true',VISION_PROVIDER:'cloudflare',ALLOWED_ORIGIN:origin};
test('staging exposes only page, health and authenticated scan routes',async()=>{
 const page=await worker.fetch(new Request(origin),env);
 assert.equal(page.headers.get('Content-Type'),'text/html; charset=utf-8');
 assert.match(await page.text(),/No parcel saves, customer changes or notifications/);
 for(const path of ['/receive','/customers','/notify','/functions/v1/parcel-snap-portal']){
  const r=await worker.fetch(new Request(origin+path,{method:'POST',headers:{Origin:origin}}),env);
  assert.equal(r.status,404);
 }
 const r=await worker.fetch(new Request(origin+'/scan',{method:'POST',headers:{Origin:origin}}),env);
 assert.equal(r.status,401);assert.equal((await r.json()).error,'SIGN_IN_REQUIRED');
});
test('staging fails closed without limiter even with an AI binding and bearer header',async()=>{
 let called=false;
 const r=await worker.fetch(new Request(origin+'/scan',{method:'POST',headers:{Origin:origin,Authorization:'Bearer test-only'}}),{...env,AI:{run(){called=true;}},SUPABASE_URL:'https://auth.example',SUPABASE_PUBLISHABLE_KEY:'public'});
 assert.equal(r.status,503);assert.equal(called,false);
});
