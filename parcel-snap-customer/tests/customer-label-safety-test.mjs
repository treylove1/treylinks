import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const matcher=readFileSync(new URL('../known-customer-matcher.js',import.meta.url),'utf8');
const jpegText=readFileSync(new URL('../../parcel-snap-vision-test/fixtures/tesseract-psm6-unmarked-20261008.txt',import.meta.url),'utf8');
const customers=[{id:'jordan',name:'Jordan Sample',email:'jordan@example.invalid'},
  {id:'morgan',name:'Morgan Rivera',email:'morgan@example.invalid'},
  {id:'sender',name:'Trevon Humes',aliases:[{alias:'YEN/Trevon Humes',alias_type:'LABEL'}],email:'sender@example.invalid'}];

function harness(text,{barcode='',directory=customers}={}){
  const nodes=new Map(),writes=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',dataset:{},checked:false,classList:{add(){},remove(){},toggle(){}}});return nodes.get(id);};
  const ctx=vm.createContext({console,performance,setTimeout,URL,window:{},document:{getElementById:node},
    supabase:{createClient:()=>({})},fetch(){throw Error('Network forbidden');}});
  vm.runInContext(matcher,ctx);vm.runInContext(source.slice(0,source.indexOf('function setMode(')),ctx);
  ctx.fixture=text;ctx.fixtureBarcode=barcode;ctx.fixtureCustomers=directory;ctx.recordWrite=()=>writes.push('receive');
  vm.runInContext(`workspace={customers:fixtureCustomers};
    toCanvas=async x=>x;estimateSkewDegrees=()=>0;deskewCanvas=x=>x;flattenOcrLines=()=>[];
    fastOcrRecognizeDetailed=async()=>({text:fixture,blocks:[]});detectBarcode=async()=>fixtureBarcode;
    runDeepRecovery=async()=>null;receivePackage=async()=>recordWrite();`,ctx);
  return {ctx,node,writes,run:code=>vm.runInContext(code,ctx),async read(){
    const result=await vm.runInContext('readPackagePhoto({width:1600,height:1000})',ctx);
    await vm.runInContext('autoReceiveMatchedPhoto({read_token:intakeReadToken,match:{customer:fixtureCustomers[0],score:1}},{confidence:1,needs_review:false})',ctx);
    assert.deepEqual(writes,[]);return result;
  }};
}

test('actual committed JPEG OCR preserves unmarked name, WAY, UNIT and printed tracking',async()=>{
  const h=harness(jpegText,{directory:[]}),r=await h.read();
  assert.equal(r.candidate,'Jordan Sample');assert.equal(r.address,'123 TEST PARCEL WAY, UNIT 04, MIAMI FL 33101');
  assert.equal(r.tracking,'1ZTEST000000000001');assert.equal(r.tracking_status,'FORMAT_VALID');
  assert.equal(r.match,null);assert.equal(r.status,'NEEDS_REVIEW');assert.equal(h.node('receiveCustomer').value,'');
});

for(const [name,street,unit,city] of [
  ['Morgan Rivera','42 TEST COURT','APT 007','AUSTIN TX 78701'],
  ['Renée Duarte','7 EXAMPLE CIRCLE','SUITE 02','BOSTON MA 02108'],
  ["Taylor O'Neil",'18 DEMO PLACE','# 005','MIAMI FL 33101']
])test('varied recipient and unit are parsed without fixture hardcoding: '+name,async()=>{
  const h=harness([name,street,unit,city,'UPS','TRACKING: 1Z999AA10123456784'].join('\n')),r=await h.read();
  assert.equal(r.candidate.toLocaleLowerCase(),name.toLocaleLowerCase());
  assert.equal(r.address,[street,unit,city].join(', '));assert.equal(r.match,null);
});

test('sender-only personal name or YEN alias cannot become a recipient',async()=>{
  for(const who of ['Trevon Humes','YEN/Trevon Humes']){
    const h=harness('RETURN ADDRESS:\n'+who+'\n123 RETURN ROAD\nMIAMI FL 33101\nUPS\nTRACKING: 1Z999AA10123456784'),r=await h.read();
    assert.equal(r.candidate,'');assert.equal(r.address,'');assert.equal(r.match,null);
  }
});

test('explicit destination excludes the return sender',async()=>{
  const h=harness('FROM:\nTrevon Humes\n123 RETURN ROAD\nMIAMI FL 33101\nSHIP TO:\nMorgan Rivera\n42 TEST COURT\nAPT 007\nAUSTIN TX 78701\nUPS\nTRACKING: 1Z999AA10123456784');
  const r=await h.read();assert.equal(r.candidate,'Morgan Rivera');assert.equal(r.match.customer.id,'morgan');
  assert.doesNotMatch(r.address,/RETURN/);assert.equal(h.node('receiveLabelConfirmed').checked,false);
});

for(const text of [
  'Jordan Sample\n123 EXAMPLE WAY\nMIAMI FL 33101\nMorgan Rivera\n42 TEST COURT\nAUSTIN TX 78701',
  'SHIP TO: Jordan Sample\n123 EXAMPLE WAY\nMIAMI FL 33101\nSHIP TO: Morgan Rivera\n42 TEST COURT\nAUSTIN TX 78701',
  'SHIP TO: Jordan Sample\n123 EXAMPLE WAY\nMIAMI FL 33101\n42 TEST COURT\nAUSTIN TX 78701'
])test('competing address blocks remain unresolved: '+text.slice(0,28),async()=>{
  const r=await harness(text).read();assert.equal(r.candidate,'');assert.equal(r.address,'');assert.equal(r.match,null);
});

