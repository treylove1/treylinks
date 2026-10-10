import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const customer={id:'fictional-customer',name:'Jordan Sample',email:'recipient@example.invalid'};
const parcel={id:'fictional-package',customer_id:customer.id,customer_name:customer.name,tracking_number:'001234567890',stage:'ORIGIN_RECEIVED'};

function harness(response={photo_saved:true,email:{status:'SENT'}}){
  const nodes=new Map(),requests=[],alerts=[];
  const node=id=>{if(!nodes.has(id)){const classes=new Set();nodes.set(id,{value:'',checked:false,disabled:false,textContent:'',innerHTML:'',dataset:{},classList:{add(...values){values.forEach(value=>classes.add(value));},remove(...values){values.forEach(value=>classes.delete(value));},toggle(value,force){const on=force??!classes.has(value);if(on)classes.add(value);else classes.delete(value);return on;},contains:value=>classes.has(value)}});}return nodes.get(id);};
  const ctx=vm.createContext({console,performance,setTimeout,window:{},crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},
    document:{getElementById:node,querySelector:()=>({click(){}})},
    supabase:{createClient:()=>({})},alert:value=>alerts.push(value),fetch(){throw Error('Network forbidden');}});
  vm.runInContext(app.slice(0,app.indexOf('function setMode(')),ctx);
  ctx.fixtureCustomer=customer;ctx.fixtureParcel=parcel;
  vm.runInContext(`workspace={customers:[fixtureCustomer],packages:[fixtureParcel]};
    intakePhotoDataUrl='data:image/jpeg;base64,FICTIONAL';intakeReadToken=1;
    intakeOcrName='Jordan Sample';intakeOcrText='Jordan Sample';intakeOcrAddress='123 Test Way, Miami FL 33101';
    transferPhotoDataUrl='data:image/jpeg;base64,FICTIONAL-ARRIVAL';
    loadWorkspace=async()=>{};createReceiveCustomer=async()=>fixtureCustomer.id;`,ctx);
  ctx.api=async body=>{requests.push(structuredClone(body));return typeof response==='function'?await response(body):response;};
  const receive=app.indexOf('async function receivePackage(){');
  vm.runInContext(app.slice(receive,app.indexOf('function renderTransferControls()',receive)),ctx);
  const handlers=app.indexOf('$("receiveCustomer").onchange=');
  vm.runInContext(app.slice(handlers,app.indexOf('$("packagePhoto").onchange=',handlers)),ctx);
  const transfer=app.indexOf('for(const id of ["transferPackage","transferFacility"])');
  vm.runInContext(app.slice(transfer,app.indexOf('document.querySelectorAll(".tab")',transfer)),ctx);
  const candidates=app.indexOf('function normalizeTracking(');
  vm.runInContext(app.slice(candidates,app.indexOf('async function analyzeTransferImage(',candidates)),ctx);
  node('receiveCustomer').value=customer.id;node('receiveOrigin').value='fictional-origin';
  node('receiveTracking').value='001234567890';node('receiveCarrier').value='FedEx';
  node('transferPackage').value=parcel.id;node('transferFacility').value='fictional-destination';
  return {ctx,node,requests,alerts,run:code=>vm.runInContext(code,ctx)};
}

test('unconfirmed intake never authorizes customer email and retains its review form',async()=>{
  const h=harness({photo_saved:true,email:{status:'REVIEW_REQUIRED'}});await h.run('receivePackage()');
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].label_confirmed,false);
  assert.equal(h.requests[0].confirmed_customer_id,null);assert(h.run('intakePhotoDataUrl'));
  assert.equal(h.node('receiveTracking').value,'001234567890');
  assert.match(h.node('receiveResult').textContent,/REVIEW_REQUIRED/);
});

