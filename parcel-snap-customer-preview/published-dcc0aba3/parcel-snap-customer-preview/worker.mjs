import {assets} from './assets.mjs';
import './preview-policy.js';
const policy=globalThis.ParcelSnapPreviewPolicy;
export const AUTH_URL='https://evjoitqnogmpedrulepv.supabase.co/functions/v1/parcel-snap-camera-auth-staging-20261008';
const PUBLIC_KEY='sb_publishable_wv2cDeErfEorwoGCLl9rMA_yo01I01X';
export const CSP=[
  "default-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'none'", "object-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2 https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0/",
  "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://evjoitqnogmpedrulepv.supabase.co/auth/v1/token https://evjoitqnogmpedrulepv.supabase.co/auth/v1/logout https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0/ https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz"
].join('; ');
function headers(type='application/json; charset=utf-8'){
  return {'Content-Type':type,'Content-Security-Policy':CSP,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    'Permissions-Policy':'camera=(self), microphone=(), geolocation=(), payment=()','Cross-Origin-Resource-Policy':'same-origin','X-Frame-Options':'DENY'};
}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:headers()});
const reject=(error,status=403)=>json({error,preview:true},status);
async function smallJSON(request){
  if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type')||''))throw Error('BAD_REQUEST');
  if(Number(request.headers.get('Content-Length')||0)>1024)throw Error('BODY_TOO_LARGE');
  if(!request.body)throw Error('BAD_REQUEST');
  const reader=request.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024){await reader.cancel();throw Error('BODY_TOO_LARGE');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
// Dependency injection exists only for mock tests. The production export always uses global fetch.
export async function handle(request,transport=fetch,limiter){
  const url=new URL(request.url);
  if(url.search && !['/app.js','/vision-client.js','/vision-result.js'].includes(url.pathname))return reject('QUERY_NOT_ALLOWED',400);
  if(url.pathname==='/scan')return reject('PREVIEW_INFERENCE_TEST_NOT_APPROVED'); // Never parse photo, call auth, or contact provider.
  if(url.pathname==='/portal'){
    if(request.method!=='POST')return reject('METHOD_NOT_ALLOWED',405);
    if(request.headers.get('Origin')!==url.origin)return reject('PREVIEW_SAME_ORIGIN_REQUIRED');
    if(request.headers.get('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site')!=='same-origin')return reject('PREVIEW_SAME_ORIGIN_REQUIRED');
    let body;try{body=await smallJSON(request);}catch{return reject('PREVIEW_INVALID_BODY',400);}
    if(!policy.valid(body))return reject('PREVIEW_ACTION_NOT_ALLOWED');
    const authorization=request.headers.get('Authorization')||'';
    // Format validation is not authentication. Every valid-looking token is verified by the read-only endpoint.
    if(authorization.length>8192 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization))return reject('PREVIEW_AUTH_REQUIRED',401);
    // Inherit the existing binding; prefix + digest avoids production-key collision and raw-token storage.
    if(!limiter || typeof limiter.limit!=='function')return reject('PREVIEW_RATE_LIMITER_UNAVAILABLE',503);
    try{
      const aggregate=await limiter.limit({key:'preview-fixture-v1:aggregate'});
      if(aggregate?.success!==true)return reject('PREVIEW_RATE_LIMITED',429);
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(authorization));
      const key='preview-fixture-v1:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
      const limited=await limiter.limit({key});
      if(limited?.success!==true)return reject('PREVIEW_RATE_LIMITED',429);
    }catch{return reject('PREVIEW_RATE_LIMITER_UNAVAILABLE',503);}
    let allowed;
    try{
      const response=await transport(AUTH_URL,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','Authorization':authorization,'apikey':PUBLIC_KEY},body:'{}',signal:AbortSignal.timeout(10000)});
      if(!response.ok)return reject('PREVIEW_AUTH_DENIED',403);
      allowed=await response.json();
    }catch{return reject('PREVIEW_AUTH_UNAVAILABLE',503);}
    if(allowed?.state!=='ACTIVE'||!['OWNER','MANAGER','STAFF','WAREHOUSE'].includes(allowed?.company?.role))return reject('PREVIEW_AUTH_DENIED',403);
    return json(policy.result(body,allowed.company.role));
  }
  if(!['GET','HEAD'].includes(request.method))return reject('METHOD_NOT_ALLOWED',405);
  const asset=assets[url.pathname==='/'?'/index.html':url.pathname];
  if(!asset)return reject('NOT_FOUND',404);
  return new Response(request.method==='HEAD'?null:asset.body,{headers:headers(asset.type)});
}
export default {fetch(request,env){return handle(request,fetch,env?.RATE_LIMITER);}};
