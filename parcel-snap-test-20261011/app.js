import {ReaderEngine,ObsoleteRead,SETTINGS,outputRows,resizePlan,immutableObservation} from './reader-engine.js';
import {proposeFields} from './reader-fields.js';
const $=id=>document.getElementById(id);
let generation=0,photo=null,preparing=false,passes=[],selectedPass=null,storedBytes=0;
const engine=new ReaderEngine(options=>{
  if(!globalThis.Tesseract?.createWorker)throw new Error('The free reader did not load. Check your connection, then reload this page.');
  return globalThis.Tesseract.createWorker('eng',1,options);
},{onState:s=>{syncControls();if(s.phase==='canceling-initialization'||s.phase==='canceling')setStatus(s.message);if(s.phase==='reload-required')setStatus(s.error);}});
function setStatus(text,progress=null){$('status').textContent=text;$('progress').hidden=progress===null;if(progress!==null)$('progress').value=Math.max(0,Math.min(1,progress));}
function syncControls(){const disabled=!photo||preparing||engine.busy||passes.length>=SETTINGS.maxPasses||storedBytes>=SETTINGS.maxStoredBytes;$('read').disabled=disabled;$('rotate').disabled=disabled;$('cancel').disabled=!preparing&&!engine.active;}
function clearResults(){passes=[];storedBytes=0;selectedPass=null;$('results-panel').hidden=true;$('passes').replaceChildren();$('fields').replaceChildren();$('raw-text').textContent='';$('source-rows').replaceChildren();}
async function choose(file){
  if(!file)return;
  const id=++generation;engine.cancel('Photo changed; the previous read was canceled.');preparing=true;
  if(photo?.url)URL.revokeObjectURL(photo.url);photo=null;clearResults();$('photo-area').hidden=true;syncControls();setStatus('Opening your photo…');
  try{
    if(file.size>SETTINGS.maxFileBytes||file.size===0)throw new Error('Choose a photo between 1 byte and 20 MB.');
    if(!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type))throw new Error('Choose a JPEG, PNG, WebP, HEIC or HEIF photo. PDFs and other files are not supported.');
    const bitmap=await createImageBitmap(file);
    let width,height;
    try{width=bitmap.width;height=bitmap.height;resizePlan(width,height);}finally{bitmap.close();}
    const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
    if(id!==generation)return;
    const sha256=Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');
    photo={id:`photo-${id}`,generation:id,file,url:URL.createObjectURL(file),width,height,sha256};
    $('original').src=photo.url;$('photo-area').hidden=false;$('photo-info').textContent=`Original photo · ${width} × ${height} pixels · ${(file.size/1048576).toFixed(1)} MB. Your original file is unchanged.`;
    setStatus(engine.busy?'Photo ready. The previous reader is still stopping; wait, or reload to start fresh.':'Photo ready. Tap “Read original photo”.');
  }catch(e){if(id===generation)setStatus(`Could not open this photo: ${e.message}. If your phone uses HEIC, try a JPEG or screenshot.`);}
  finally{if(id===generation)preparing=false;syncControls();}
}
async function makeCanvas(p,rotation){
  const bitmap=await createImageBitmap(p.file);
  try{
    if(p.generation!==generation)throw new ObsoleteRead('Photo changed.');
    const plan=resizePlan(bitmap.width,bitmap.height,rotation),canvas=document.createElement('canvas');canvas.width=plan.width;canvas.height=plan.height;
    const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw new Error('This browser could not create an image canvas.');
    ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
    if(rotation){ctx.translate(canvas.width,0);ctx.rotate(Math.PI/2);}
    ctx.drawImage(bitmap,0,0,plan.scaledWidth,plan.scaledHeight);return{canvas,plan};
  }finally{bitmap.close();}
}
async function read(rotation){
  if(!photo||engine.busy||preparing)return;
  if(passes.length>=SETTINGS.maxPasses||storedBytes>=SETTINGS.maxStoredBytes){setStatus('This photo session has reached its result limit. Download the results, then choose a photo to start a new session.');return;}
  const p=photo;preparing=true;syncControls();setStatus('Preparing the full photo…');let canvas;
  try{
    const prepared=await makeCanvas(p,rotation);canvas=prepared.canvas;
    if(p.generation!==generation)throw new ObsoleteRead('Photo changed.');
    const passId=`${p.id}:${rotation?'cw90':'original'}:${passes.length+1}`;
    preparing=false;
    const start=performance.now();
    const result=await engine.read(canvas,{photoId:p.id,passId,onProgress:m=>{if(p.generation!==generation)return;setStatus(`${m.status||'Reading'}${Number.isFinite(m.progress)?` · ${Math.round(m.progress*100)}%`:''}`,Number.isFinite(m.progress)?m.progress:null);}});
    if(p.generation!==generation)throw new ObsoleteRead('Photo changed.');
    const raw={text:String(result.data.text??''),confidence:Number.isFinite(result.data.confidence)?result.data.confidence:null,blocks:result.data.blocks??null};
    // Fail without truncation; never present a clipped reading as complete.
    if(new TextEncoder().encode(JSON.stringify(raw)).byteLength>2*1024*1024)throw new Error('The reading was larger than this test can safely display. No partial result was used. Try a closer photo of one label.');
    const rows=outputRows(raw,passId);let fields,fieldError=null;
    try{if(rows.length>SETTINGS.maxProposalRows||rows.some(r=>r.text.length>SETTINGS.maxProposalRowChars))throw new Error('Source rows exceed the bounded field-proposal budget; field proposals were skipped.');fields=proposeFields(rows,{barcodes:[]});}
    catch(e){fieldError=String(e);fields=Object.fromEntries(['recipient','address','tracking','carrier'].map(k=>[k,{status:'UNAVAILABLE',value:null,alternatives:[]}]));}

    const observation=immutableObservation({schema:'parcel-snap-local-reader-test-v1',createdAt:new Date().toISOString(),photo:{id:p.id,sha256:p.sha256,width:p.width,height:p.height,bytes:p.file.size},passId,readId:result.readId,rotation,preparation:prepared.plan,engine:{...SETTINGS},elapsedSeconds:(performance.now()-start)/1000,raw,rows,fields,fieldError,roleVerified:false,customerSelected:null,emailSent:false});
    const observationBytes=new TextEncoder().encode(JSON.stringify(observation)).byteLength;
    if(observationBytes>SETTINGS.maxObservationBytes||storedBytes+observationBytes>SETTINGS.maxStoredBytes)throw new Error('This result exceeds the local evidence budget. Earlier results are unchanged. Download them, then choose a new photo session; no partial result was stored.');
    passes.push(observation);storedBytes+=observationBytes;selectedPass=passId;render();setStatus(`Reading finished in ${observation.elapsedSeconds.toFixed(1)} seconds. Check every field against the photo.${passes.length>=SETTINGS.maxPasses?' Six readings are retained. Download them, then choose a photo for a new session.':''}${fieldError?' Field proposals are unavailable; the complete raw reading is retained.':''}${engine.blockedReason?' '+engine.blockedReason:''}`);
  }catch(e){if(p.generation===generation)setStatus(engine.blockedReason|| (e instanceof ObsoleteRead?e.message:`Reading failed: ${e.message}`));}
  finally{if(p.generation===generation)preparing=false;if(canvas){canvas.width=1;canvas.height=1;}syncControls();}
}
function appendText(parent,tag,text,className){const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;parent.append(n);return n;}
function render(){
  const pass=passes.find(p=>p.passId===selectedPass);if(!pass)return;$('results-panel').hidden=false;$('passes').replaceChildren();
  passes.forEach((p,i)=>{const b=appendText($('passes'),'button',`${i+1}. ${p.rotation?'90° clockwise':'Original'}`);b.type='button';b.setAttribute('aria-pressed',String(p.passId===selectedPass));b.onclick=()=>{selectedPass=p.passId;render();};});
  $('pass-info').textContent=`${pass.rotation?'Clockwise 90°':'Original orientation'} · reader image ${pass.preparation.width} × ${pass.preparation.height} · ${pass.elapsedSeconds.toFixed(1)} seconds · separate, unverified reading`;
  $('fields').replaceChildren();
  for(const [key,label]of[['recipient','Recipient / name'],['address','Address'],['tracking','Tracking'],['carrier','Carrier']]){
    const field=pass.fields[key]||{status:'missing',value:null,alternatives:[]};const card=appendText($('fields'),'section','','field');appendText(card,'h3',label);appendText(card,'div',String(field.status||'unverified').replaceAll('_',' '),'state');
    appendText(card,'div',field.value||'No single proposal — check the full text.','value');
    const alternatives=field.alternatives||[];
    if(alternatives.length){appendText(card,'p','Source proposals (unverified):','hint');const ul=document.createElement('ul');card.append(ul);for(const a of alternatives){const li=appendText(ul,'li',a.value??a.text??a.literal??'');const ids=a.rowIds??a.sourceRowIds??a.rows??[];if(ids.length)appendText(li,'div',`Rows: ${ids.join(', ')}`,'source');}}
  }
  $('field-warnings').textContent=pass.fieldError|| (pass.fields.warnings||[]).join(' ');
  $('raw-text').textContent=pass.raw.text||'(The reader returned no text.)';$('source-rows').replaceChildren();for(const row of pass.rows){const n=appendText($('source-rows'),'div',row.text,'row');appendText(n,'code',`${row.id} · ${row.source}${row.confidence===null?'':` · engine recognition score ${row.confidence.toFixed(1)} (not field accuracy)`}`);}
}
$('camera').addEventListener('change',e=>{choose(e.target.files[0]);e.target.value='';});$('gallery').addEventListener('change',e=>{choose(e.target.files[0]);e.target.value='';});$('read').onclick=()=>read(0);$('rotate').onclick=()=>read(90);
$('cancel').onclick=()=>{if(preparing){generation++;preparing=false;setStatus('Photo preparation canceled. Choose the photo again.');if(photo?.url)URL.revokeObjectURL(photo.url);photo=null;$('photo-area').hidden=true;clearResults();}engine.cancel();syncControls();};
$('export').onclick=()=>{if(!passes.length)return;const blob=new Blob([JSON.stringify({notice:'Local unverified OCR test. No customer selection or email action.',observations:passes},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='parcel-snap-reader-test.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
addEventListener('pagehide',()=>{generation++;preparing=false;engine.cancel('Page closed.');if(photo?.url)URL.revokeObjectURL(photo.url);photo=null;clearResults();$('original').removeAttribute('src');$('photo-area').hidden=true;setStatus('Choose a photo to begin.');syncControls();});