test('only explicit intake confirmation sends the exact chosen customer and photo snapshot',async()=>{
  const h=harness();h.node('receiveLabelConfirmed').checked=true;await h.run('receivePackage()');
  const body=h.requests[0];assert.equal(body.label_confirmed,true);assert.equal(body.confirmed_customer_id,customer.id);
  assert.equal(body.customer_id,customer.id);assert.equal(body.tracking_number,'001234567890');
  assert.equal(body.photo_data_url,'data:image/jpeg;base64,FICTIONAL');
  assert.equal(h.run('intakePhotoDataUrl'),null);assert.equal(h.node('receiveLabelConfirmed').checked,false);
});

for(const status of ['FAILED','UNKNOWN','REVIEW_REQUIRED','EMAIL_NOT_LISTED']){
  test('intake '+status+' keeps photo, fields and the same package ID without automatic retry',async()=>{
    const h=harness({photo_saved:true,email:{status,error:'Fictional diagnostic'}});await h.run('receivePackage()');
    assert(h.run('intakePhotoDataUrl'));assert.equal(h.node('receiveTracking').value,'001234567890');
    assert.match(h.node('receiveResult').textContent,/Fictional diagnostic/);
    assert.equal(h.requests.length,1);
    const id=h.requests[0].intake_package_id;
    // An explicitly invoked second attempt retains identity; no timer or callback retries it.
    await h.run('receivePackage()');assert.equal(h.requests[1].intake_package_id,id);
  });
}

test('photo persistence failure does not clear intake evidence',async()=>{
  const h=harness({photo_saved:false,email:{status:'SKIPPED'}});await h.run('receivePackage()');
  assert(h.run('intakePhotoDataUrl'));assert.match(h.node('receiveResult').textContent,/photo needs review/);
});

test('network failure keeps intake for a same-ID recovery',async()=>{
  const h=harness(()=>{throw Error('Fictional upload failure');});await h.run('receivePackage()');
  assert(h.run('intakePhotoDataUrl'));assert.equal(h.node('receivePackageButton').disabled,false);
  assert.match(h.node('receiveResult').textContent,/upload failure/);
});

test('overlapping intake clicks cannot create a second request',async()=>{
  let resolve;const waiting=new Promise(r=>{resolve=r;});
  const h=harness(()=>waiting),first=h.run('receivePackage()');
  await h.run('receivePackage()');assert.equal(h.requests.length,1);
  resolve({photo_saved:true,email:{status:'SENT'}});await first;
});

for(const id of ['receiveNewCustomerName','receiveTracking','receiveAddress','receiveCarrier','receiveNewCustomerEmail']){
  test('editing '+id+' invalidates previous label confirmation',()=>{
    const h=harness();h.node('receiveLabelConfirmed').checked=true;
    h.node(id).value='Changed fictional value';h.node(id).oninput();
    assert.equal(h.node('receiveLabelConfirmed').checked,false);assert.deepEqual(h.requests,[]);
  });
}

test('changing intake customer invalidates previous label confirmation',()=>{
  const h=harness();h.node('receiveLabelConfirmed').checked=true;h.node('receiveCustomer').onchange();
  assert.equal(h.node('receiveLabelConfirmed').checked,false);assert.deepEqual(h.requests,[]);
});

test('address editing preserves spaces while the user is still typing',()=>{
  const h=harness();h.node('receiveAddress').value='42 Test ';h.node('receiveAddress').oninput();
  assert.equal(h.node('receiveAddress').value,'42 Test ');assert.equal(h.run('intakeOcrAddress'),'42 Test ');
});

test('transfer notification uses the selected package customer only after explicit review',async()=>{
  const h=harness();h.node('transferLabelConfirmed').checked=true;await h.node('saveTransfer').onclick();
  const body=h.requests[0];assert.equal(body.action,'destination_arrival');assert.equal(body.label_confirmed,true);
  assert.equal(body.confirmed_customer_id,parcel.customer_id);assert.equal(body.package_id,parcel.id);
  assert.equal(body.photo_data_url,'data:image/jpeg;base64,FICTIONAL-ARRIVAL');
  assert.equal(h.run('transferPhotoDataUrl'),null);assert.equal(h.node('transferLabelConfirmed').checked,false);
});

