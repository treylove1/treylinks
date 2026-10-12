import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {FreeIntakeReader,digest} from '../../free-intake-reader.mjs';
import {PaddleReaderEngine,PADDLE_PARAMS} from '../../local-reader/paddle-reader.js';
import {projectPaddleLabelBlocks} from '../../paddle-label-blocks.js';
if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto});
// Every runtime, worker, image and canvas below is fictional. No model is loaded.
const file=(name='fictional.jpg')=>({name,type:'image/jpeg',size:3,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const topFields=['preparationMs','runtimeModuleMs','workerInitializeMs','predictionRoundTripMs','engineTotalMs','envelopeCheckMs','hardCleanupMs','parserMs','readerTotalMs'];
const nativeFields=['nativeDetectionMs','nativeRecognitionMs','nativeTotalMs'];
const ticks=()=>[0,10,12,20,21,50,52,105,106,110,111,115,116,118,130];
function stagedClock(values=ticks()){
 const remaining=[...values],seen=[];
 return {now:()=>{assert(remaining.length,'unexpected extra clock read');const value=remaining.shift();seen.push(value);return value;},remaining,seen};
}
function fixture({now=(()=>{let n=0;return ()=>++n;})(),metrics={detMs:31,recMs:13,totalMs:46},load,predict,projector}={}){
 const effects={workers:0,terminated:0,initialize:0,predict:0,load:0,decode:0,closed:0,params:[]};
 function envelope(input){
  const poly=[[0,0],[10,0],[10,2],[0,2]],item={poly,text:'Fictional',score:.9};
  return {results:[{image:{width:input.width,height:input.height},items:[item],...(metrics===undefined?{}:{metrics})}],
   rawMethodReturns:{detection:[[{srcW:input.width,srcH:input.height,boxes:[{poly}]}]],recognition:[[{text:item.text,score:item.score}]]},
   input:{width:input.width,height:input.height,pixelSha256:input.pixelSha256,sourceSha256:input.sourceSha256},runtime:{sdk:'fictional',calls:1}};
 }
 const runtime={createRuntime({onWorker}){effects.workers++;const worker={terminate(){effects.terminated++;}};onWorker(worker);return {
  initialize:async()=>{effects.initialize++;},terminate:()=>worker.terminate(),getInitializationSummary:()=>({fictional:true}),
  predict:async(input,params)=>{effects.predict++;effects.params.push(params);return predict?predict(input,envelope):envelope(input);}
 };}};
 const reader=new FreeIntakeReader({now,loadRuntime:()=>{effects.load++;return load?load(runtime):runtime;},
  loadProjector:projector||(()=>({projectPaddleLabelBlocks})),
  decode:async()=>{effects.decode++;return {width:10,height:4,close(){effects.closed++;}};},
  makeCanvas:()=>({width:0,height:0,getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(160)})})}),
  capturePreview:async()=>new Blob(['fictional-png']),hash:digest});
 return {reader,effects,runtime,envelope};
}
async function read(f,id='fictional'){await f.reader.open(file(),{photoId:id});return (await f.reader.read()).observation;}
function assertNumericShape(timing){
 for(const key of topFields)assert(timing[key]===null||(typeof timing[key]==='number'&&Number.isFinite(timing[key])&&timing[key]>=0),key);
 for(const key of nativeFields)assert(timing.nativeMetrics[key]===null||(typeof timing.nativeMetrics[key]==='number'&&Number.isFinite(timing.nativeMetrics[key])&&timing.nativeMetrics[key]>=0),key);
}

test('staged monotonic clock measures actual adapter stages including completed hard cleanup',async()=>{
 const clock=stagedClock(),f=fixture({now:clock.now}),o=await read(f),t=o.timing;
 assert.deepEqual(Object.fromEntries(topFields.map(k=>[k,t[k]])),{
  preparationMs:10,runtimeModuleMs:8,workerInitializeMs:29,predictionRoundTripMs:53,engineTotalMs:104,envelopeCheckMs:4,hardCleanupMs:4,parserMs:12,readerTotalMs:130});
 assert.deepEqual(t.nativeMetrics,{nativeDetectionMs:31,nativeRecognitionMs:13,nativeTotalMs:46});
 assert.equal(t.schema,'parcel-snap-local-timing-v1');assert.equal(t.units,'ms');assert.equal(t.clock,'local-monotonic');
 assert.match(t.nesting,/Nonadditive/);assert.match(t.nesting,/within readerTotalMs/);assert.match(t.readerScope,/excludes final evidence size validation, recursive freeze and UI rendering/);
 assert.equal(o.elapsedSeconds,.13);assertNumericShape(t);assert.equal(clock.remaining.length,0);
 assert.equal(f.effects.workers,1);assert.equal(f.effects.terminated,1);assert.equal(f.effects.initialize,1);assert.equal(f.effects.predict,1);
 assert.equal(f.effects.params[0],PADDLE_PARAMS);assert.equal(f.reader.busy,false);
 // No labels turn a module-promise reuse or a quick measurement into cache inference.
 assert(!/cold|warm|cache/i.test(JSON.stringify(t)));
});

