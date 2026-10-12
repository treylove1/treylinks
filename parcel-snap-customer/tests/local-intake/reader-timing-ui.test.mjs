import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {projectPaddleLabelBlocks} from '../../paddle-label-blocks.js';
import {proposePaddleFields} from '../../local-reader/paddle-fields.js';
import {paddleRows} from '../../local-reader/paddle-source.js';
// Override only to prove this exact suite fails against the untouched deployed tree.
const root=process.env.PARCEL_SNAP_TEST_ROOT?pathToFileURL(process.env.PARCEL_SNAP_TEST_ROOT.replace(/\/$/,'')+'/'):new URL('../../',import.meta.url);
const app=readFileSync(new URL('app.js',root),'utf8'),html=readFileSync(new URL('index.html',root),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
function observation({id='fictional-read-1',heading='SHIP TO',name='Morgan T',tracking='001234567890',extra=[],lines}={}){
 const entries=lines??[...[heading,...name.split('\n'),'123 Fiction Way','Example FL 33101'].filter(Boolean).map((text,i)=>({text,x:10,y:10+i*16})),...(tracking?[{text:'TRACKING: '+tracking,x:500,y:10}]:[]),...extra];
 const items=entries.map(({text,x=10,y=10,w=280,h=12})=>({poly:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],text,score:.8}));
 const native={image:{width:1000,height:1000},items:items.filter(item=>item.text)};
 const returns={detection:[[{srcW:1000,srcH:1000,boxes:items.map(({poly})=>({poly}))}]],recognition:items.length?[items.map(({text,score})=>({text,score}))]:[]};
 const rows=paddleRows(native,id,returns),binding={id,photoId:'fictional-photo',photoSha256:'a'.repeat(64),rawResultSha256:(id.endsWith('2')?'c':'b').repeat(64)};
 const proposals=projectPaddleLabelBlocks({observationId:id,...binding,rows});
 const fields=proposePaddleFields(rows,{barcodes:[]});
 return freeze({...binding,raw:{text:native.items.map(item=>item.text).join('\n'),sdkResult:native,rawMethodReturns:returns},rows,proposals,trackingProposal:fields.proposals.tracking});
}
async function harness(t){
 const clock={now:0},nodes=new Map(),requests=[],revoked=[];let sequence=0,authCallback;
 const tags=new Map([...html.matchAll(/<(input|textarea|select)\b[^>]*\bid="([^"]+)"/g)].map(m=>[m[2],m[1].toUpperCase()]));
 const node=id=>{if(!nodes.has(id)){const classes=new Set();let value='';const n={id,tagName:tags.get(id)||'DIV',textContent:'',innerHTML:'',checked:false,disabled:false,hidden:false,files:[],options:[],dataset:{},src:'',removeAttribute(key){delete this[key];},setAttribute(key,v){this[key]=v;},classList:{add(...xs){xs.forEach(x=>classes.add(x));},remove(...xs){xs.forEach(x=>classes.delete(x));},toggle(x,on=!classes.has(x)){on?classes.add(x):classes.delete(x);return on;},contains:x=>classes.has(x)},querySelectorAll:()=>[],click(){return this.onclick?.();}};Object.defineProperty(n,'value',{get:()=>value,set:v=>{value=String(v);if(n.tagName==='INPUT')value=value.replace(/[\r\n]/g,'');}});nodes.set(id,n);}return nodes.get(id);};
 const ctx=vm.createContext({console,performance:{now:()=>clock.now},setTimeout,clearTimeout,structuredClone,TextEncoder,Blob,ArrayBuffer,Uint8Array,URL:{createObjectURL:()=>`blob:fictional-${++sequence}`,revokeObjectURL:u=>revoked.push(u)},crypto:{randomUUID:()=>`fictional-${++sequence}`},document:{getElementById:node,querySelectorAll:()=>[],querySelector:()=>({click(){}})},supabase:{createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:cb=>authCallback=cb}})},fetch:(...args)=>{requests.push(args);throw Error('External calls forbidden');},alert(){},confirm:()=>false,localStorage:{getItem:()=>null,removeItem(){}},location:{reload(){}},addEventListener(){}});ctx.window=ctx;
 // Evaluate the complete shipped page, including real handler registration and renderers.
 // No function-body regex extraction or test replacement of the changed application logic.
 for(const file of ['intake-review.js','known-customer-matcher.js'])vm.runInContext(readFileSync(new URL(file,root),'utf8'),ctx,{filename:file});
 vm.runInContext(app,ctx,{filename:'app.js'});await settle();
 const run=source=>vm.runInContext(source,ctx);
 const reader={busy:false,reads:0,opens:0,clear(){},cancel(){},async open(){this.opens++;return {id:'fictional-photo'};},async read(){this.reads++;return {observation:observation(),frameBlob:new Blob(['fictional'])};}};
 ctx.fakeReader=reader;run('workspace={state:"ACTIVE",company:{id:"fictional-company",role:"OWNER"},customers:[],packages:[],facilities:[]};workspaceActorId="fictional-actor";localIntakeReader=fakeReader;localIntakeReaderPromise=Promise.resolve(fakeReader);compressImage=async file=>"data:image/jpeg;base64,"+file.name;');
 t.after(()=>assert.equal(requests.length,0,'No page action may transmit data'));
 ctx.testClock=clock;
 return {clock,node,run,ctx,reader,revoked,emit:(event,session)=>authCallback(event,session),select:async(name='fictional.jpg')=>{const target=node('packagePhoto');target.files=[{name,size:100,type:'image/jpeg'}];await target.onchange({target});},read:()=>node('readLocalLabel').onclick(),result:o=>({observation:o,frameBlob:new Blob(['fictional'])})};
}