test('unconfirmed transfer keeps the photo for review and never fabricates photo-save success',async()=>{
  const h=harness({photo_saved:false,email:{status:'REVIEW_REQUIRED'}});await h.node('saveTransfer').onclick();
  assert.equal(h.requests[0].label_confirmed,false);assert.equal(h.requests[0].confirmed_customer_id,null);
  assert(h.run('transferPhotoDataUrl'));assert.match(h.node('transferResult').textContent,/photo needs review/);
});

test('unknown transfer outcome retains evidence and requests a status check',async()=>{
  const h=harness({photo_saved:true,email:{status:'UNKNOWN',error:'Fictional timeout'}});await h.node('saveTransfer').onclick();
  assert(h.run('transferPhotoDataUrl'));assert.equal(h.requests.length,1);
  assert.match(h.node('transferResult').textContent,/Do not retry until its status is checked/);
});

test('overlapping transfer clicks cannot create a second request',async()=>{
  let resolve;const waiting=new Promise(r=>{resolve=r;});const h=harness(()=>waiting);
  const first=h.node('saveTransfer').onclick();await h.node('saveTransfer').onclick();assert.equal(h.requests.length,1);
  resolve({photo_saved:true,email:{status:'SENT'}});await first;
});

test('one active package is not a match when the photo contains no identifying evidence',()=>{
  const h=harness();assert.equal(h.run('chooseTransferCandidates("",null).length'),0);
});

test('changing transfer package invalidates previous label confirmation',()=>{
  const h=harness();h.node('transferLabelConfirmed').checked=true;h.node('transferPackage').onchange();
  assert.equal(h.node('transferLabelConfirmed').checked,false);assert.deepEqual(h.requests,[]);
});

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('receiving is blocked while a replacement photo is still being prepared',async()=>{
  const h=harness();h.run('intakePhotoPending=true');h.node('receiveLabelConfirmed').checked=true;
  await h.run('receivePackage()');assert.equal(h.requests.length,0);assert.match(h.alerts[0],/finish reading/);
});

test('fallback photo event clears old data immediately, reserves identity and blocks overlap',async()=>{
  const h=harness();let uuid=0;h.ctx.crypto.randomUUID=()=> 'photo-'+(++uuid);
  h.run('compressImage=()=>new Promise(()=>{});prepareOcrImage=()=>new Promise(()=>{})');
  const start=app.indexOf('$("packagePhoto").onchange=');
  h.run(app.slice(start,app.indexOf('async function createReceiveCustomer()',start)));
  h.node('packagePhoto').onchange({target:{files:[{name:'first'}]}});
  assert.equal(h.run('intakePhotoDataUrl'),null);assert.equal(h.run('intakePhotoPending'),true);
  const firstToken=h.run('intakeReadToken'),firstId=h.run('intakePackageId');
  await h.run('receivePackage()');assert.equal(h.requests.length,0);
  h.node('packagePhoto').onchange({target:{files:[{name:'second'}]}});
  assert(h.run('intakeReadToken')>firstToken);assert.notEqual(h.run('intakePackageId'),firstId);
  h.run('receiveInFlight=true');const secondId=h.run('intakePackageId');
  await h.node('packagePhoto').onchange({target:{files:[{name:'ignored'}]}});
  assert.equal(h.run('intakePackageId'),secondId);
});

test('delayed Save Customer cannot change a newer selection or its confirmation',async()=>{
  const created=deferred(),h=harness(()=>created.promise);
  const start=app.indexOf('async function createReceiveCustomer(){');
  h.run(app.slice(start,app.indexOf('$("addCustomerButton").onclick=',start)));
  h.run('renderReceiveControls=()=>{}');
  h.node('receiveNewCustomerName').value='Jordan Old';
  const saving=h.node('saveReceiveCustomer').onclick();
  h.node('receiveCustomer').value=customer.id;h.node('receiveCustomer').onchange();
  h.node('receiveLabelConfirmed').checked=true;h.node('receiveLabelConfirmed').onchange();
  created.resolve({customer:{id:'new-old-customer',name:'Jordan Old'}});await saving;
  assert.equal(h.node('receiveCustomer').value,customer.id);assert.equal(h.node('receiveLabelConfirmed').checked,true);
  assert.equal(h.node('processingText').textContent,customer.name);
});

