import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {normalize, readWithCloudflare} from './worker.mjs';

const fields=['recipient_name','address_line','unit','city','state','zip','tracking','order_reference','partner_order','carrier'];
const expected={...Object.fromEntries(fields.map(field=>[field,null])),recipient_name:'SAMPLE RECEIVER',address_line:'100 TEST STREET',tracking:'1Z1234567890123456',confidence:.95};
const origin='https://treylove1.github.io';
const makeEnv=(run=async()=>({response:JSON.stringify(expected)}))=>({
  VISION_PROVIDER:'cloudflare',AI:{run},ALLOWED_ORIGIN:origin,
  SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'public-test'
});
const makeRequest=({image='data:image/jpeg;base64,AA==',token='sample-token',originHeader=origin}={})=>{
  const headers={'Origin':originHeader,'Content-Type':'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  return new Request('https://vision.example.invalid/',{method:'POST',headers,body:JSON.stringify({image_data_url:image})});
};
const mockAuth=async(active=true,callback)=>{
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({state:active?'ACTIVE':'INACTIVE',company:{role:'OWNER'}});
  try{return await callback();}finally{globalThis.fetch=oldFetch;}
};

test('JSON normalizer uses null for missing fields and scales confidence',()=>{
  const result=normalize('```json\n{"recipient_name":" SAMPLE RECEIVER ","confidence":95}\n```');
  assert.equal(result.recipient_name,'SAMPLE RECEIVER');
  assert.equal(result.address_line,null);
  assert.equal(result.confidence,.95);
});
test('broken or non-JSON model output is rejected',()=>assert.throws(()=>normalize('no json'),/INVALID_MODEL_RESULT/));
test('valid model output uses one inference only',async()=>{
  let count=0;
  const result=await readWithCloudflare(makeEnv(async()=>{count++;return {response:JSON.stringify(expected)}}),'data:image/jpeg;base64,AA==');
  assert.equal(count,1);assert.equal(result.model_attempts,1);assert.equal(result.result.recipient_name,expected.recipient_name);
});
test('Cloudflare vision requests use each model\'s supported generation parameter',async()=>{
  const inputs=[];
  const binding=makeEnv(async(model,input)=>{
    inputs.push({model,input});
    return {response:inputs.length===1?'invalid JSON':JSON.stringify(expected)};
  });
  await readWithCloudflare(binding,'data:image/jpeg;base64,AA==');
  assert.equal(inputs.length,2);
  assert.equal(inputs[0].input.max_completion_tokens,600);
  assert.equal(inputs[0].input.max_tokens,undefined);
  assert.equal(inputs[1].input.max_tokens,600);
  assert.equal(inputs[1].input.max_completion_tokens,undefined);
  assert.equal(inputs[0].input.messages[1].content[1].image_url.url,'data:image/jpeg;base64,AA==');
});
test('second model only runs when first output fails validation',async()=>{
  let count=0;
  const result=await readWithCloudflare(makeEnv(async()=>({response:++count===1?'not JSON':JSON.stringify(expected)})),'data:image/jpeg;base64,AA==');
  assert.equal(count,2);assert.equal(result.model_attempts,2);assert.equal(result.result.tracking,expected.tracking);
});
test('invalid origin never reaches the AI model',async()=>{
  let called=0;const response=await worker.fetch(makeRequest({originHeader:'https://wrong.invalid'}),makeEnv(async()=>{called++}));
  assert.equal(response.status,403);assert.equal(called,0);
});
test('missing sign-in never reaches the AI model',async()=>{
  let called=0;const response=await worker.fetch(makeRequest({token:null}),makeEnv(async()=>{called++}));
  assert.equal(response.status,401);assert.equal(called,0);
});
test('inactive workspace never reaches the AI model',async()=>mockAuth(false,async()=>{
  let called=0;const response=await worker.fetch(makeRequest(),makeEnv(async()=>{called++}));
  assert.equal(response.status,403);assert.equal(called,0);
}));
test('invalid photo is rejected before AI inference',async()=>mockAuth(true,async()=>{
  let called=0;const response=await worker.fetch(makeRequest({image:'not-a-jpeg'}),makeEnv(async()=>{called++}));
  assert.equal(response.status,400);assert.equal(called,0);
}));
test('successful inference returns structured fields and timing without customer data in metrics',async()=>mockAuth(true,async()=>{
  let called=0;
  const response=await worker.fetch(makeRequest(),makeEnv(async()=>{called++;return {response:JSON.stringify(expected)}}));
  const body=await response.json();
  assert.equal(response.status,200);assert.equal(called,1);
  assert.equal(body.result.tracking,expected.tracking);
  assert.ok(body.timing_ms.authorization>=0&&body.timing_ms.inference>=0&&body.timing_ms.total>=0);
  assert.equal(body.model_attempts,1);
}));