test('timings are immutable source-bound side data, excluded from the exact raw-result hash',async()=>{
 const a=await read(fixture({now:stagedClock().now})),b=await read(fixture({now:stagedClock(ticks().map(v=>1000+v*2)).now}));
 assert.deepEqual(a.raw,b.raw);assert.deepEqual(a.rows,b.rows);assert.deepEqual(a.proposals,b.proposals);assert.deepEqual(a.fields,b.fields);
 assert.deepEqual(a.preparation,b.preparation);assert.deepEqual(a.engine,b.engine);assert.notDeepEqual(a.timing,b.timing);
 assert.equal(a.rawResultSha256,b.rawResultSha256);
 assert.equal(a.rawResultSha256,await digest(new TextEncoder().encode(JSON.stringify(a.raw))));
 assert.equal(a.photoSha256,await digest(await file().arrayBuffer()));
 assert.equal(a.preparation.pixelSha256,await digest(new Uint8ClampedArray(160)));
 assert.equal(a.proposals.observation.photoSha256,a.photoSha256);assert.equal(a.proposals.observation.rawResultSha256,a.rawResultSha256);
 assert(Object.isFrozen(a));assert(Object.isFrozen(a.timing));assert(Object.isFrozen(a.timing.nativeMetrics));
 assert.throws(()=>{a.timing.readerTotalMs=0;},TypeError);assert.throws(()=>{a.timing.nativeMetrics.nativeTotalMs=0;},TypeError);
 assert.equal(Object.hasOwn(a.raw,'timing'),false);assert.equal(Object.hasOwn(a.raw.sdkResult,'timing'),false);
});

test('missing stage/native measurements remain explicit nulls rather than invented zeroes',async()=>{
 const f=fixture({metrics:null}),original=f.reader.engine.read.bind(f.reader.engine);
 f.reader.engine.read=async(...args)=>{const output=await original(...args);delete output.timings;return output;};
 const o=await read(f),t=o.timing;
 for(const key of topFields.filter(k=>!['preparationMs','parserMs','readerTotalMs'].includes(k)))assert.equal(t[key],null,key);
 assert.deepEqual(t.nativeMetrics,{nativeDetectionMs:null,nativeRecognitionMs:null,nativeTotalMs:null});assertNumericShape(t);
 assert.equal(f.effects.predict,1);assert.equal(f.effects.terminated,1);
});

test('invalid metrics are never coerced, clamped or copied into the timing schema',async()=>{
 const f=fixture({metrics:{detMs:'12',recMs:-1,totalMs:Infinity}}),original=f.reader.engine.read.bind(f.reader.engine);
 f.reader.engine.read=async(...args)=>({...await original(...args),timings:{runtimeModuleMs:NaN,workerInitializeMs:Infinity,predictRoundTripMs:-1,envelopeCheckMs:'23',hardCleanupMs:undefined,engineTotalMs:1n}});
 const t=(await read(f)).timing;
 for(const key of topFields.filter(k=>!['preparationMs','parserMs','readerTotalMs'].includes(k)))assert.equal(t[key],null,key);
 for(const key of nativeFields)assert.equal(t.nativeMetrics[key],null,key);assertNumericShape(t);
});

test('measured zeroes and fractional durations remain valid',async()=>{
 const f=fixture({now:()=>0,metrics:{detMs:0,recMs:.25,totalMs:.5}}),t=(await read(f)).timing;
 for(const key of topFields)assert.equal(t[key],0,key);
 assert.deepEqual(t.nativeMetrics,{nativeDetectionMs:0,nativeRecognitionMs:.25,nativeTotalMs:.5});assertNumericShape(t);
});