test('new customer created during receive uses the original reviewed snapshot despite later edits',async()=>{
  const created=deferred();const h=harness(body=>body.action==='create_customer'?created.promise:{photo_saved:true,email:{status:'REVIEW_REQUIRED'}});
  const start=app.indexOf('async function createReceiveCustomer(){');h.run(app.slice(start,app.indexOf('$("saveReceiveCustomer").onclick=',start)));
  h.run('renderReceiveControls=()=>{}');h.node('receiveCustomer').value='';
  h.node('receiveNewCustomerName').value='Jordan Old';h.node('receiveLabelConfirmed').checked=true;
  const saving=h.run('receivePackage()');
  h.node('receiveCustomer').value=customer.id;h.node('receiveCustomer').onchange();
  h.node('receiveTracking').value='MANUAL-99999';h.node('receiveTracking').oninput();
  created.resolve({customer:{id:'new-reviewed-customer',name:'Jordan Old'}});await saving;
  assert.equal(h.requests[0].name,'Jordan Old');assert.equal(h.requests[1].customer_id,'new-reviewed-customer');
  assert.equal(h.requests[1].confirmed_customer_id,'new-reviewed-customer');assert.equal(h.requests[1].tracking_number,'001234567890');
  assert.equal(h.node('receiveCustomer').value,customer.id);assert.equal(h.node('receiveLabelConfirmed').checked,false);
});

test('contradictory tracking cannot fall back to another package belonging to the same customer',()=>{
  const h=harness();assert.equal(h.run('chooseTransferCandidates("1Z999AA10123456785",fixtureCustomer.id).length'),0);
});

test('late arrival OCR preserves the explicitly reviewed package and cannot authorize another',async()=>{
  const h=harness(),analysis=deferred();h.ctx.analysisWait=analysis.promise;
  h.run(`workspace.packages.push({id:'other-package',customer_id:'other-customer',customer_name:'Pat Other',tracking_number:'1Z999AA10123456785'});
    readFileDataUrl=async()=> 'data:image/jpeg;base64,NEW';resizeDataUrl=async data=>data;
    analyzeTransferImage=()=>analysisWait;renderTransferControls=()=>{};`);
  const start=app.indexOf('$("transferPhoto").onchange=');
  h.run(app.slice(start,app.indexOf('for(const id of ["transferPackage","transferFacility"])',start)));
  const reading=h.node('transferPhoto').onchange({target:{files:[{name:'arrival'}]}});await settle();
  h.node('transferPackage').value=parcel.id;h.node('transferPackage').onchange();
  h.node('transferLabelConfirmed').checked=true;h.node('transferLabelConfirmed').onchange();
  await h.node('saveTransfer').onclick();assert.equal(h.requests.length,0);
  analysis.resolve({tracking:'1Z999AA10123456785',tracking_status:'FORMAT_VALID',customer:{id:'other-customer'}});await reading;
  assert.equal(h.node('transferPackage').value,parcel.id);assert.equal(h.node('transferLabelConfirmed').checked,true);
  await h.node('saveTransfer').onclick();assert.equal(h.requests[0].package_id,parcel.id);
  assert.equal(h.requests[0].confirmed_customer_id,parcel.customer_id);
});

