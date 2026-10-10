import './isolated-network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root=process.env.PARCEL_SOURCE_ROOT||fileURLToPath(new URL('../',import.meta.url));
const app=readFileSync(resolve(root,'app.js'),'utf8');
const vision=readFileSync(resolve(root,'vision-client.js'),'utf8');
const matcher=readFileSync(resolve(root,'known-customer-matcher.js'),'utf8');
const adapter=readFileSync(resolve(root,'vision-result.js'),'utf8');
const customer={id:'fictional-recipient',name:'Jordan Sample',email:'recipient@example.invalid',contact_version:'a'.repeat(64),contact_email_visible:true};
const other={id:'fictional-other',name:'Alex Example',email:'other@example.invalid',contact_version:'b'.repeat(64),contact_email_visible:true};
const candidate={recipient_name:'Jordan Sample',confidence:.8,needs_review:true,
  recipient_address:'123 Fictional Way, Miami FL 33101',tracking_code:'001234567890'};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function harness({customers=[customer],localText=''}={}){
  const nodes=new Map(),pending=[],writes=[],requests=[],revoked=[];
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',dataset:{},
      classList:{add(){},remove(){},toggle(){}}});
    return nodes.get(id);
  };
  const ctx=vm.createContext({console,performance,setTimeout,window:{},
    document:{getElementById:node},crypto:{randomUUID:()=> 'fictional-photo'},
    URL:{createObjectURL:file=> 'blob:'+file.name,revokeObjectURL:url=>revoked.push(url)},
    requestAnimationFrame:fn=>fn(),
    supabase:{createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'fictional-session'}}})}})},
    async fetch(url,options){
      assert.match(url,/\/functions\/v1\/parcel-snap-vision$/);
      requests.push({url,body:JSON.parse(options.body)});
      let resolveResult;
      const result=new Promise(resolve=>{resolveResult=resolve;});
      pending.push(resolveResult);
      return {ok:true,status:200,json:async()=>({result:await result})};
    }
  });
  // Current production declarations and actual change handler. Only I/O and image/OCR
  // primitives are mocked; this is not a physical-camera or hosted-inference test.
  vm.runInContext(matcher,ctx);
  vm.runInContext(adapter,ctx);
  vm.runInContext(app.slice(0,app.indexOf('function setMode(')),ctx);
  // Install the real manual-input/selection event handlers rather than calling the renderer directly.
  const handlersStart=app.indexOf('$("receiveCustomer").onchange=');
  vm.runInContext(app.slice(handlersStart,app.indexOf('$("packagePhoto").onchange=',handlersStart)),ctx);
  ctx.fixtureCustomers=customers;ctx.fixtureText=localText;ctx.recordWrite=()=>writes.push('receivePackage');
  vm.runInContext(`workspace={customers:fixtureCustomers};
    toCanvas=async x=>x; estimateSkewDegrees=()=>0; deskewCanvas=x=>x;
    flattenOcrLines=()=>[]; fastOcrRecognizeDetailed=async()=>({text:fixtureText,blocks:[]});
    detectBarcode=async()=>''; runDeepRecovery=async()=>null;
    receivePackage=async()=>recordWrite();
    preparePackageImages=async file=>({preview:'data:image/jpeg;base64,FICTIONAL',
      vision:'data:image/jpeg;base64,'+file.name,ocrCanvas:{width:800,height:500},rawOcrCanvas:{width:800,height:500}});`,ctx);
  vm.runInContext(vision,ctx);
  return {ctx,node,pending,writes,requests,revoked,
    run:code=>vm.runInContext(code,ctx),
    async select(name='fictional-label'){await node('packagePhoto').onchange({target:{files:[{name}]}});await settle();},
    async answer(result,index=0){assert(pending[index],'vision request exists');pending[index](result);await settle();await settle();}
  };
}

test('tentative vision name appears in input, headline and readout without becoming OCR evidence',async()=>{
  const h=harness();await h.select();await h.answer(candidate);
  assert.equal(h.node('receiveNewCustomerName').value,'Jordan Sample');
  assert.equal(h.node('processingText').textContent,'Jordan Sample');
  assert.match(h.node('processingDetail').textContent,/Possible recipient.*verify/);
  assert.match(h.node('labelFields').textContent,/Name: Jordan Sample/);
  assert.match(h.node('labelFields').textContent,/Tracking: 001234567890/);
  assert.equal(h.run('intakeOcrName'),'');
  assert.equal(h.node('receiveCustomer').value,'');assert.deepEqual(h.writes,[]);
});

