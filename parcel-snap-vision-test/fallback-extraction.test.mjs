import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./app.js',import.meta.url),'utf8');
const matcher=readFileSync(new URL('./known-customer-matcher.js',import.meta.url),'utf8');
const customers=[
  {id:'sender',name:'Trevon Humes',aliases:[{alias:'YEN/Trevon Humes',alias_type:'LABEL'}]},
  {id:'recipient',name:'Jordan Sample',aliases:[]}
];
function harness(text,{barcode='',known=true,recovery=''}={}){
  const elements=new Map(), calls=[];
  const document={getElementById(id){
    if(!elements.has(id))elements.set(id,{value:'',textContent:'',dataset:{},classList:{add(){},remove(){},toggle(){}}});
    return elements.get(id);
  }};
  const ctx=vm.createContext({document,window:{PARCEL_SNAP_REVIEW_ONLY:true},performance:{now:()=>1000},
    supabase:{createClient:()=>({})},console,setTimeout,crypto:{randomUUID:()=> 'fictional'},
    fetch(){calls.push('fetch');throw Error('Network forbidden');}});
  if(known)vm.runInContext(matcher,ctx);
  // Execute the current app's real declarations, including receive/recovery guards.
  vm.runInContext(source.slice(0,source.indexOf('function setMode(')),ctx);
  const receiveStart=source.indexOf('async function receivePackage(){');
  vm.runInContext(source.slice(receiveStart,source.indexOf('function renderTransferControls()',receiveStart)),ctx);
  ctx.testCustomers=customers;ctx.testText=text;ctx.testBarcode=barcode;ctx.recoveryText=recovery;
  vm.runInContext(`workspace={customers:testCustomers};
    toCanvas=async x=>x; estimateSkewDegrees=()=>0; deskewCanvas=x=>x;
    flattenOcrLines=()=>[]; fastOcrRecognizeDetailed=async()=>({text:testText,blocks:[]});
    detectBarcode=async()=>testBarcode; stopRecoveryOcr=()=>{};
    recipientFocusRectFromLines=()=>null; cropCanvasRect=()=>null;
    adaptiveBinarizeCanvas=x=>x; fitForOcr=x=>x; scaleCanvas=x=>x; rotateCanvas=x=>x;
    ocrWithSlot=async()=>recoveryText;
    api=async()=>{throw Error('WRITE_PATH_REACHED');};`,ctx);
  return {ctx,elements,calls,async read(){
    const result=await vm.runInContext('readPackagePhoto({width:2400,height:1500})',ctx);
    // Also exercise the currently callable old save and automatic-notification paths.
    await vm.runInContext('receivePackage();',ctx);
    await vm.runInContext('autoReceiveMatchedPhoto({read_token:intakeReadToken,match:{score:1,customer:testCustomers[0]}},null)',ctx);
    assert.equal(elements.get('receiveCustomer').value,'');assert.deepEqual(calls,[]);
    return result;
  }};
}