for(const status of ['UNKNOWN','SENDING'])test('explicit intake status button posts only original event identity for '+status,async()=>{
  const h=harness(body=>body.reconcile_notification
    ?{email:{status:'SENT',provider_id:'fictional-provider-id',provider_event:'delivered'}}
    :{photo_saved:true,email:{status}});
  await h.run('receivePackage()');assert(h.run('intakePhotoDataUrl'),'uncertain outcomes retain photo');
  assert.equal(h.node('receiveEmailRecovery').classList.contains('hidden'),false);assert.equal(h.node('receiveCheckEmailStatus').classList.contains('hidden'),false);
  const id=h.requests[0].intake_package_id;
  h.node('receiveCustomer').value='changed-customer';h.node('receiveOrigin').value='changed-facility';
  h.node('receiveTracking').value='CHANGED-999';h.node('receiveAddress').value='Changed address';
  await h.node('receiveCheckEmailStatus').onclick();
  assert.deepEqual(h.requests[1],{action:'receive_package',intake_package_id:id,origin_facility_id:'fictional-origin',reconcile_notification:true});
  assert.match(h.node('receiveEmailStatus').textContent,/provider acceptance confirmed/);
  assert.match(h.node('receiveEmailStatus').textContent,/does not guarantee inbox delivery/);
  assert.match(h.node('receiveEmailStatus').textContent,/fictional-origin/);
  assert.equal(h.run('arrivalEmailRecovery.receive.status'),'SENT');assert.equal(h.node('receiveCheckEmailStatus').classList.contains('hidden'),true);
  assert(h.run('intakePhotoDataUrl'));assert.equal(h.node('receiveTracking').value,'CHANGED-999');
  await h.node('receiveCheckEmailStatus').onclick();assert.equal(h.requests.length,2,'resolved button cannot issue another request');
});

test('arrival status button retains the original package and arriving facility despite form changes',async()=>{
  const h=harness(body=>body.reconcile_notification?{email:{status:'UNKNOWN',error:'No provider identifier exists.'}}:{photo_saved:true,email:{status:'UNKNOWN'}});
  await h.node('saveTransfer').onclick();
  h.node('transferPackage').value='another-package';h.node('transferFacility').value='another-facility';
  h.run('transferPhotoDataUrl=null');
  await h.node('transferCheckEmailStatus').onclick();
  assert.deepEqual(h.requests[1],{action:'destination_arrival',package_id:parcel.id,facility_id:'fictional-destination',reconcile_notification:true});
  assert.match(h.node('transferEmailStatus').textContent,/Still unresolved/);assert.match(h.node('transferEmailStatus').textContent,/administrator/);
  assert.match(h.node('transferEmailStatus').textContent,/No provider identifier/);assert.equal(h.run('arrivalEmailRecovery.transfer.status'),'UNKNOWN');
});

test('overlapping status clicks issue one reconciliation request, never an arrival resend',async()=>{
  const check=deferred();const h=harness(body=>body.reconcile_notification?check.promise:{photo_saved:true,email:{status:'UNKNOWN'}});
  await h.run('receivePackage()');const first=h.node('receiveCheckEmailStatus').onclick();
  await h.node('receiveCheckEmailStatus').onclick();assert.equal(h.requests.length,2);
  assert.equal(h.node('receiveCheckEmailStatus').disabled,true);
  check.resolve({email:{status:'UNKNOWN'}});await first;
  assert.equal(h.node('receiveCheckEmailStatus').disabled,false);assert.match(h.node('receiveEmailStatus').textContent,/Do not resend/);
});

test('failed status lookup preserves uncertain state and saved evidence without sending',async()=>{
  const h=harness(body=>{if(body.reconcile_notification)throw Error('Fictional status lookup unavailable');return {photo_saved:true,email:{status:'UNKNOWN'}};});
  await h.run('receivePackage()');await h.node('receiveCheckEmailStatus').onclick();
  assert.equal(h.requests.length,2);assert.equal(h.run('arrivalEmailRecovery.receive.status'),'UNKNOWN');
  assert(h.run('intakePhotoDataUrl'));assert.match(h.node('receiveEmailStatus').textContent,/No resend attempted/);
});

test('late status result cannot replace a newer uncertain event',async()=>{
  const check=deferred();const h=harness(body=>body.reconcile_notification?check.promise:{photo_saved:true,email:{status:'UNKNOWN'}});
  await h.run('receivePackage()');const first=h.node('receiveCheckEmailStatus').onclick();
  h.run('intakePackageId="22222222-2222-4222-8222-222222222222"');h.node('receiveTracking').value='NEW-TRACKING-22';
  await h.run('receivePackage()');
  check.resolve({email:{status:'SENT'}});await first;
  assert.equal(h.run('arrivalEmailRecovery.receive.status'),'UNKNOWN');assert.match(h.node('receiveEmailStatus').textContent,/NEW-TRACKING-22/);
});