test('display correction does not unlock background selection or automatic intake',async()=>{
  const h=harness();await h.select();await h.answer(candidate);
  h.node('receiveOrigin').value='fictional-origin';
  assert.equal(h.run('canBackgroundReplaceCustomer()'),false);
  assert.equal(h.run('applyRecoveredCustomer({customer:fixtureCustomers[0],score:1},"Jordan Sample")'),false);
  await h.run('autoReceiveMatchedPhoto({read_token:intakeReadToken,match:null},{needs_review:true})');
  assert.equal(h.node('receiveCustomer').value,'');assert.deepEqual(h.writes,[]);
});

for(const result of [{...candidate,confidence:.64},{...candidate,recipient_name:''},null]){
  test('missing or low-confidence vision name stays unclear: '+JSON.stringify(result?.recipient_name??null)+' / '+result?.confidence,async()=>{
    const h=harness();await h.select();await h.answer(result);
    assert.equal(h.node('receiveNewCustomerName').value,'');
    assert.equal(h.node('processingText').textContent,'Name not clear');
    assert.match(h.node('labelFields').textContent,/Name: Name not clear/);
    assert.deepEqual(h.writes,[]);
  });
}

test('late tentative vision does not replace a manually typed name',async()=>{
  const h=harness();await h.select();h.node('receiveNewCustomerName').value='Pat Manual';
  h.node('receiveNewCustomerName').oninput();
  await h.answer(candidate);
  assert.equal(h.node('receiveNewCustomerName').value,'Pat Manual');
  assert.equal(h.run('intakeOcrName'),'');assert.deepEqual(h.writes,[]);
  assert.doesNotMatch(h.node('labelFields').textContent,/Jordan Sample/);
});

test('late tentative vision does not replace an explicitly selected customer',async()=>{
  const h=harness({customers:[customer,other]});await h.select();
  h.node('receiveCustomer').value=other.id;h.node('receiveCustomer').onchange();await h.answer(candidate);
  assert.equal(h.node('receiveCustomer').value,other.id);
  assert.equal(h.node('receiveNewCustomerName').value,'');assert.deepEqual(h.writes,[]);
});

test('real manual edit and customer selection events update both headline and readout',async()=>{
  const h=harness({customers:[customer,other]});await h.select();await h.answer(candidate);
  h.node('receiveNewCustomerName').value='Pat Manual';h.node('receiveNewCustomerName').oninput();
  assert.doesNotMatch(h.node('labelFields').textContent,/Jordan Sample/);
  assert.match(h.node('labelFields').textContent,/Name: Pat Manual/);
  assert.equal(h.node('processingText').textContent,'Pat Manual');
  h.node('receiveCustomer').value=other.id;h.node('receiveCustomer').onchange();
  assert.match(h.node('labelFields').textContent,/Name: Alex Example/);
  assert.equal(h.node('processingText').textContent,'Alex Example');
  assert.equal(h.run('intakeOcrName'),'');assert.deepEqual(h.writes,[]);
  h.node('receiveCustomer').value='';h.node('receiveCustomer').onchange();
  assert.match(h.node('labelFields').textContent,/Name: Pat Manual/);
  assert.equal(h.node('processingText').textContent,'Pat Manual');
  assert.deepEqual(h.writes,[]);
});

test('manually clearing a tentative name clears the headline and readout',async()=>{
  const h=harness();await h.select();await h.answer(candidate);
  h.node('receiveNewCustomerName').value='';h.node('receiveNewCustomerName').oninput();
  assert.equal(h.node('processingText').textContent,'Name not clear');
  assert.match(h.node('labelFields').textContent,/Name: Name not clear/);assert.deepEqual(h.writes,[]);
});