test('incomplete name and covered tracking remain missing rather than invented',async()=>{
  const r=await harness('J\n123 EXAMPLE WAY\nMIAMI FL 33101\nUPS\nTRACKING: [covered]\nFICTIONAL').read();
  assert.equal(r.candidate,'');assert.equal(r.tracking,'');assert.equal(r.tracking_status,'MISSING');
});

test('arbitrary long words never become tracking even under a tracking heading',async()=>{
  for(const text of ['FICTIONAL SYNTHETIC','TRACKING: FICTIONAL','TRACKING\nCUSTOMER']){
    const r=await harness(text).read();assert.equal(r.tracking,'');assert.equal(r.tracking_status,'MISSING');
  }
});

test('labelled FedEx tracking retains leading zeroes',async()=>{
  const r=await harness('FedEx\nTRACKING: 001234567890').read();
  assert.equal(r.tracking,'001234567890');assert.equal(r.tracking_status,'FORMAT_VALID');
});

test('Roadie and unfamiliar labelled formats remain visible but unverified',async()=>{
  for(const text of ['ROADIE\nPACKAGE TRACKING CODE\n1r1f231d46301835','TRACKING: ZX-0012345','UPS\nTRACKING: 1Z12345']){
    const h=harness(text),r=await h.read();assert(r.tracking);assert.equal(r.tracking_status,'UNVERIFIED_FORMAT');
    assert.equal(h.node('receiveTracking').dataset.needsReview,'true');assert.match(h.node('labelFields').textContent,/Unfamiliar tracking format/);
  }
});

test('bare unfamiliar digits and arbitrary QR payload are not tracking',async()=>{
  for(const barcode of ['123456789012','FICTIONAL','https://example.invalid/123456789012']){
    const r=await harness('Some unrelated text',{barcode}).read();assert.equal(r.tracking,'');
  }
});

test('printed and barcode disagreement withholds tracking and asks for review',async()=>{
  const h=harness('UPS\nTRACKING: 1Z999AA10123456784',{barcode:'1Z999AA10123456785'}),r=await h.read();
  assert.equal(r.tracking,'');assert.equal(r.tracking_status,'CONFLICT');
  assert.match(h.node('labelFields').textContent,/Conflicting tracking/);
});

test('multiple printed tracking codes conflict instead of silently taking the first',async()=>{
  const r=await harness('UPS\nTRACKING: 1Z999AA10123456784\nTRACKING: 1Z999AA10123456785').read();
  assert.equal(r.tracking,'');assert.equal(r.tracking_status,'CONFLICT');
});

test('multiple native barcode values are compared rather than taking the first',async()=>{
  const r=await harness('UPS',{barcode:['1Z999AA10123456784','1Z999AA10123456785']}).read();
  assert.equal(r.tracking,'');assert.equal(r.tracking_status,'CONFLICT');
});

test('unmarked recovery cannot auto-select a directory customer',async()=>{
  const h=harness('');await h.read();
  assert.equal(h.run('applyRecoveredCustomer({customer:fixtureCustomers[0],score:1},"Jordan Sample\\n123 EXAMPLE WAY\\nMIAMI FL 33101")'),false);
  assert.equal(h.node('receiveCustomer').value,'');assert.deepEqual(h.writes,[]);
});

test('new scan invalidates the prior human confirmation',async()=>{
  const h=harness(jpegText);h.node('receiveLabelConfirmed').checked=true;await h.read();
  assert.equal(h.node('receiveLabelConfirmed').checked,false);
});

for(const marker of ['RETURN TO:','SHIPPER:'])test(marker+' is sender-only evidence',async()=>{
  const r=await harness(marker+'\nJordan Sample\n123 EXAMPLE WAY\nMIAMI FL 33101').read();
  assert.equal(r.candidate,'');assert.equal(r.address,'');assert.equal(r.match,null);
});

test('two postal boxes cannot select the first recipient',async()=>{
  const r=await harness('SHIP TO:\nJordan Sample\nPO BOX 1\nMIAMI FL 33101\nMorgan Rivera\nPO BOX 2\nMIAMI FL 33101').read();
  assert.equal(r.candidate,'');assert.equal(r.address,'');assert.equal(r.match,null);
});

test('street-word surnames and a unit after city are preserved',async()=>{
  const r=await harness('SHIP TO:\nJane Lane\n123 EXAMPLE WAY\nMIAMI FL 33101\nUNIT 04').read();
  assert.equal(r.candidate,'Jane Lane');assert.equal(r.address,'123 EXAMPLE WAY, MIAMI FL 33101, UNIT 04');
});

for(const address of ['123 EXAMPLE WAY','PO BOX 123','UNIT 04'])test('address without recipient does not invent name: '+address,async()=>{
  const r=await harness('SHIP TO:\n'+address+'\nMIAMI FL 33101').read();
  assert.equal(r.candidate,'');assert.equal(r.match,null);
});
