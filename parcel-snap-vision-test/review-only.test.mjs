import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('manual receive exits before state changes or API calls in camera review mode',async()=>{
  const source=readFileSync(new URL('./app.js',import.meta.url),'utf8');
  const start=source.indexOf('async function receivePackage(){');
  assert.ok(start>=0);
  const guardEnd=source.indexOf('if(receiveInFlight)return;',start);
  assert.ok(guardEnd>start);
  const message={textContent:''};
  // No receiveInFlight, API or other production globals exist: reaching them fails.
  const context=vm.createContext({window:{PARCEL_SNAP_REVIEW_ONLY:true},$:id=>{
    assert.equal(id,'receiveResult');return message;
  }});
  await vm.runInContext(source.slice(start,guardEnd)+'throw Error("WRITE_PATH_REACHED");}\nreceivePackage();',context);
  assert.match(message.textContent,/saving and notifications are disabled/);
});

test('provider exceptions never log raw provider message or label text',async()=>{
  const {readWithCloudflare}=await import('../parcel-snap-vision-proxy/worker.mjs');
  const logs=[];const original=console.error;
  console.error=(...args)=>logs.push(args.join(' '));
  try{
    await assert.rejects(readWithCloudflare({AI:{run:async()=>{throw Error('PRIVATE_LABEL_AND_TOKEN');}}},'data:image/jpeg;base64,AA=='));
  }finally{console.error=original;}
  assert.equal(logs.length,2);
  assert.ok(logs.every(line=>!line.includes('PRIVATE_LABEL_AND_TOKEN')));
});


test('camera fallback preserves all four photo edges and closes decoded image',async()=>{
 const source=readFileSync(new URL('./vision-client.js',import.meta.url),'utf8');
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const helper=source.slice(source.indexOf(' async function fullFrameFallback'),source.indexOf(' function trackingFromBarcode'));
 const draw=app.slice(app.indexOf('function drawImageRegionCanvas'),app.indexOf('function drawImageRegion(',app.indexOf('function drawImageRegionCanvas')));
 let closed=false,drawn;
 const bitmap={width:3200,height:2000,close(){closed=true;}};
 const canvas={getContext(){return {drawImage(...args){drawn=args;}};}};
 const ctx=vm.createContext({createImageBitmap:async()=>bitmap,document:{createElement(){return canvas;}},detectBrightLabelRegion(){assert.fail('must not crop label');}});
 vm.runInContext(draw+helper,ctx);
 const actual=await vm.runInContext('fullFrameFallback({})',ctx);
 assert.equal(actual,canvas);assert.deepEqual(drawn.slice(1),[0,0,3200,2000,0,0,2400,1500]);assert.equal(closed,true);
});