const label='FROM:\nTREVON HUMES\n120 RETURN ROAD\nMIAMI FL 33101\nSHIP TO:\nJORDAN SAMPLE\n123 FICTIONAL STREET\nMIAMI FL 33122\nUPS\nTracking: 1Z999AA10123456784';
for(const known of [true,false])test(`current fallback isolates destination with known matcher ${known}`,async()=>{
  const h=harness(label,{known}),r=await h.read();
  assert.equal(r.candidate,'Jordan Sample');assert.equal(r.match?.customer.id,'recipient');
  assert.equal(r.tracking,'1Z999AA10123456784');assert.doesNotMatch(r.address,/RETURN/);
  assert.doesNotMatch(h.elements.get('processingDetail').textContent,/Possible: Trevon/);
});
test('address words cannot become tracking when actual tracking is covered',async()=>{
  const h=harness(label.replace('1Z999AA10123456784','[covered]')),r=await h.read();
  assert.equal(r.tracking,'');assert.equal(h.elements.get('receiveTracking').dataset.needsReview,'true');
  assert.match(h.elements.get('processingDetail').textContent,/NEEDS REVIEW/);
});
test('ambiguous unmarked sender/destination stays empty with no customer suggestion',async()=>{
  const h=harness('TREVON HUMES\n120 RETURN ROAD\nMIAMI FL 33101\nJORDAN SAMPLE\n123 FICTIONAL STREET\nMIAMI FL 33122'),r=await h.read();
  assert.equal(r.candidate,'');assert.equal(r.match,null);assert.equal(r.suggestion,'');assert.equal(r.address,'');assert.equal(r.tracking,'');
});
test('destination customer alias preserved while sender is excluded',async()=>{
  const h=harness('FROM: Jordan Sample\nSHIP TO:\nYEN/Trevon Humes\n123 FICTIONAL STREET\nMIAMI FL 33122'),r=await h.read();
  assert.equal(r.candidate,'Trevon Humes');assert.equal(r.match?.customer.id,'sender');
});
test('numeric tracking requires carrier evidence and tracking label; leading zeroes preserved',async()=>{
  const h=harness('SHIP TO:\nJordan Sample\n123 FICTIONAL STREET\nMiami FL 33122\nFedEx\nTracking: 001234567890'),r=await h.read();
  assert.equal(r.tracking,'001234567890');
  const missing=harness('SHIP TO: Jordan Sample\nFedEx\n001234567890'),m=await missing.read();
  assert.equal(m.tracking,'');
});
test('arbitrary barcode payload and conflicting printed codes require review',async()=>{
  const h=harness(label.replace('1Z999AA10123456784','[covered]'),{barcode:'FICTIONAL'}),r=await h.read();assert.equal(r.tracking,'');
  const conflict=harness(label+'\nTracking: 1Z999AA10123456785'),c=await conflict.read();assert.equal(c.tracking,'');
});
test('background recovery cannot introduce sender candidate or perform writes',async()=>{
  const h=harness('SHIP TO:\n[covered]\n123 FICTIONAL STREET\nMiami FL 33122',{recovery:'FROM:\nTrevon Humes\n120 RETURN ROAD\nMiami FL 33101'});
  await h.read();
  await vm.runInContext('runDeepRecovery({width:2400,height:1500},intakeReadToken,testText,{skew:0})',h.ctx);
  assert.equal(h.elements.get('receiveCustomer').value,'');
  assert.doesNotMatch(h.elements.get('processingDetail').textContent,/Trevon/);
  assert.notEqual(vm.runInContext('intakeOcrName',h.ctx),'Trevon Humes');assert.deepEqual(h.calls,[]);
});
test('vision adapter validates extracted URL/JSON barcode tracking too',()=>{
  const vision=readFileSync(new URL('./vision-client.js',import.meta.url),'utf8');
  const helper=vision.slice(vision.indexOf(' function trackingFromBarcode'),vision.indexOf(' async function vision('));
  const h=harness('');vm.runInContext(helper,h.ctx);
  for(const raw of ['FICTIONAL','https://example.invalid/?tracking=FICTIONAL','{"tracking":"FICTIONAL"}','001234567890']){
    h.ctx.rawCode=raw;assert.equal(vm.runInContext('trackingFromBarcode(rawCode)',h.ctx),null);
  }
  h.ctx.rawCode='1Z999AA10123456784';assert.equal(vm.runInContext('trackingFromBarcode(rawCode)',h.ctx),h.ctx.rawCode);
});

test('multiple destination blocks require review instead of selecting the first name',async()=>{
  const h=harness('SHIP TO: Trevon Humes\n123 FICTIONAL STREET\nMiami FL 33122\nSHIP TO: Jordan Sample\n456 TEST ROAD\nMiami FL 33101'),r=await h.read();
  assert.equal(r.candidate,'');assert.equal(r.match,null);assert.equal(r.suggestion,'');assert.equal(r.address,'');assert.equal(r.status,'NEEDS_REVIEW');
});
test('sender-only registered YEN alias is never promoted to destination',async()=>{
  const h=harness('RETURN ADDRESS:\nYEN/Trevon Humes\n123 FICTIONAL STREET\nMiami FL 33122\nUPS\nTracking: 1Z999AA10123456784'),r=await h.read();
  assert.equal(r.candidate,'');assert.equal(r.match,null);assert.equal(r.suggestion,'');assert.equal(r.address,'');
  assert.equal(r.tracking,'1Z999AA10123456784');
});
test('inline destination followed by sender preserves destination only',async()=>{
  const h=harness('TO: Jordan Sample\n123 FICTIONAL STREET\nMiami FL 33122\nFROM: Trevon Humes\n456 RETURN ROAD\nMiami FL 33101'),r=await h.read();
  assert.equal(r.candidate,'Jordan Sample');assert.equal(r.match?.customer.id,'recipient');assert.doesNotMatch(r.address,/RETURN/);
});
test('single unmarked personal address remains review-only: explicit recall limitation',async()=>{
  const h=harness('Jordan Sample\n123 FICTIONAL STREET\nMiami FL 33122'),r=await h.read();
  assert.equal(r.candidate,'');assert.equal(r.match,null);assert.equal(r.status,'NEEDS_REVIEW');
});