test('late tentative vision respects an intentional manual clear',async()=>{
  const h=harness();await h.select();
  h.node('receiveNewCustomerName').value='Pat Manual';h.node('receiveNewCustomerName').oninput();
  h.node('receiveNewCustomerName').value='';h.node('receiveNewCustomerName').oninput();
  await h.answer(candidate);
  assert.equal(h.node('receiveNewCustomerName').value,'');
  assert.equal(h.node('processingText').textContent,'Name not clear');
  assert.match(h.node('labelFields').textContent,/Name: Name not clear/);assert.deepEqual(h.writes,[]);
});

test('old presentation candidate is ignored when the read token changes',async()=>{
  const h=harness();await h.select();await h.answer(candidate);
  h.run('intakeReadToken++;renderLabelReadout()');
  assert.match(h.node('labelFields').textContent,/Name: Name not clear/);
  assert.deepEqual(h.writes,[]);
});

test('a new photo clears the previous candidate before awaiting image preparation',async()=>{
  const h=harness();await h.select();await h.answer(candidate);
  h.run('preparePackageImages=()=>new Promise(()=>{})');
  // A pending preparation is intentional. It must not leave prior presentation state active.
  h.node('packagePhoto').onchange({target:{files:[{name:'second-label'}]}});
  assert.equal(h.run('intakeRecipientDisplay'),null);
  assert.equal(h.node('receiveNewCustomerName').value,'');assert.deepEqual(h.writes,[]);
});

test('a late response from a previous photo cannot overwrite the current candidate',async()=>{
  const h=harness();await h.select('first-label');await h.select('second-label');
  await h.answer({...candidate,recipient_name:'Pat Current'},1);
  await h.answer(candidate,0);
  assert.equal(h.node('receiveNewCustomerName').value,'Pat Current');
  assert.equal(h.node('processingText').textContent,'Pat Current');
  assert.match(h.node('labelFields').textContent,/Name: Pat Current/);assert.deepEqual(h.writes,[]);
});

test('local OCR candidate is not overwritten by tentative vision',async()=>{
  const h=harness({customers:[],localText:'Jordan Sample\n123 Fictional Street\nMiami FL 33101'});
  await h.select();const prior=h.node('receiveNewCustomerName').value;
  assert(prior,'fixture produces a local candidate');
  await h.answer({...candidate,recipient_name:'Pat Vision'});
  assert.equal(h.node('receiveNewCustomerName').value,prior);
  assert.equal(h.run('intakeOcrName'),prior);assert.deepEqual(h.writes,[]);
});

test('existing local-versus-vision customer conflict still requires review',async()=>{
  const h=harness({customers:[customer,other],localText:'Jordan Sample\n123 Fictional Street\nMiami FL 33101'});
  await h.select();await h.answer({...candidate,recipient_name:other.name,confidence:1,needs_review:false});
  assert.equal(h.node('receiveCustomer').value,'');
  assert.equal(h.node('processingText').textContent,'Customer needs review');
  assert.match(h.node('processingDetail').textContent,/OCR and vision disagree/);assert.deepEqual(h.writes,[]);
});

test('even a confident vision match cannot automatically save or send',async()=>{
  const h=harness();await h.select();h.node('receiveOrigin').value='fictional-origin';
  await h.answer({...candidate,confidence:1,needs_review:false});
  assert.equal(h.node('receiveCustomer').value,'');
  assert.equal(h.run('intakeOcrName'),'');
  assert.equal(h.writes.length,0,'a confident match still needs explicit human review and receive');
  await h.run('autoReceiveMatchedPhoto({read_token:intakeReadToken,match:{customer:fixtureCustomers[0],score:1}},null)');
  assert.equal(h.writes.length,0);
});

test('adapter and local-versus-vision tracking conflicts are visible and not silently chosen',async()=>{
  const h=harness();await h.select();
  await h.answer({...candidate,tracking_code:'1Z999AA10123456784',tracking:'1Z999AA10123456785'});
  assert.equal(h.node('receiveTracking').value,'');
  assert.match(h.node('labelFields').textContent,/conflicting tracking|different tracking/i);
  const other=harness({localText:'UPS\nTRACKING: 1Z999AA10123456784'});await other.select();
  await other.answer({...candidate,carrier:'UPS',tracking_code:'1Z999AA10123456785'});
  assert.equal(other.node('receiveTracking').value,'');assert.match(other.node('labelFields').textContent,/tracking disagree/);
  assert.deepEqual(h.writes,[]);assert.deepEqual(other.writes,[]);
});