const timing=(override={})=>freeze({schema:'parcel-snap-local-timing-v1',units:'ms',preparationMs:40,runtimeModuleMs:10,workerInitializeMs:100,predictionRoundTripMs:200,engineTotalMs:320,envelopeCheckMs:5,hardCleanupMs:5,parserMs:20,readerTotalMs:380,nativeMetrics:{nativeDetectionMs:60,nativeRecognitionMs:100,nativeTotalMs:170},...override});
function withTiming(t=timing(),opts){return freeze({...observation(opts),timing:t});}

test('completed timing uses actual Read tap through DOM fields, separately from selection and nested stages',async t=>{
 const h=await harness(t);h.reader.open=async()=>{h.clock.now+=20;return {id:'fictional-photo'};};h.run('compressImage=async()=>{testClock.now+=30;return "data:image/jpeg;base64,fictional"}');await h.select();
 h.clock.now=200;h.reader.read=async()=>{h.clock.now+=500;return h.result(withTiming());};h.run('const originalSuggest=suggestLocalFields;suggestLocalFields=(...args)=>{testClock.now+=20;return originalSuggest(...args)}');await h.read();
 assert.equal(h.run('localReadTiming.tapToFieldsMs'),520);assert.equal(h.run('localReadTiming.uiBindingMs'),20);assert.equal(h.run('localReadTiming.photoOpeningMs'),50);assert.equal(h.run('localReadTiming.selectionToFieldsMs'),720);
 const text=h.node('localReaderTiming').textContent;assert.match(text,/Read tap → field review ready: 0.52 s/);assert.match(text,/Photo opening.*0.05 s/);assert.match(text,/includes time waiting to tap Read/);assert.match(text,/Worker initialization: 0.10 s/);assert.match(text,/Prediction round trip: 0.20 s/);assert.match(text,/Parsing\/source checks: 0.02 s/);assert.match(text,/UI field binding\/render code: 0.02 s/);assert.match(text,/nested work; do not add/);assert.match(text,/not measured screen paint/);assert.match(text,/cache cold\/warm status: not observed/);assert.doesNotMatch(text,/Morgan|123 Fiction|001234567890|fictional-company/);assert.equal(h.node('localReaderTiming').hidden,false);assert(h.run('Object.isFrozen(localReadTiming)&&Object.isFrozen(localReadTiming.reader)&&Object.isFrozen(localReadTiming.reader.nativeMetrics)'));
});
test('missing or unsupported reader timing still reports actual app duration and never invents zero stages',async t=>{const h=await harness(t);await h.select();h.clock.now=10;h.reader.read=async()=>{h.clock.now=310;return h.result(withTiming({schema:'unrecognized',preparationMs:999,workerInitializeMs:999}));};await h.read();assert.match(h.node('localReaderTiming').textContent,/field review ready: 0.30 s/);assert.match(h.node('localReaderTiming').textContent,/Worker initialization: Unavailable/);assert.equal(h.run('localReadTiming.reader.workerInitializeMs'),null);});
test('invalid numeric metrics and unrelated private strings never enter diagnostic output',async t=>{const h=await harness(t);await h.select();h.reader.read=async()=>h.result(withTiming(timing({preparationMs:NaN,runtimeModuleMs:Infinity,workerInitializeMs:-1,predictionRoundTripMs:'private-text',nativeMetrics:{nativeDetectionMs:null,nativeRecognitionMs:Infinity,nativeTotalMs:-10},private:'unrelated@example.invalid'})));await h.read();const out=h.node('localReaderTiming').textContent;assert.match(out,/Photo preparation after Read: Unavailable/);assert.match(out,/Worker initialization: Unavailable/);assert.doesNotMatch(out,/private-text|unrelated|NaN|Infinity/);});
test('completed empty output has a distinct timing label and makes no filled-fields claim',async t=>{const h=await harness(t);await h.select();h.reader.read=async()=>h.result(withTiming(timing(),{lines:[]}));await h.read();assert.match(h.node('localReaderTiming').textContent,/Read tap → empty result ready/);assert.doesNotMatch(h.node('localReaderTiming').textContent,/field review ready/);});
test('new read immediately replaces old success timing; failure is not a completed sample',async t=>{const h=await harness(t);await h.select();h.reader.read=async()=>h.result(withTiming());await h.read();const wait=deferred();h.reader.read=()=>wait.promise;const pending=h.read();await settle();assert.match(h.node('localReaderTiming').textContent,/in progress.*No completed timing/);wait.reject(Error('Synthetic failure'));await pending;assert.match(h.node('localReaderTiming').textContent,/reading failed.*No completed timing/);assert.doesNotMatch(h.node('localReaderTiming').textContent,/field review ready/);});
test('cancel discards late duration and cannot restore old successful timing',async t=>{const h=await harness(t);await h.select();const wait=deferred();h.reader.read=()=>wait.promise;const pending=h.read();await settle();h.node('cancelLocalLabel').onclick();wait.resolve(h.result(withTiming()));await pending;assert.match(h.node('localReaderTiming').textContent,/canceled.*No completed timing/);assert.equal(h.run('localObservation'),null);});
test('new photo and late prior read cannot attach metrics to the new source',async t=>{const h=await harness(t);await h.select();const wait=deferred();h.reader.read=()=>wait.promise;const pending=h.read();await settle();await h.select('new.jpg');wait.resolve(h.result(withTiming()));await pending;assert.equal(h.run('localReadTiming'),null);assert.equal(h.node('localReaderTiming').hidden,true);assert.equal(h.node('localReaderTiming').textContent,'');});
test('auth loss clears completed numeric metrics and source-opening clock',async t=>{const h=await harness(t);await h.select();h.reader.read=async()=>h.result(withTiming());await h.read();h.emit('SIGNED_OUT',null);assert.equal(h.run('localReadTiming'),null);assert.equal(h.run('localPhotoTiming'),null);assert.equal(h.node('localReaderTiming').hidden,true);});
test('diagnostics do not start OCR when a photo is selected or change general write pause',async t=>{const h=await harness(t);await h.select();assert.equal(h.reader.reads,0);assert.equal(h.node('localReaderTiming').hidden,true);assert.equal(h.ctx.ParcelSnapIntakeReview.BUILD.writesEnabled,false);assert(!/fetch\(|api\(|localStorage|setTimeout/.test(app.slice(app.indexOf('function localDuration('),app.indexOf('function syncLocalReaderControls('))));});
test('backwards or missing monotonic endpoints are unavailable rather than zero',async t=>{const h=await harness(t);assert.equal(h.run('localDuration(10,5)'),null);assert.equal(h.run('localDuration(null,5)'),null);assert.equal(h.run('localDuration(5,10)'),5);});
