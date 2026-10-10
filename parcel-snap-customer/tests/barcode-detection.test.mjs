import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8').split('function setMode(')[0];
const loader=readFileSync(new URL('../barcode-reader.js',import.meta.url),'utf8');
const workerSource=readFileSync(new URL('../barcode-worker.js',import.meta.url),'utf8');
const typed=(rawValue,format='DataMatrix')=>({rawValue,format,decoded:true});
function app({Detector,decode}={}){
 const context=vm.createContext({console,URL,performance,setTimeout,clearTimeout,window:{BarcodeDetector:Detector,ParcelSnapBarcode:decode?{decode}:undefined},supabase:{createClient:()=>({})}});
 vm.runInContext(source,context);
 return {context,parse:(text,codes)=>{context.text=text;context.codes=codes;return vm.runInContext('trackingAnalysis(text,codes)',context);},detect:()=>vm.runInContext('detectBarcode({width:100,height:100})',context)};
}

test('mock native API intersects formats and includes supported Data Matrix',async()=>{
 let requested;
 class Detector{static async getSupportedFormats(){return ['qr_code','data_matrix','unknown'];}constructor({formats}){requested=formats;}async detect(){return [{rawValue:'TBA000000000123',format:'data_matrix'}];}}
 const h=app({Detector});const result=await h.detect();assert.deepEqual(Array.from(requested),['data_matrix','qr_code']);assert.equal(result[0].rawValue,'TBA000000000123');assert.equal(result[0].decoded,true);
});
test('unsupported Data Matrix does not reject native QR scan, and fallback still runs',async()=>{
 let requested,localCalls=0;
 class Detector{static async getSupportedFormats(){return ['qr_code'];}constructor({formats}){requested=formats;}async detect(){return [{rawValue:'SP_SYNTHETIC_001_v',format:'qr_code'}];}}
 const h=app({Detector,decode:async()=>{localCalls++;return [typed('TBA000000000123')];}});const codes=await h.detect();assert.deepEqual(Array.from(requested),['qr_code']);assert.equal(localCalls,1);assert.equal(h.parse('',codes).value,'TBA000000000123');
});
test('no native API still uses local decoder',async()=>{const h=app({decode:async()=>[typed('TBA000000000123')]});assert.equal(h.parse('',await h.detect()).value,'TBA000000000123');});
test('empty supported intersection does not construct a native detector',async()=>{
 class Detector{static async getSupportedFormats(){return ['aztec'];}constructor(){throw Error('Must not construct');}}
 const h=app({Detector,decode:async()=>[typed('TBA000000000123')]});assert.equal(h.parse('',await h.detect()).value,'TBA000000000123');
});
test('older native API without discovery uses its default supported formats',async()=>{
 let args;class Detector{constructor(...value){args=value;}async detect(){return [{rawValue:'1ZTEST000000000001',format:'code_128'}];}}
 const h=app({Detector});const codes=await h.detect();assert.deepEqual(args,[]);assert.equal(h.parse('',codes).value,'1ZTEST000000000001');
});
for(const failing of ['discovery','constructor','detect'])test('native '+failing+' failure degrades to local decoder',async()=>{
 class Detector{static async getSupportedFormats(){if(failing==='discovery')throw Error('Unavailable');return ['data_matrix'];}constructor(){if(failing==='constructor')throw Error('Unavailable');}async detect(){throw Error('Unavailable');}}
 const h=app({Detector,decode:async()=>[typed('TBA000000000123')]});assert.equal(h.parse('',await h.detect()).value,'TBA000000000123');
});
test('local failure preserves valid native evidence',async()=>{
 class Detector{async detect(){return [{rawValue:'TBA000000000123',format:'data_matrix'}];}}
 const h=app({Detector,decode:async()=>{throw Error('Blocked');}});assert.equal(h.parse('',await h.detect()).value,'TBA000000000123');
});
test('no available decoder returns no invented result',async()=>{assert.equal((await app().detect()).length,0);});
test('typed TBA is format-valid without an OCR carrier word',()=>{const result=app().parse('',[typed('TBA000000000123')]);assert.equal(result.value,'TBA000000000123');assert.equal(result.status,'FORMAT_VALID');});
for(const payload of ['TBA000000000123',typed('SP_SYNTHETIC_001_v'),typed('123456789012'),typed('TBA00000000012'),typed('TBA00000000012345678'),typed('prefix TBA000000000123'),typed('https://example.invalid/TBA000000000123','QRCode'),typed('TBA 000000000123'),{rawValue:'TBA000000000123',format:'DataMatrix'},typed('TBA000000000123','unrecognized')])test('unproven, routing, malformed or arbitrary content remains missing: '+JSON.stringify(payload),()=>{assert.equal(app().parse('',[payload]).status,'MISSING');});
test('OCR and decoded barcode disagreements withhold tracking',()=>{const r=app().parse('TRACKING: TBA000000000456',[typed('TBA000000000123')]);assert.equal(r.status,'CONFLICT');assert.equal(r.value,'');});
test('different native and fallback tracking codes both reach conflict guard',async()=>{
 class Detector{async detect(){return [{rawValue:'TBA000000000123',format:'data_matrix'}];}}
 const h=app({Detector,decode:async()=>[typed('TBA000000000456')]});assert.equal(h.parse('',await h.detect()).status,'CONFLICT');
});
test('duplicate native and fallback tracking plus routing stays one tracking code',()=>{const r=app().parse('',[typed('TBA000000000123'),typed('TBA000000000123','data_matrix'),typed('SP_SYNTHETIC_001_v')]);assert.equal(r.value,'TBA000000000123');assert.equal(r.candidates.length,1);});
test('numeric barcode retains leading zeroes only with carrier evidence',()=>{assert.equal(app().parse('FedEx',[typed('001234567890','Code128')]).value,'001234567890');assert.equal(app().parse('',[typed('001234567890','Code128')]).status,'MISSING');});

function loaderHarness(mode='success'){
 const workers=[],timers=[];let canvas;
 class WorkerMock{
  constructor(url){this.url=String(url);this.terminated=false;workers.push(this);if(mode==='constructor')throw Error('Blocked');}
  postMessage(data,transfer){this.input=data;this.transfer=transfer;if(mode==='post')throw Error('Failed');if(mode==='success')this.onmessage({data:[typed('TBA000000000123')]});if(mode==='error')this.onerror();if(mode==='messageerror')this.onmessageerror();}
  terminate(){this.terminated=true;}
 }
 const context=vm.createContext({window:{},URL,Uint8ClampedArray,Worker:WorkerMock,setTimeout:(f,ms)=>{timers.push({f,ms});return timers.length;},clearTimeout(){},document:{currentScript:{src:'https://app.example.invalid/sub/barcode-reader.js?v=1'},createElement(){canvas={width:0,height:0,getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(canvas.width*canvas.height*4),width:canvas.width,height:canvas.height})})};return canvas;}}});
 vm.runInContext(loader,context);return {workers,timers,context,decode:source=>context.window.ParcelSnapBarcode.decode(source),canvas:()=>canvas};
}
test('local loader resolves same-origin worker relative to its script and terminates on success',async()=>{const h=loaderHarness();const result=await h.decode({width:100,height:200});assert.equal(result[0].rawValue,'TBA000000000123');assert.equal(h.workers[0].url,'https://app.example.invalid/sub/barcode-worker.js?v=20261010-datamatrix');assert.equal(h.workers[0].terminated,true);assert.equal(h.workers[0].transfer[0],h.workers[0].input.data.buffer);});
for(const mode of ['constructor','post','error','messageerror'])test('local '+mode+' failure returns no result',async()=>{const h=loaderHarness(mode);assert.equal((await h.decode({width:100,height:200})).length,0);});
test('hung worker is terminated after bounded timeout',async()=>{const h=loaderHarness('hang');const promise=h.decode({width:100,height:200});assert.equal(h.timers[0].ms,8000);h.timers[0].f();assert.equal((await promise).length,0);assert.equal(h.workers[0].terminated,true);});
test('huge image is downscaled before pixel allocation to side and pixel caps',async()=>{const h=loaderHarness();await h.decode({width:12000,height:12000});assert(h.canvas().width<=3200);assert(h.canvas().width*h.canvas().height<=6000000);});
for(const value of [{width:0,height:5},{width:Infinity,height:5},{width:5,height:-1}])test('invalid image dimensions do not create workers: '+JSON.stringify(value),async()=>{const h=loaderHarness();assert.equal((await h.decode(value)).length,0);assert.equal(h.workers.length,0);});