test('late model tracking preserves manual text and manual clearing',async()=>{
  for(const manual of ['001234567891','']){
    const h=harness();await h.select();h.node('receiveTracking').value=manual;h.node('receiveTracking').oninput();
    await h.answer({...candidate,carrier:'FedEx'});
    assert.equal(h.node('receiveTracking').value,manual);assert.deepEqual(h.writes,[]);
  }
});

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const explicitJordan='SHIP TO:\nJordan Sample\n123 EXAMPLE WAY\nMIAMI FL 33101';

test('new photo clears saved image and invalidates old OCR before preparation finishes',async()=>{
  const h=harness({customers:[customer,other]});const ocr=deferred();h.ctx.ocrWait=ocr.promise;
  h.run('fastOcrRecognizeDetailed=()=>ocrWait');
  const first=h.node('packagePhoto').onchange({target:{files:[{name:'first'}]}});await settle();
  assert(h.run('intakePhotoDataUrl'));
  h.run('preparePackageImages=()=>new Promise(()=>{})');
  h.node('packagePhoto').onchange({target:{files:[{name:'second'}]}});
  assert.equal(h.run('intakePhotoDataUrl'),null);assert.equal(h.run('intakePhotoPending'),true);
  ocr.resolve({text:explicitJordan,blocks:[]});await first;
  assert.equal(h.node('receiveCustomer').value,'');assert.equal(h.node('receiveNewCustomerName').value,'');
});

test('delayed local OCR preserves a manually typed name',async()=>{
  const h=harness();const ocr=deferred();h.ctx.ocrWait=ocr.promise;h.run('fastOcrRecognizeDetailed=()=>ocrWait');
  const reading=h.node('packagePhoto').onchange({target:{files:[{name:'first'}]}});await settle();
  h.node('receiveNewCustomerName').value='Pat Manual';h.node('receiveNewCustomerName').oninput();
  ocr.resolve({text:explicitJordan,blocks:[]});await reading;
  assert.equal(h.node('receiveNewCustomerName').value,'Pat Manual');assert.equal(h.node('receiveCustomer').value,'');
});

test('delayed local OCR preserves selected customer and the confirmation targeting it',async()=>{
  const h=harness({customers:[customer,other]});const ocr=deferred();h.ctx.ocrWait=ocr.promise;h.run('fastOcrRecognizeDetailed=()=>ocrWait');
  const reading=h.node('packagePhoto').onchange({target:{files:[{name:'first'}]}});await settle();
  h.node('receiveCustomer').value=other.id;h.node('receiveCustomer').onchange();
  h.node('receiveLabelConfirmed').checked=true;h.node('receiveLabelConfirmed').onchange();
  ocr.resolve({text:explicitJordan,blocks:[]});await reading;
  assert.equal(h.node('receiveCustomer').value,other.id);assert.equal(h.node('receiveLabelConfirmed').checked,true);
});

test('late vision after a local directory match cannot replace a manual customer choice',async()=>{
  const h=harness({customers:[customer,other],localText:explicitJordan});await h.select();
  assert.equal(h.node('receiveCustomer').value,customer.id);
  h.node('receiveCustomer').value=other.id;h.node('receiveCustomer').onchange();
  await h.answer({...candidate,recipient_name:'Pat Vision'});
  assert.equal(h.node('receiveCustomer').value,other.id);assert.equal(h.node('processingText').textContent,other.name);
});

test('late vision preserves an intentionally cleared address',async()=>{
  const h=harness();await h.select();h.node('receiveAddress').value='';h.node('receiveAddress').oninput();
  await h.answer(candidate);assert.equal(h.node('receiveAddress').value,'');assert.equal(h.run('intakeOcrAddress'),'');
});

test('successful receive invalidates the late vision response before it can repopulate the form',async()=>{
  const h=harness({customers:[customer,other]});await h.select();
  h.ctx.alert=()=>{};h.ctx.document.querySelector=()=>({click(){}});
  h.run('api=async()=>({photo_saved:true,email:{status:"SENT"}});loadWorkspace=async()=>{}');
  const start=app.indexOf('async function receivePackage(){');h.run(app.slice(start,app.indexOf('function renderTransferControls()',start)));
  h.node('receiveOrigin').value='origin';h.node('receiveCustomer').value=other.id;h.node('receiveCustomer').onchange();
  await h.run('receivePackage()');await h.answer(candidate);
  assert.equal(h.run('intakePhotoDataUrl'),null);assert.equal(h.node('receiveNewCustomerName').value,'');
});


