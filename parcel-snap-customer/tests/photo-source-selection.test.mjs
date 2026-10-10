import './isolated-network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const app=read('app.js'),vision=read('vision-client.js'),html=read('index.html'),css=read('styles.css');
const customer={id:'synthetic-customer',name:'Jordan Sample',email:'recipient@example.invalid',contact_version:'a'.repeat(64),contact_email_visible:true};
const parcel={id:'synthetic-package',customer_id:customer.id,customer_name:customer.name,tracking_number:'001234567890',stage:'ORIGIN_RECEIVED',review_version:'b'.repeat(64)};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const preview=file=>'data:image/jpeg;base64,REVIEW-'+file.name;

function harness({useVision=true}={}){
  const nodes=new Map(),requests=[],visionRequests=[],revoked=[],errors=[],prepared=[],alerts=[];
  const node=id=>{
    if(!nodes.has(id)){
      const classes=new Set();
      nodes.set(id,{value:'',files:[],checked:false,disabled:false,textContent:'',innerHTML:'',dataset:{},
        classList:{add(...a){a.forEach(v=>classes.add(v));},remove(...a){a.forEach(v=>classes.delete(v));},contains:v=>classes.has(v),toggle(v,f){const on=f??!classes.has(v);on?classes.add(v):classes.delete(v);return on;}}});
    }
    return nodes.get(id);
  };
  let uuid=0;
  const ctx=vm.createContext({console:{...console,error:e=>errors.push(e),warn:e=>errors.push(e)},performance,setTimeout,window:{},
    document:{getElementById:node,querySelector:()=>({click(){}})},crypto:{randomUUID:()=> 'synthetic-photo-'+(++uuid)},alert:m=>alerts.push(m),
    URL:{createObjectURL:file=>'blob:'+file.name,revokeObjectURL:url=>revoked.push(url)},requestAnimationFrame:fn=>fn(),
    supabase:{createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'synthetic-session'}}})}})},
    async fetch(url,options){assert.match(url,/\/functions\/v1\/parcel-snap-vision$/);const response=deferred();visionRequests.push({url,body:JSON.parse(options.body),...response});return {ok:true,status:200,json:async()=>({result:await response.promise})};}
  });
  const run=code=>vm.runInContext(code,ctx);
  run(read('known-customer-matcher.js'));run(read('vision-result.js'));run(app.slice(0,app.indexOf('function setMode(')));
  const start=app.indexOf('$("receiveCustomer").onchange=');run(app.slice(start,app.indexOf('async function createReceiveCustomer()',start)));
  run(app.slice(app.indexOf('function facilitySort('),app.indexOf('function renderReceiveControls(')));
  const save=app.indexOf('async function receivePackage(){');run(app.slice(save,app.indexOf('document.querySelectorAll(".tab")',save)));
  ctx.fixtureCustomer=structuredClone(customer);ctx.fixtureParcel=structuredClone(parcel);
  run(`workspace={customers:[fixtureCustomer],packages:[fixtureParcel],facilities:[{id:"synthetic-destination",name:"Synthetic destination",active:true}]};loadWorkspace=async()=>{};
    toCanvas=async x=>x;estimateSkewDegrees=()=>0;deskewCanvas=x=>x;flattenOcrLines=()=>[];
    fastOcrRecognizeDetailed=async()=>({text:'',blocks:[]});detectBarcode=async()=>'';runDeepRecovery=async()=>null;`);
  ctx.preparePackageImages=async file=>{prepared.push(file);return {preview:preview(file),vision:'data:image/jpeg;base64,VISION-'+file.name,ocrCanvas:{width:800,height:500},rawOcrCanvas:{width:800,height:500},barcodeCanvas:{width:1200,height:1800}};};
  ctx.compressImage=async file=>{prepared.push(file);return preview(file);};ctx.prepareOcrImage=async file=>preview(file);ctx.prepareBarcodeImage=async()=>({width:1200,height:1800});
  ctx.readFileDataUrl=async file=>{prepared.push(file);return preview(file);};ctx.resizeDataUrl=async data=>data;
  ctx.analyzeTransferImage=async()=>({tracking:'',customer:null,tracking_status:'EMPTY'});
  ctx.api=async body=>{requests.push(structuredClone(body));return {photo_saved:true,email:{status:'SENT'}};};
  if(useVision)run(vision);
  node('receiveOrigin').value='synthetic-origin';node('transferFacility').value='synthetic-destination';
  return {ctx,node,run,requests,visionRequests,revoked,errors,prepared,alerts,
    async select(id,name='synthetic-label.jpg'){const input=node(id);input.onclick({preventDefault(){}});assert.equal(input.value,'','picker reset enables same-file change');input.value='C:\\fakepath\\'+name;input.files=[{name,type:'image/jpeg',size:1234,lastModified:1}];await input.onchange({target:input});await settle();},
    async answer(result,index=0){visionRequests[index].resolve(result);await settle();await settle();},
    confirm(kind){if(kind==='receive'){node('receiveCustomer').value=customer.id;node('receiveCustomer').onchange();}else {node('transferPackage').value=parcel.id;node('transferPackage').onchange();}const checkbox=node(kind==='receive'?'receiveLabelConfirmed':'transferLabelConfirmed');checkbox.checked=true;checkbox.onchange();assert.equal(checkbox.checked,true);}
  };
}