test('worker only forwards valid, error-free, bounded decoder outputs',async()=>{
 let options,results;const context=vm.createContext({Uint8ClampedArray,URL,importScripts(){},location:{href:'https://app.invalid/barcode-worker.js'},ZXingWASM:{prepareZXingModule(){},readBarcodes:async(_,opts)=>{options=opts;return [{isValid:true,error:'',text:'TBA000000000123',format:'DataMatrix'},{isValid:false,error:'checksum',text:'TBA000000000456',format:'DataMatrix'},{isValid:true,error:'checksum',text:'TBA000000000789',format:'DataMatrix'},{isValid:true,error:'',text:'x'.repeat(201),format:'QRCode'}];}},postMessage:r=>{results=r;}});context.self=context;vm.runInContext(workerSource,context);await context.onmessage({data:{width:1,height:1,data:new Uint8ClampedArray(4)}});assert.equal(results.length,1);assert.equal(results[0].rawValue,'TBA000000000123');assert.equal(options.returnErrors,false);assert.equal(options.maxNumberOfSymbols,32);
});

const require=createRequire(new URL('./ocr-runtime/package.json',import.meta.url));
const {createCanvas,loadImage}=require('@napi-rs/canvas');
async function actualWorker(){
 const reads=[];let output;
 const context=vm.createContext({console,URL,performance,setTimeout,clearTimeout,WebAssembly,TextDecoder,Uint8Array,Uint8ClampedArray,ArrayBuffer,Response,location:{href:'https://local.invalid/barcode-worker.js'},postMessage:r=>{output=r;},fetch:async url=>{reads.push(String(url));assert.equal(String(url),'https://local.invalid/vendor/zxing-wasm-3.1.5/zxing_reader.wasm');return new Response(readFileSync(new URL('../vendor/zxing-wasm-3.1.5/zxing_reader.wasm',import.meta.url)),{headers:{'Content-Type':'application/wasm'}});}});context.self=context;
 context.importScripts=url=>{assert.equal(url,'./vendor/zxing-wasm-3.1.5/reader.js');vm.runInContext(readFileSync(new URL('../vendor/zxing-wasm-3.1.5/reader.js',import.meta.url),'utf8'),context);};vm.runInContext(workerSource,context);
 return {reads,async decode(name){const image=await loadImage(new URL('./fixtures/barcodes/'+name+'.png',import.meta.url).pathname);const canvas=createCanvas(image.width,image.height);const c=canvas.getContext('2d');c.drawImage(image,0,0);await context.onmessage({data:c.getImageData(0,0,image.width,image.height)});return output;}};
}
for(const [name,text] of [['datamatrix-tracking','TBA000000000123'],['datamatrix-other-tracking','TBA000000000456'],['datamatrix-routing','SP_SYNTHETIC_001_v'],['qr-unrelated','https://example.invalid/123456789012'],['qr-tracking','1ZTEST000000000001'],['code128-leading-zero','001234567890']])test('actual vendored WASM decodes synthetic '+name,async()=>{const reader=await actualWorker();const result=await reader.decode(name);assert(result.some(x=>x.rawValue===text));assert.equal(reader.reads.length,1);if(name==='datamatrix-routing'||name==='qr-unrelated')assert.equal(app().parse('',result).status,'MISSING');});

