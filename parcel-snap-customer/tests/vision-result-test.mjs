import test from 'node:test';
import assert from 'node:assert/strict';
import '../vision-result.js';
const { normalize } = globalThis.ParcelSnapVisionResult;

test('Worker fields adapt to legacy UI without losing units, punctuation or leading zeros', () => {
  const result = normalize({ result: { recipient_name:'JORDAN SAMPLE',address_line:'123 TEST PARCEL WAY',unit:'UNIT 04',city:'MIAMI',state:'FL',zip:'03301-0004',tracking:'001234567890',confidence:.99 } });
  assert.equal(result.tracking_code,'001234567890');
  assert.equal(result.recipient_address,'123 TEST PARCEL WAY\nUNIT 04\nMIAMI FL 03301-0004');
  assert.equal(result.unit,'UNIT 04');
  assert.equal(result.zip,'03301-0004');
  assert.equal(result.needs_review,true);
  assert.equal(result.confidence,.99);
});
test('legacy reader preserves its name, business, full address and tracking', () => {
  const raw={recipient_name:'Jordan Sample',recipient_business:'Example Co.',recipient_address:'12 EXAMPLE AVE\nAPT #007',tracking_code:'000000000001',confidence:.8,needs_review:false};
  const result=normalize(raw);
  for(const key of ['recipient_name','recipient_business','recipient_address','tracking_code','confidence'])assert.equal(result[key],raw[key]);
  assert.equal(result.needs_review,true);
  assert.equal(raw.needs_review,false);
});
test('numeric tracking and postal codes are never stringified after losing leading zeros',()=>{
  const result=normalize({tracking:123456789,zip:33101,confidence:.8});
  assert.equal(result.tracking_code,null);assert.equal(result.zip,null);
  assert.ok(result.review_warnings.some(x=>x.field==='tracking'));
  assert.ok(result.review_warnings.some(x=>x.field==='zip'));
});
test('conflicting tracking values are withheld with both readings available for review',()=>{
  const result=normalize({tracking:'001',tracking_code:'002',confidence:1});
  assert.equal(result.tracking_code,null);assert.deepEqual(result.tracking_candidates,['002','001']);
  assert.ok(result.review_warnings.some(x=>x.code==='CONFLICTING_TRACKING'));
});
test('null placeholders, invalid confidence and overlong fields do not become trusted readings',()=>{
  const result=normalize({recipient_name:'unknown',tracking:'0'.repeat(1001),unit:'N/A',confidence:'100'});
  assert.equal(result.recipient_name,null);assert.equal(result.tracking_code,null);assert.equal(result.unit,null);assert.equal(result.confidence,0);assert.equal(result.needs_review,true);
});
test('envelope and nested review warnings survive normalization without mutating input',()=>{
  const payload={result:{recipient_name:'SAMPLE',confidence:1,review_warnings:[{field:'unit',code:'MISSING',message:'Check unit.'}]},review_warnings:[{field:'tracking',code:'INVALID',message:'Check tracking.'}]};
  const before=JSON.stringify(payload),result=normalize(payload);
  assert.equal(result.review_warnings.length,2);assert.equal(JSON.stringify(payload),before);
});
test('errors, arrays and absent result envelopes never masquerade as successful reads',()=>{
  for(const payload of [null,undefined,[],{error:'VISION_FAILED'},{result:null},{result:[]},{},{unrelated:true},'{}'])assert.equal(normalize(payload),null);
});
test('unrecognized model fields are not copied into the result',()=>{
  const result=normalize(JSON.parse('{"recipient_name":"SAMPLE","confidence":1,"__proto__":{"admin":true},"customer_id":"unsafe","label_confirmed":true}'));
  assert.equal(result.admin,undefined);assert.equal(result.customer_id,undefined);assert.equal(result.label_confirmed,undefined);
});
test('matching mixed-schema address includes a separately printed unit in the displayed address',()=>{
 const result=normalize({recipient_address:'123 EXAMPLE WAY\nMIAMI FL 33101',address_line:'123 EXAMPLE WAY',unit:'UNIT 007',city:'MIAMI',state:'FL',zip:'33101',confidence:.9});
 assert.equal(result.recipient_address,'123 EXAMPLE WAY\nUNIT 007\nMIAMI FL 33101');
 assert.equal(result.unit,'UNIT 007');assert.equal(result.needs_review,true);
});
test('a unit already printed in legacy or structured street text is not duplicated',()=>{
 const base={address_line:'123 EXAMPLE WAY',unit:'UNIT 007',city:'MIAMI',state:'FL',zip:'33101',confidence:.9};
 const legacy='123 EXAMPLE WAY, UNIT 007\nMIAMI FL 33101';
 assert.equal(normalize({...base,recipient_address:legacy}).recipient_address,legacy);
 const structured=normalize({...base,address_line:'123 EXAMPLE WAY UNIT 007'}).recipient_address;
 assert.equal(structured,'123 EXAMPLE WAY UNIT 007\nMIAMI FL 33101');
});
test('conflicting or unsupported separate units are flagged without overwriting or duplicating the legacy reading',()=>{
 for(const recipient_address of ['123 EXAMPLE WAY\nUNIT 008\nMIAMI FL 33101','999 DIFFERENT STREET\nMIAMI FL 33101']){
  const result=normalize({recipient_address,address_line:'123 EXAMPLE WAY',unit:'UNIT 007',city:'MIAMI',state:'FL',zip:'33101',confidence:1});
  assert.equal(result.recipient_address,recipient_address);
  assert.ok(result.review_warnings.some(x=>x.code==='CONFLICTING_ADDRESS'&&x.message.includes('UNIT 007')));
  assert.deepEqual(result.address_candidates,[recipient_address,'123 EXAMPLE WAY\nUNIT 007\nMIAMI FL 33101']);
 }
});

test('a numeric unit is not dropped when it equals the street number',()=>{
 const result=normalize({address_line:'123 EXAMPLE WAY',unit:'123',city:'MIAMI',state:'FL',zip:'33101',confidence:1});
 assert.equal(result.recipient_address,'123 EXAMPLE WAY\n123\nMIAMI FL 33101');
 assert.equal(result.unit,'123');
});
test('conflicting embedded and separate units never become a combined address',()=>{
 const base={address_line:'123 EXAMPLE WAY UNIT 008',unit:'UNIT 007',city:'MIAMI',state:'FL',zip:'33101',confidence:1};
 for(const legacy of [undefined,'123 EXAMPLE WAY UNIT 008\nMIAMI FL 33101']){
  const result=normalize({...base,recipient_address:legacy});
  assert.equal(result.recipient_address,'123 EXAMPLE WAY UNIT 008\nMIAMI FL 33101');
  assert.equal(result.unit,'UNIT 007');
  assert.ok(result.review_warnings.some(x=>x.code==='CONFLICTING_ADDRESS'&&x.message.includes('UNIT 007')));
  assert.deepEqual(result.address_candidates,['123 EXAMPLE WAY UNIT 008\nMIAMI FL 33101','UNIT 007']);
 }
});