test('prepared review photo is byte-identical to saved data before OCR finishes',async()=>{
  const h=harness(),ocr=deferred();h.ctx.ocrWait=ocr.promise;h.run('fastOcrRecognizeDetailed=()=>ocrWait');
  const reading=h.node('packagePhoto').onchange({target:{files:[{name:'original-label'}]}});await settle();
  assert.equal(h.node('packagePhotoPreview').innerHTML,'<img src="'+h.run('intakePhotoDataUrl')+'" alt="Package photo">');
  assert.doesNotMatch(h.node('packagePhotoPreview').innerHTML,/blob:/);
  ocr.resolve({text:'',blocks:[]});await reading;
  assert.equal(h.node('packagePhotoPreview').innerHTML,'<img src="'+h.run('intakePhotoDataUrl')+'" alt="Package photo">');
  assert.deepEqual(h.revoked,['blob:original-label']);assert.deepEqual(h.writes,[]);
});

test('late image preparation cannot replace the newer displayed or saved photo',async()=>{
  const h=harness(),old=deferred();h.ctx.oldPrepared=old.promise;
  h.run('preparePackageImages=file=>file.name==="old"?oldPrepared:Promise.resolve({preview:"data:image/jpeg;base64,NEW",vision:"data:image/jpeg;base64,NEW",ocrCanvas:{width:800,height:500},rawOcrCanvas:{width:800,height:500}})');
  const first=h.node('packagePhoto').onchange({target:{files:[{name:'old'}]}});await settle();
  await h.select('new');
  old.resolve({preview:'data:image/jpeg;base64,OLD'});await first;
  assert.equal(h.run('intakePhotoDataUrl'),'data:image/jpeg;base64,NEW');
  assert.equal(h.node('packagePhotoPreview').innerHTML,'<img src="data:image/jpeg;base64,NEW" alt="Package photo">');
  assert.deepEqual(h.revoked.sort(),['blob:new','blob:old']);assert.deepEqual(h.writes,[]);
});

test('failed image preparation revokes the transient original and leaves no saved photo',async()=>{
  const h=harness();h.ctx.console={...console,error(){}};
  h.run('preparePackageImages=async()=>{throw Error("Fictional image decode failed")}');
  await h.select('bad-image');assert.equal(h.run('intakePhotoDataUrl'),null);
  assert.equal(h.run('intakePhotoPending'),false);assert.deepEqual(h.revoked,['blob:bad-image']);assert.deepEqual(h.writes,[]);
});

test('decoded barcode disagreement must survive a later single vision answer',async()=>{
 const h=harness({customers:[]});
 h.run(`detectBarcode=async()=>[{rawValue:'TBA000000000123',format:'DataMatrix',decoded:true},{rawValue:'TBA000000000456',format:'DataMatrix',decoded:true}]`);
 await h.select();
 assert.equal(h.run('intakeTrackingReview.status'),'CONFLICT');
 assert.equal(h.node('receiveTracking').value,'');
 await h.answer({recipient_name:'',tracking_code:'TBA000000000123',carrier:'Amazon',confidence:1,needs_review:false});
 assert.equal(h.run('intakeTrackingReview.status'),'CONFLICT');
 assert.equal(h.node('receiveTracking').value,'');
});
test('OCR/barcode disagreement must survive unrelated vision tracking',async()=>{
 const h=harness({customers:[],localText:'AMAZON\nTRACKING: TBA000000000456'});
 h.run(`detectBarcode=async()=>[{rawValue:'TBA000000000123',format:'DataMatrix',decoded:true}]`);
 await h.select();
 assert.equal(h.run('intakeTrackingReview.status'),'CONFLICT');
 assert.equal(h.node('receiveTracking').value,'');
 await h.answer({recipient_name:'',tracking_code:'TBA000000000789',carrier:'Amazon',confidence:1,needs_review:false});
 assert.equal(h.run('intakeTrackingReview.status'),'CONFLICT');
 assert.equal(h.node('receiveTracking').value,'');
});