test('status action is unavailable without an uncertain event and after definitive status',async()=>{
  const h=harness();await h.node('receiveCheckEmailStatus').onclick();await h.node('transferCheckEmailStatus').onclick();
  assert.equal(h.requests.length,0);
  const failed=harness(body=>body.reconcile_notification?{email:{status:'FAILED',error:'Recorded rejection'}}:{photo_saved:true,email:{status:'UNKNOWN'}});
  await failed.run('receivePackage()');await failed.node('receiveCheckEmailStatus').onclick();
  await failed.node('receiveCheckEmailStatus').onclick();assert.equal(failed.requests.length,2);
  assert.match(failed.node('receiveEmailStatus').textContent,/Recorded email status: FAILED/);
});

test('sign-out clears retained status context and ignores its pending response',async()=>{
  const check=deferred();const h=harness(body=>body.reconcile_notification?check.promise:{photo_saved:true,email:{status:'UNKNOWN'}});
  await h.run('receivePackage()');const first=h.node('receiveCheckEmailStatus').onclick();
  h.run('sb.auth={onAuthStateChange:callback=>{globalThis.sessionChange=callback;}}');
  const start=app.indexOf('sb.auth.onAuthStateChange(');h.run(app.slice(start,app.indexOf('\nboot();',start)));
  h.ctx.sessionChange('SIGNED_OUT',null);check.resolve({email:{status:'SENT'}});await first;
  assert.equal(h.run('arrivalEmailRecovery.receive'),null);assert.equal(h.node('receiveEmailStatus').textContent,'');
});

test('a different workspace cannot reuse the previous company status context',async()=>{
  const h=harness({photo_saved:true,email:{status:'UNKNOWN'}});h.run('workspace.company={id:"original-company"}');
  await h.run('receivePackage()');h.run('workspace.company={id:"other-company"}');
  await h.node('receiveCheckEmailStatus').onclick();assert.equal(h.requests.length,1);assert.equal(h.run('arrivalEmailRecovery.receive'),null);
});

for(const kind of ['receive','transfer'])for(const transition of ['sign-out','company change']){
  test('delayed original '+kind+' response cannot recreate status recovery after '+transition,async()=>{
    const save=deferred(),h=harness(()=>save.promise);h.run('workspace.company={id:"original-company"}');
    const pending=kind==='receive'?h.run('receivePackage()'):h.node('saveTransfer').onclick();
    if(transition==='sign-out'){
      h.run('sb.auth={onAuthStateChange:callback=>{globalThis.sessionChange=callback;}}');
      const start=app.indexOf('sb.auth.onAuthStateChange(');h.run(app.slice(start,app.indexOf('\nboot();',start)));
      h.ctx.sessionChange('SIGNED_OUT',null);
    }else h.run('workspace.company={id:"other-company"};clearArrivalEmailRecovery()');
    save.resolve({photo_saved:true,email:{status:'UNKNOWN'}});await pending;
    assert.equal(h.run('arrivalEmailRecovery.'+kind),null);
    assert.equal(h.node(kind+'EmailStatus').textContent,'');
    await h.node(kind+'CheckEmailStatus').onclick();assert.equal(h.requests.length,1);
  });
}

test('status response checks company scope again even before workspace cleanup runs',async()=>{
  const check=deferred(),h=harness(body=>body.reconcile_notification?check.promise:{photo_saved:true,email:{status:'UNKNOWN'}});
  h.run('workspace.company={id:"original-company"}');await h.run('receivePackage()');
  const pending=h.node('receiveCheckEmailStatus').onclick();h.run('workspace.company={id:"other-company"}');
  check.resolve({email:{status:'SENT'}});await pending;
  assert.equal(h.run('arrivalEmailRecovery.receive'),null);assert.equal(h.node('receiveEmailStatus').textContent,'');
});