function readHarness(){
 const nodes=new Map(),seen=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',dataset:{},checked:false,classList:{add(){},remove(){},toggle(){}}});return nodes.get(id);};
 const context=vm.createContext({console,performance,URL,setTimeout,clearTimeout,window:{},document:{getElementById:node},supabase:{createClient:()=>({})}});
 vm.runInContext(source,context);
 vm.runInContext(`workspace={customers:[]};toCanvas=async value=>value;estimateSkewDegrees=()=>0;deskewCanvas=value=>value;flattenOcrLines=()=>[];fastOcrRecognizeDetailed=async()=>({text:'',blocks:[]});runDeepRecovery=async()=>null;`,context);
 context.detectBarcode=source=>new Promise(resolve=>seen.push({source,resolve}));
 return {context,node,seen,run:code=>vm.runInContext(code,context),read:()=>vm.runInContext('readPackagePhoto({tag:"ocr"},{raw:{tag:"crop"},barcode:{tag:"full-photo"}})',context)};
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));
test('intake routes full-photo barcode canvas separately from OCR crop',async()=>{const h=readHarness();const pending=h.read();await settled();assert.equal(h.seen[0].source.tag,'full-photo');h.seen[0].resolve([typed('TBA000000000123')]);const result=await pending;assert.equal(result.tracking,'TBA000000000123');assert.equal(h.node('receiveLabelConfirmed').checked,false);});
test('late barcode results from old photo cannot overwrite selected newer photo',async()=>{
 const h=readHarness();const old=h.read();await settled();const current=h.read();await settled();h.seen[1].resolve([typed('TBA000000000456')]);await current;h.seen[0].resolve([typed('TBA000000000123')]);assert.equal((await old).superseded,true);assert.equal(h.node('receiveTracking').value,'TBA000000000456');assert.equal(h.node('receiveLabelConfirmed').checked,false);
});
test('manual edits and confirmation survive late barcode completion',async()=>{
 const h=readHarness();const pending=h.read();await settled();h.node('receiveTracking').value='MANUAL-000123';h.node('receiveLabelConfirmed').checked=true;h.run('intakeFieldEditGeneration++');h.seen[0].resolve([typed('TBA000000000123')]);assert.equal((await pending).reason,'manual-edit');assert.equal(h.node('receiveTracking').value,'MANUAL-000123');assert.equal(h.node('receiveLabelConfirmed').checked,true);
});
test('main page loads local barcode adapter before app',()=>{const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');assert(html.indexOf('src="barcode-reader.js?')<html.indexOf('src="app.js?'));});

test('vendored dependency bytes match audited pinned package manifest',async()=>{
 const {createHash}=await import('node:crypto');const manifest=JSON.parse(readFileSync(new URL('../vendor/zxing-wasm-3.1.5/PROVENANCE.json',import.meta.url),'utf8'));
 assert.equal(manifest.version,'3.1.5');for(const [file,hash] of Object.entries(manifest.sha256)){assert.equal(createHash('sha256').update(readFileSync(new URL('../vendor/zxing-wasm-3.1.5/'+file,import.meta.url))).digest('hex'),hash,file);}
});