for(const invalid of [NaN,Infinity,-1,'12',null])test('invalid injected clock values preserve results and yield null durations: '+String(invalid),async()=>{
 const f=fixture({now:()=>invalid}),o=await read(f);for(const key of topFields)assert.equal(o.timing[key],null,key);
 assert.equal(o.elapsedSeconds,null);assertNumericShape(o.timing);assert.equal(f.effects.predict,1);assert.equal(f.effects.terminated,1);
 assert.equal(o.rawResultSha256,await digest(new TextEncoder().encode(JSON.stringify(o.raw))));
});

test('backwards clock differences become null rather than negative timings',async()=>{
 const clock=stagedClock(ticks().map(v=>1000-v)),o=await read(fixture({now:clock.now}));
 for(const key of topFields)assert.equal(o.timing[key],null,key);assert.equal(o.elapsedSeconds,null);assert.equal(clock.remaining.length,0);
});

test('canceled runtime import cannot create a late worker or return any observation/timing',async()=>{
 const pending=deferred(),entered=deferred(),f=fixture({load:()=>{entered.resolve();return pending.promise;}});await f.reader.open(file());
 const reading=f.reader.read();await entered.promise;f.reader.cancel();assert.equal(f.reader.busy,true);
 pending.resolve(f.runtime);await assert.rejects(reading,/canceled/);assert.equal(f.effects.workers,0);assert.equal(f.effects.predict,0);assert.equal(f.reader.passCount,0);assert.equal(f.reader.storedBytes,0);assert.equal(f.reader.busy,false);
});

test('a replaced photo discards late parser work and cannot attach its measurements to the next photo',async()=>{
 const pending=deferred(),entered=deferred();let first=true;
 const f=fixture({projector:()=>{if(first){first=false;entered.resolve();return pending.promise;}return {projectPaddleLabelBlocks};}});
 await f.reader.open(file('old.jpg'),{photoId:'old'});const reading=f.reader.read();await entered.promise;
 await f.reader.open(file('new.jpg'),{photoId:'new'});pending.resolve({projectPaddleLabelBlocks});
 await assert.rejects(reading,/Photo changed/);assert.equal(f.reader.passCount,0);assert.equal(f.reader.storedBytes,0);
 const o=(await f.reader.read()).observation;assert.equal(o.photoId,'new');assert.equal(o.id,'new:paddle:1');assertNumericShape(o.timing);
 assert.equal(f.effects.workers,2);assert.equal(f.effects.predict,2);assert.equal(f.effects.terminated,2);
});

test('canceling a prediction never reuses a prior result or late timing on retry',async()=>{
 const pending=deferred(),entered=deferred();let call=0;
 const f=fixture({predict:(input,envelope)=>{if(++call===2){entered.resolve();return pending.promise.then(()=>envelope(input));}return envelope(input);}});
 const first=await read(f);const snapshot=JSON.stringify(first.timing),reading=f.reader.read();await entered.promise;f.reader.cancel();
 await assert.rejects(reading,/canceled/);assert.equal(f.reader.passCount,1);pending.resolve();
 const next=(await f.reader.read()).observation;assert.equal(next.id,'fictional:paddle:2');assert.notEqual(next.timing,first.timing);
 assert.equal(JSON.stringify(first.timing),snapshot);assert.equal(f.effects.predict,3);assert.equal(f.effects.workers,3);assert.equal(f.effects.terminated,3);
});

test('engine timing retains legacy key and is populated after finally without extra calls',async()=>{
 const f=fixture(),clock=stagedClock([12,20,21,50,52,105,106,110,111,115,116]);
 const engine=new PaddleReaderEngine(()=>f.runtime,{now:clock.now});
 const output=await engine.read({width:10,height:4,buffer:new ArrayBuffer(160),pixelSha256:'a'.repeat(64),sourceSha256:'b'.repeat(64)});
 assert.deepEqual(output.timings,{runtimeModuleMs:8,workerInitializeMs:29,predictRoundTripMs:53,envelopeCheckMs:4,hardCleanupMs:4,engineTotalMs:104});
 assert.equal(clock.remaining.length,0);assert.equal(f.effects.predict,1);assert.equal(f.effects.terminated,1);assert.equal(engine.busy,false);
});