for(const kind of ['package','transfer']){
  test(kind+' has separate accessible single-image camera/gallery metadata',()=>{
    const id=kind+'Photo';const camera=html.match(new RegExp('<input\\b[^>]*id="'+id+'"[^>]*>'))?.[0];const gallery=html.match(new RegExp('<input\\b[^>]*id="'+id+'Gallery"[^>]*>'))?.[0];
    for(const input of [camera,gallery]){assert(input);assert.match(input,/type="file"/);assert.match(input,/accept="image\/\*"/);assert.doesNotMatch(input,/\bmultiple\b/);assert.match(input,/aria-describedby=/);}
    assert.match(camera,/capture="environment"/);assert.doesNotMatch(gallery,/\bcapture\b/);
    assert.match(html,new RegExp('<label class="cameraBox">\\s*<span>[^<]*Choose from gallery</span>\\s*<input id="'+id+'Gallery"'));
    assert.match(html,/phone’s search if available/);assert.match(css,/@media\(max-width:560px\)\{\.photoSources\{grid-template-columns:1fr/);
  });
}
test('gallery uses current camera handler rather than stale pre-vision fallback',async()=>{
  const h=harness({useVision:false});let seen;h.node('packagePhoto').onchange=event=>{seen=event;};const event={target:{files:[{name:'synthetic-label.jpg'}]}};await h.node('packagePhotoGallery').onchange(event);assert.equal(seen,event);
});
for(const useVision of [false,true]){
  for(const id of ['packagePhoto','packagePhotoGallery']){
    test((useVision?'vision':'fallback')+' '+id+' reads chosen file without saving, selecting or confirming',async()=>{
      const h=harness({useVision});await h.select(id);assert.equal(h.prepared.length,1);assert.equal(h.prepared[0],h.node(id).files[0]);assert.equal(h.run('intakePhotoDataUrl'),preview(h.prepared[0]));
      assert.match(h.node('packagePhotoPreview').innerHTML,/src="data:image\/jpeg;base64,REVIEW-synthetic-label.jpg"/);assert.equal(h.node('receiveCustomer').value,'');assert.equal(h.node('receiveLabelConfirmed').checked,false);assert.deepEqual(h.requests,[]);
      if(useVision){assert.equal(h.visionRequests.length,1);assert.equal(h.visionRequests[0].body.image_data_url,'data:image/jpeg;base64,VISION-synthetic-label.jpg');await h.answer(null);}
    });
  }
  test((useVision?'vision':'fallback')+' gallery submits displayed bytes only after manual receive',async()=>{
    const h=harness({useVision});await h.select('packagePhotoGallery');if(useVision)await h.answer(null);h.confirm('receive');const expected=h.run('intakePhotoDataUrl');assert(h.node('packagePhotoPreview').innerHTML.includes('src="'+expected+'"'));
    await h.run('receivePackage()');assert.equal(h.requests.length,1);assert.equal(h.requests[0].photo_data_url,expected);assert.equal(h.requests[0].label_confirmed,true);assert.equal(h.requests[0].confirmed_customer_id,customer.id);assert.equal(h.node('packagePhotoGallery').value,'');assert.equal(h.node('packagePhoto').value,'');
  });
}
for(const id of ['packagePhoto','packagePhotoGallery','transferPhoto','transferPhotoGallery']){
  const kind=id.startsWith('package')?'receive':'transfer',photo=kind==='receive'?'intakePhotoDataUrl':'transferPhotoDataUrl',generation=kind==='receive'?'intakeReadToken':'transferPhotoGeneration';
  test(id+' supports same-file reselection and requires new review',async()=>{
    const h=harness();await h.select(id);h.confirm(kind);const oldGeneration=h.run(generation),oldId=h.run('intakePackageId');await h.select(id);assert(h.run(generation)>oldGeneration);if(kind==='receive')assert.notEqual(h.run('intakePackageId'),oldId);assert.equal(h.node(kind==='receive'?'receiveLabelConfirmed':'transferLabelConfirmed').checked,false);assert.deepEqual(h.requests,[]);
  });
  test(id+' cancellation preserves existing photo, fields, identity and confirmation',async()=>{
    const h=harness();await h.select(id);h.confirm(kind);const previous={photo:h.run(photo),generation:h.run(generation),id:h.run('intakePackageId')};h.node(id).onclick({preventDefault(){}});h.node(id).files=[];await h.node(id).onchange({target:h.node(id)});
    assert.equal(h.run(photo),previous.photo);assert.equal(h.run(generation),previous.generation);assert.equal(h.run('intakePackageId'),previous.id);assert.equal(h.node(kind==='receive'?'receiveLabelConfirmed':'transferLabelConfirmed').checked,true);assert.deepEqual(h.requests,[]);
  });
  test(id+' blocks picker and ignores change during its save',async()=>{
    const h=harness();await h.select(id);const previous=h.run(photo),oldGeneration=h.run(generation);h.run((kind==='receive'?'receiveInFlight':'transferInFlight')+'=true');let prevented=false;
    assert.equal(h.node(id).onclick({preventDefault(){prevented=true;}}),false);assert.equal(prevented,true);await h.node(id).onchange({target:{files:[{name:'ignored.jpg'}]}});assert.equal(h.run(photo),previous);assert.equal(h.run(generation),oldGeneration);assert.deepEqual(h.requests,[]);
  });
}
for(const [firstId,secondId] of [['packagePhoto','packagePhotoGallery'],['packagePhotoGallery','packagePhoto']]){
  test(firstId+' preparation cannot overwrite newer '+secondId,async()=>{
    const h=harness(),old=deferred();let count=0;const prepare=h.ctx.preparePackageImages;h.ctx.preparePackageImages=file=>++count===1?old.promise:prepare(file);const first=h.select(firstId,'old.jpg');await settle();await h.select(secondId,'new.jpg');old.resolve({preview:'data:image/jpeg;base64,STALE',ocrCanvas:{},vision:'data:image/jpeg;base64,STALE'});await first;
    assert.equal(h.run('intakePhotoDataUrl'),'data:image/jpeg;base64,REVIEW-new.jpg');assert.doesNotMatch(h.node('packagePhotoPreview').innerHTML,/STALE|old.jpg/);assert.equal(h.run('intakePhotoPending'),false);assert.equal(h.visionRequests.length,1);assert.deepEqual(h.requests,[]);
  });
  test(firstId+' late vision cannot overwrite newer '+secondId+' review',async()=>{
    const h=harness();await h.select(firstId,'old.jpg');await h.select(secondId,'new.jpg');await h.answer({recipient_name:'Pat Current',confidence:.8,needs_review:true},1);await h.answer({recipient_name:'Alex Stale',confidence:.8,needs_review:true},0);assert.equal(h.node('receiveNewCustomerName').value,'Pat Current');assert.equal(h.node('receiveCustomer').value,'');assert.deepEqual(h.requests,[]);
  });
}
for(const useVision of [false,true]){
  test((useVision?'vision':'fallback')+' unreadable gallery image clears old evidence and supports retry',async()=>{
    const h=harness({useVision});await h.select('packagePhoto');h.confirm('receive');const key=useVision?'preparePackageImages':'compressImage',original=h.ctx[key];h.ctx[key]=async()=>{throw Error('Synthetic unreadable image');};await h.select('packagePhotoGallery','bad.heic');
    assert.equal(h.run('intakePhotoDataUrl'),null);assert.equal(h.node('packagePhotoPreview').innerHTML,'');assert.equal(h.run('intakePhotoPending'),false);assert.match(h.node('processingDetail').textContent,/Could not open this image.*JPG, PNG or WebP/);assert.equal(h.node('receiveLabelConfirmed').checked,false);await h.run('receivePackage()');assert.deepEqual(h.requests,[]);h.ctx[key]=original;await h.select('packagePhotoGallery','good.jpg');assert.equal(h.run('intakePhotoDataUrl'),'data:image/jpeg;base64,REVIEW-good.jpg');
  });
}
test('manual gallery review survives late model results without automatic sending',async()=>{
  const h=harness();await h.select('packagePhotoGallery');h.confirm('receive');await h.answer({recipient_name:'Alex Stale',confidence:.99,needs_review:false,tracking_code:'001234567891'});assert.equal(h.node('receiveCustomer').value,customer.id);assert.equal(h.node('receiveLabelConfirmed').checked,true);assert.deepEqual(h.requests,[]);
});
test('gallery intake saving disables both inputs and restores them after failure',async()=>{
  const h=harness();await h.select('packagePhotoGallery');h.confirm('receive');const save=deferred();h.ctx.api=()=>save.promise;const saving=h.run('receivePackage()');assert.equal(h.node('packagePhoto').disabled,true);assert.equal(h.node('packagePhotoGallery').disabled,true);save.reject(Error('Synthetic save failure'));await saving;assert.equal(h.node('packagePhoto').disabled,false);assert.equal(h.node('packagePhotoGallery').disabled,false);assert.equal(h.run('intakePhotoDataUrl'),'data:image/jpeg;base64,REVIEW-synthetic-label.jpg');
});
for(const id of ['transferPhoto','transferPhotoGallery']){
  test(id+' uses reviewed arrival path and submits displayed bytes',async()=>{
    const h=harness();await h.select(id);assert.equal(h.prepared.length,1);assert.equal(h.node('transferPackage').value,'');assert.equal(h.node('transferLabelConfirmed').checked,false);assert.deepEqual(h.requests,[]);const image=h.run('transferPhotoDataUrl');assert(h.node('transferPhotoPreview').innerHTML.includes('src="'+image+'"'));h.confirm('transfer');await h.node('saveTransfer').onclick();
    assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'destination_arrival');assert.equal(h.requests[0].photo_data_url,image);assert.equal(h.requests[0].label_confirmed,true);assert.equal(h.requests[0].confirmed_customer_id,customer.id);assert.equal(h.node('transferPhotoGallery').value,'');assert.equal(h.node('transferPhoto').value,'');
  });
}
for(const [firstId,secondId] of [['transferPhoto','transferPhotoGallery'],['transferPhotoGallery','transferPhoto']]){
  test(firstId+' cannot replace newer '+secondId+' image or review',async()=>{
    const h=harness(),old=deferred();let count=0;h.ctx.analyzeTransferImage=()=>++count===1?old.promise:Promise.resolve({tracking:'',customer:null});const first=h.select(firstId,'old.jpg');await settle();await h.select(secondId,'new.jpg');h.confirm('transfer');old.resolve({tracking:parcel.tracking_number,tracking_status:'FORMAT_VALID',customer});await first;
    assert.equal(h.run('transferPhotoDataUrl'),'data:image/jpeg;base64,REVIEW-new.jpg');assert.equal(h.node('transferLabelConfirmed').checked,true);assert.equal(h.node('transferPackage').value,parcel.id);assert.deepEqual(h.requests,[]);
  });
}
test('unreadable arrival gallery file removes stale preview, blocks sending and supports retry',async()=>{
  const h=harness();await h.select('transferPhoto');h.confirm('transfer');const original=h.ctx.readFileDataUrl;h.ctx.readFileDataUrl=async()=>{throw Error('Synthetic image failure');};await h.select('transferPhotoGallery','bad.heic');assert.equal(h.run('transferPhotoDataUrl'),null);assert.equal(h.node('transferPhotoPreview').innerHTML,'');assert.equal(h.run('transferPhotoPending'),false);assert.equal(h.node('transferLabelConfirmed').checked,false);assert.match(h.node('transferProcessingDetail').textContent,/Could not open this image/);await h.node('saveTransfer').onclick();assert.deepEqual(h.requests,[]);h.ctx.readFileDataUrl=original;await h.select('transferPhotoGallery','good.jpg');assert.equal(h.run('transferPhotoDataUrl'),'data:image/jpeg;base64,REVIEW-good.jpg');
});

for(const useVision of [false,true]){
  for(const [firstId,secondId] of [['packagePhoto','packagePhotoGallery'],['packagePhotoGallery','packagePhoto'],['transferPhoto','transferPhotoGallery'],['transferPhotoGallery','transferPhoto']]){
    test((useVision?'vision':'fallback')+' '+firstId+' filename survives sibling cancel and clears only on '+secondId+' selection',async()=>{
      const h=harness({useVision}),kind=firstId.startsWith('package')?'receive':'transfer';
      const photo=kind==='receive'?'intakePhotoDataUrl':'transferPhotoDataUrl';
      await h.select(firstId,'first.jpg');h.confirm(kind);
      const previousFile=h.node(firstId).value,previousImage=h.run(photo);
      assert(previousFile.endsWith('first.jpg'));
      h.node(secondId).onclick({preventDefault(){}});h.node(secondId).files=[];
      await h.node(secondId).onchange({target:h.node(secondId)});
      assert.equal(h.node(firstId).value,previousFile);assert.equal(h.run(photo),previousImage);
      assert.equal(h.node(kind==='receive'?'receiveLabelConfirmed':'transferLabelConfirmed').checked,true);
      await h.select(secondId,'second.jpg');
      assert.equal(h.node(firstId).value,'');assert(h.node(secondId).value.endsWith('second.jpg'));
      assert.equal(h.run(photo),'data:image/jpeg;base64,REVIEW-second.jpg');
      assert.equal(h.node(kind==='receive'?'receiveLabelConfirmed':'transferLabelConfirmed').checked,false);
      assert.deepEqual(h.requests,[]);
    });
  }
}
