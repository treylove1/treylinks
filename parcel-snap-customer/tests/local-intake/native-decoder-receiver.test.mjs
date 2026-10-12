import test from 'node:test';
import assert from 'node:assert/strict';
import {FreeIntakeReader} from '../../free-intake-reader.mjs';

// Arrow-function decoder fixtures cannot detect WebIDL receiver violations.
// This regular function deliberately requires the real global receiver.
function installReceiverCheckedDecoder(t,{reject=false}={}){
  const original=Object.getOwnPropertyDescriptor(globalThis,'createImageBitmap');
  const calls=[],closed=[];
  Object.defineProperty(globalThis,'createImageBitmap',{configurable:true,writable:true,
    value:async function(input){
      assert.equal(this,globalThis,'createImageBitmap must receive the browser global, not FreeIntakeReader');
      calls.push(input);
      if(reject)throw new Error('The source image could not be decoded.');
      return {width:10,height:4,close(){closed.push(input);}};
    }});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'createImageBitmap',original);else delete globalThis.createImageBitmap;});
  return {calls,closed};
}
const file=()=>new File([new Uint8Array([1,2,3])],'fictional.jpg',{type:'image/jpeg'});
const noRuntime=()=>{throw new Error('A photo decode must not load the OCR runtime.');};

test('default photo decoder calls createImageBitmap with its global receiver',async t=>{
  const effects=installReceiverCheckedDecoder(t),input=file();
  const reader=new FreeIntakeReader({loadRuntime:noRuntime});
  const photo=await reader.open(input,{photoId:'fictional'});
  assert.equal(photo.id,'fictional');
  assert.equal(photo.width,10);assert.equal(photo.height,4);
  assert.match(photo.sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(effects.calls,[input]);assert.deepEqual(effects.closed,[input]);
  assert.equal(reader.engine.runtimePromise,null);assert.equal(reader.busy,false);
});

test('default read decoder also preserves the global receiver and closes the bitmap',async t=>{
  const effects=installReceiverCheckedDecoder(t),input=file(),stop=new Error('Stop before OCR.');
  let draws=0;
  const reader=new FreeIntakeReader({loadRuntime:noRuntime,
    makeCanvas:()=>({width:0,height:0,getContext:()=>({drawImage(){draws++;}})}),
    capturePreview:async()=>{throw stop;}});
  await reader.open(input);
  await assert.rejects(reader.read(),error=>error===stop);
  assert.deepEqual(effects.calls,[input,input]);assert.deepEqual(effects.closed,[input,input]);
  assert.equal(draws,1);assert.equal(reader.busy,false);assert.equal(reader.passCount,0);
  assert.equal(reader.engine.runtimePromise,null);
});

test('a genuine default decode failure leaves no photo or OCR runtime',async t=>{
  const effects=installReceiverCheckedDecoder(t,{reject:true});
  const reader=new FreeIntakeReader({loadRuntime:noRuntime});
  await assert.rejects(reader.open(file()),/source image could not be decoded/);
  assert.equal(effects.calls.length,1);assert.equal(effects.closed.length,0);
  assert.equal(reader.photo,null);assert.equal(reader.busy,false);
  assert.equal(reader.engine.runtimePromise,null);
});

test('an explicitly injected decoder remains supported without a browser global',async()=>{
  let calls=0,closed=0;
  const reader=new FreeIntakeReader({loadRuntime:noRuntime,decode:async()=>{
    calls++;return {width:10,height:4,close(){closed++;}};
  }});
  await reader.open(file());
  assert.equal(calls,1);assert.equal(closed,1);assert.equal(reader.engine.runtimePromise,null);
});
