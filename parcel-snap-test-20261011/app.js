import {proposePaddleFields} from './paddle-fields.js?v=ps-20261011-reader-08';
import {PaddleReaderEngine,PaddleCanceled,PADDLE_SETTINGS,PADDLE_PARAMS,paddleCapabilities,paddlePreparation,drawPaddleFrame,paddleRows} from './paddle-reader.js?v=ps-20261011-reader-08';
import {BUILD_ID,AUTO_RECIPE,wholePassScore,selectWholePass,rotationLabel} from './auto-reading.js?v=ps-20261011-reader-08';
import {ReaderEngine,ObsoleteRead,SETTINGS,outputRows,resizePlan,immutableObservation} from './reader-engine.js?v=ps-20261011-reader-08';
import {proposeFields,qualifyFields} from './reader-fields.js?v=ps-20261011-reader-08';
const $=id=>document.getElementById(id);
let generation=0,photo=null,preparing=false,passes=[],selectedPass=null,storedBytes=0;
let automaticRun=null,automaticRuns=[],automaticSequence=0;
// At most six fixed-size timing reports per photo. Reserve this allowance in
// the existing evidence budget before storing each Paddle observation.
const TIMING_REPORT_RESERVE_BYTES=4096,timingReports=new Map();
function durationOrNull(value){return Number.isFinite(value)&&value>=0?value:null;}
function exactPixelBuffer(pixels){return pixels.byteOffset===0&&pixels.byteLength===pixels.buffer.byteLength?pixels.buffer:pixels.buffer.slice(pixels.byteOffset,pixels.byteOffset+pixels.byteLength);}
function syncExportControls(){const available=passes.length>0||automaticRuns.length>0;for(const id of ['export','export-near-status'])if($(id))$(id).disabled=!available;if($('download-results'))$('download-results').hidden=!available;}

// PNGs capture the actual prepared canvas, never a reconstruction. Keep image
// bytes and transient URLs outside immutable observations and JSON exports.
const PREVIEW_LIMITS=Object.freeze({maxPreviewBytes:16*1024*1024,maxTotalBytes:48*1024*1024,encodeTimeoutMs:15_000});
const previews=new Map(),pendingCaptures=new Map(),previewFailures=new Map();let previewBytes=0;
function releasePreview(passId){const preview=previews.get(passId);if(!preview)return;URL.revokeObjectURL(preview.url);previewBytes-=preview.bytes;previews.delete(passId);}
function cancelPendingCaptures(){for(const capture of pendingCaptures.values())capture.cancel();}
function releasePendingPreviews(){cancelPendingCaptures();for(const [id,preview]of previews)if(!preview.retained)releasePreview(id);}
function clearPreviews(){cancelPendingCaptures();previewFailures.clear();for(const id of previews.keys())releasePreview(id);$('reader-image').removeAttribute('src');$('reader-preview').hidden=true;}
function budgetError(message){const error=new Error(message);error.code='EVIDENCE_BUDGET';return error;}
async function capturePreview(canvas,p,passId,rotation,budgetBytes=PREVIEW_LIMITS.maxPreviewBytes){
  const blob=await new Promise((resolve,reject)=>{
    // toBlob has no abort API. Settle the caller on cancel/deadline, but keep
    // its native-encode lock until this exact callback arrives or page reload.
    let settled=false,nativeFinished=false,timer;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};
    const operation={abandoned:false,cancel:()=>{operation.abandoned=true;finish(new ObsoleteRead('Photo preparation canceled.'));}};
    pendingCaptures.set(passId,operation);
    const complete=(error,value)=>{
      if(nativeFinished)return;nativeFinished=true;
      if(pendingCaptures.get(passId)===operation)pendingCaptures.delete(passId);
      finish(error,value);syncControls();
      if(operation.abandoned&&photo&&!preparing&&!engine.busy&&!paddleEngine.busy)setStatus('The previous preview encode has settled. Photo ready for a new read.');
    };
    timer=setTimeout(()=>{operation.abandoned=true;finish(new Error('The reader-image preview did not finish within 15 seconds. No read was started. Earlier evidence is unchanged. Wait for its encoding to settle, or reload before another read.'));},PREVIEW_LIMITS.encodeTimeoutMs);
    try{canvas.toBlob(value=>complete(value?null:new Error('This browser could not retain the reader-image preview. No read was started.'),value),'image/png');}catch(error){complete(error);}
  });
  if(p.generation!==generation)throw new ObsoleteRead('Photo changed or preparation canceled.');
  if(blob.size>budgetBytes&&budgetBytes<PREVIEW_LIMITS.maxPreviewBytes)throw budgetError('This image exceeds the preview capacity reserved for one automatic reading. No OCR started for this attempt. Earlier evidence is unchanged.');
  if(blob.size>PREVIEW_LIMITS.maxPreviewBytes||previewBytes+blob.size>PREVIEW_LIMITS.maxTotalBytes)throw new Error('The reader-image preview exceeds the 16 MiB per-reading or 48 MiB session limit. Earlier results and previews are unchanged. No new read was started; download the text results before choosing a new photo.');
  const metadata={capture:'actual-processed-canvas-before-ocr',passId,width:canvas.width,height:canvas.height,rotation,mimeType:blob.type,bytes:blob.size};
  const preview={url:URL.createObjectURL(blob),bytes:blob.size,retained:false,metadata};previews.set(passId,preview);previewBytes+=blob.size;return preview;
}
const engine=new ReaderEngine(options=>{
  if(!globalThis.Tesseract?.createWorker)throw new Error('The free reader did not load. Check your connection, then reload this page.');
  return globalThis.Tesseract.createWorker('eng',1,options);
},{onState:s=>{syncControls();if(s.phase==='canceling-initialization'||s.phase==='canceling')setStatus(s.message);if(s.phase==='reload-required')setStatus(s.error);}});
const paddleEngine=new PaddleReaderEngine(()=>import('./paddle-runtime/paddle-runtime.mjs'),{onState:s=>{syncControls();if(s.message)setStatus(s.message);if(s.phase==='reload-required')setStatus(s.error);}});
function setPhotoStatus(text){const target=$('photo-status')||$('status');if(target)target.textContent=text;}
function setStatus(text,progress=null){$('status').textContent=text;$('progress').hidden=progress===null;if(progress!==null)$('progress').value=Math.max(0,Math.min(1,progress));}
function briefError(value){const text=String(value);return text.length>4096?text.slice(0,4096)+'… (error message shortened; this is not recognized text)':text;}
function syncControls(){syncExportControls();const disabled=!photo||!!automaticRun||preparing||engine.busy||paddleEngine.busy||pendingCaptures.size>0||passes.length>=SETTINGS.maxPasses||storedBytes>=SETTINGS.maxStoredBytes||previewBytes>=PREVIEW_LIMITS.maxTotalBytes;$('read').disabled=disabled;$('rotate').disabled=disabled;$('auto-read').disabled=disabled||passes.length+4>SETTINGS.maxPasses||automaticRuns.length>=AUTO_RECIPE.maxRunsPerPhoto||storedBytes+AUTO_RECIPE.summaryReserveBytes+4>SETTINGS.maxStoredBytes;if($('paddle-read'))$('paddle-read').disabled=disabled;$('cancel').disabled=!preparing&&!engine.active&&!paddleEngine.active&&!automaticRun;}
function clearResults(){timingReports.clear();if($('unverified-label'))$('unverified-label').hidden=true;if($('unverified-label-text'))$('unverified-label-text').textContent='';clearPreviews();automaticRuns=[];passes=[];storedBytes=0;selectedPass=null;$('results-panel').hidden=true;$('passes').replaceChildren();$('fields').replaceChildren();$('raw-text').textContent='';$('source-rows').replaceChildren();$('unqualified-evidence').textContent='';$('reading-quality').textContent='';$('automatic-selection').textContent='';$('automatic-run-details').textContent='';$('reader-preview-info').textContent='';if($('timing-summary'))$('timing-summary').textContent='';syncExportControls();}
async function choose(file){
  if(!file)return;
  if(automaticRun)automaticRun.canceled=true;
  const id=++generation;engine.cancel('Photo changed; the previous read was canceled.');paddleEngine.cancel('Photo changed; the previous Paddle read was canceled.');preparing=true;
  if(photo?.url)URL.revokeObjectURL(photo.url);photo=null;clearResults();$('original').removeAttribute('src');$('photo-area').hidden=true;syncControls();setStatus('Opening your photo…');setPhotoStatus('Photo selected. Checking this file…');
  try{
    if(file.size>SETTINGS.maxFileBytes||file.size===0)throw new Error('Choose a photo between 1 byte and 20 MB.');
    if(!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type))throw new Error('Choose a JPEG, PNG, WebP, HEIC or HEIF photo. PDFs and other files are not supported.');
    setPhotoStatus('Opening your photo…');
    const bitmap=await createImageBitmap(file);
    let width,height;
    try{width=bitmap.width;height=bitmap.height;resizePlan(width,height);}finally{bitmap.close();}
    if(id!==generation)return;
    setPhotoStatus('Photo opened. Finishing preparation…');
    const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
    if(id!==generation)return;
    const sha256=Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');
    photo={id:`photo-${id}`,generation:id,file,url:URL.createObjectURL(file),width,height,sha256};
    $('original').src=photo.url;$('photo-area').hidden=false;$('photo-info').textContent=`Original photo · ${width} × ${height} pixels · ${(file.size/1048576).toFixed(1)} MB. Your original file is unchanged.`;
    setPhotoStatus('Photo added. You can read it below.');
    setStatus(pendingCaptures.size?'Photo ready. The previous preview is still encoding; wait, or reload before another read.':(engine.busy||paddleEngine.busy)?'Photo ready. The previous reader is still stopping; wait, or reload to start fresh.':'Photo ready. Tap “Read with Paddle”.');
  }catch(e){if(id===generation){const message=`Could not open this photo: ${e.message}. If your phone uses HEIC, try a JPEG or screenshot.`;setStatus(message);setPhotoStatus(message);}}
  finally{if(id===generation)preparing=false;syncControls();}
}
async function makeCanvas(p,rotation){
  const bitmap=await createImageBitmap(p.file);
  try{
    if(p.generation!==generation)throw new ObsoleteRead('Photo changed or reading canceled.');
    const plan=resizePlan(bitmap.width,bitmap.height,rotation),canvas=document.createElement('canvas');canvas.width=plan.width;canvas.height=plan.height;
    const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw new Error('This browser could not create an image canvas.');
    ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
    if(rotation===90){ctx.translate(canvas.width,0);ctx.rotate(Math.PI/2);}
    else if(rotation===180){ctx.translate(canvas.width,canvas.height);ctx.rotate(Math.PI);}
    else if(rotation===270){ctx.translate(0,canvas.height);ctx.rotate(-Math.PI/2);}
    ctx.drawImage(bitmap,0,0,plan.scaledWidth,plan.scaledHeight);return{canvas,plan};
  }finally{bitmap.close();}
}
async function read(rotation,{automatic=null}={}){
  if(!photo||engine.busy||paddleEngine.busy||preparing||pendingCaptures.size>0||(automaticRun&&automatic!==automaticRun)||automatic?.canceled)return {status:'NOT_STARTED',error:'The reader is busy or this run was canceled.'};
  if(passes.length>=SETTINGS.maxPasses||storedBytes>=SETTINGS.maxStoredBytes){setStatus('This photo session has reached its result limit. Download the results, then choose a photo to start a new session.');return;}
  if(previewBytes>=PREVIEW_LIMITS.maxTotalBytes){setStatus('This photo session has reached its 48 MiB reader-image preview limit. Earlier evidence is unchanged; download text results before choosing a new photo.');return;}
  const p=photo;preparing=true;syncControls();setStatus('Preparing the full photo…');let canvas,preview,passId;
  try{
    const prepared=await makeCanvas(p,rotation);canvas=prepared.canvas;
    if(p.generation!==generation||automatic?.canceled)throw new ObsoleteRead('Photo changed or reading canceled.');
    passId=`${p.id}:${automatic?automatic.id+':':''}${rotation?`cw${rotation}`:'original'}:${passes.length+1}`;
    preview=await capturePreview(canvas,p,passId,rotation,automatic?.perPreviewBytes??PREVIEW_LIMITS.maxPreviewBytes);
    if(p.generation!==generation||automatic?.canceled)throw new ObsoleteRead('Photo changed or reading canceled.');
    preparing=false;
    const start=performance.now();
    const result=await engine.read(canvas,{photoId:p.id,passId,mode:automatic?'automatic':'original',onProgress:m=>{if(p.generation!==generation)return;setStatus(`${m.status||'Reading'}${Number.isFinite(m.progress)?` · ${Math.round(m.progress*100)}%`:''}`,Number.isFinite(m.progress)?m.progress:null);}});
    if(p.generation!==generation||automatic?.canceled)throw new ObsoleteRead('Photo changed or reading canceled.');
    if(previews.get(passId)!==preview)throw new ObsoleteRead('This read was canceled.');
    const raw={text:String(result.data.text??''),confidence:Number.isFinite(result.data.confidence)?result.data.confidence:null,blocks:result.data.blocks??null};
    // Fail without truncation; never present a clipped reading as complete.
    if(new TextEncoder().encode(JSON.stringify(raw)).byteLength>2*1024*1024)throw new Error('The reading was larger than this test can safely display. No partial result was used. Try a closer photo of one label.');
    const rows=outputRows(raw,passId);let fields,originalFields,fieldError=null;
    try{if(rows.length>SETTINGS.maxProposalRows||rows.some(r=>r.text.length>SETTINGS.maxProposalRowChars))throw new Error('Source rows exceed the bounded field-proposal budget; field proposals were skipped.');originalFields=proposeFields(rows,{barcodes:[]});fields=qualifyFields(originalFields);}
    catch(e){fieldError=String(e);fields=Object.fromEntries(['recipient','address','tracking','carrier'].map(k=>[k,{status:'UNAVAILABLE',value:null,alternatives:[]}]));}

    const observation=immutableObservation({schema:'parcel-snap-local-reader-test-v3',buildId:BUILD_ID,createdAt:new Date().toISOString(),photo:{id:p.id,sha256:p.sha256,width:p.width,height:p.height,bytes:p.file.size},passId,readId:result.readId,rotation,readingMode:automatic?'automatic':'original',automaticRunId:automatic?.id??null,selectionScore:automatic?wholePassScore(result.data):null,internalDeskewRadians:automatic&&Number.isFinite(result.data.rotateRadians)?result.data.rotateRadians:null,preparation:prepared.plan,readerPreview:preview.metadata,engine:{...SETTINGS,...result.recipe},elapsedSeconds:(performance.now()-start)/1000,raw,rows,originalFields:originalFields??null,fields,fieldError,roleVerified:false,customerSelected:null,emailSent:false});
    const observationBytes=new TextEncoder().encode(JSON.stringify(observation)).byteLength;
    if(automatic&&observationBytes>automatic.perObservationBytes)throw budgetError('This result exceeds the evidence capacity reserved for one automatic reading. Earlier readings are unchanged; no partial result was retained.');
    if(observationBytes>SETTINGS.maxObservationBytes||storedBytes+observationBytes>SETTINGS.maxStoredBytes)throw new Error('This result exceeds the local evidence budget. Earlier results are unchanged. Download them, then choose a new photo session; no partial result was stored.');
    preview.retained=true;passes.push(observation);storedBytes+=observationBytes;selectedPass=passId;render();setStatus(`Reading finished in ${observation.elapsedSeconds.toFixed(1)} seconds. Check every field against the photo.${passes.length>=SETTINGS.maxPasses?' Six readings are retained. Download them, then choose a photo for a new session.':''}${fieldError?' Field proposals are unavailable; the complete raw reading is retained.':''}${engine.blockedReason?' '+engine.blockedReason:''}`);return {status:'COMPLETE',observation,selectionEligible:!engine.blockedReason};
  }catch(e){if(p.generation===generation)setStatus(engine.blockedReason|| (e instanceof ObsoleteRead?e.message:`Reading failed: ${e.message}`));return {status:e instanceof ObsoleteRead?'CANCELED':'FAILED',error:String(e.message??e),code:e.code??null};}
  finally{if(preview&&!preview.retained&&previews.get(passId)===preview)releasePreview(passId);if(p.generation===generation)preparing=false;if(canvas){canvas.width=1;canvas.height=1;}syncControls();}
}
async function readPaddle(){
  // Start before preparation, unlike the legacy engine-only duration.
  const tapStarted=performance.now();
  if(!photo||engine.busy||paddleEngine.busy||preparing||automaticRun||pendingCaptures.size)return;
  const capability=paddleCapabilities();
  if(!capability.supported){setStatus('This browser lacks the features needed for Paddle. Use one of the Tesseract buttons below.');return;}
  if(passes.length>=SETTINGS.maxPasses||storedBytes>=SETTINGS.maxStoredBytes){setStatus('This photo session has reached its result limit. Download the results, then choose a photo.');return;}
  const p=photo;preparing=true;syncControls();setStatus('Preparing the full photo for Paddle…');let canvas,preview,passId;
  const phases={};let stage=performance.now();
  try{
    const bitmap=await createImageBitmap(p.file);phases.decodeMs=performance.now()-stage;stage=performance.now();let plan;
    try{if(p.generation!==generation)throw new PaddleCanceled('Photo changed or reading canceled.');plan=paddlePreparation(bitmap.width,bitmap.height);canvas=document.createElement('canvas');canvas.width=plan.width;canvas.height=plan.height;const ctx=canvas.getContext('2d',{alpha:true,willReadFrequently:true});if(!ctx)throw new Error('This browser could not prepare the full image.');drawPaddleFrame(ctx,bitmap,plan);}
    finally{bitmap.close();}
    phases.drawAndCloseMs=performance.now()-stage;
    passId=`${p.id}:paddle:${passes.length+1}`;stage=performance.now();
    preview=await capturePreview(canvas,p,passId,0);phases.previewEncodeMs=performance.now()-stage;
    if(p.generation!==generation)throw new PaddleCanceled('Photo changed or reading canceled.');
    stage=performance.now();let pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;phases.rgbaReadMs=performance.now()-stage;
    stage=performance.now();const digest=await crypto.subtle.digest('SHA-256',pixels);phases.pixelHashMs=performance.now()-stage;
    if(p.generation!==generation)throw new PaddleCanceled('Photo changed or reading canceled.');
    const pixelSha256=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
    stage=performance.now();const transferBufferCopied=pixels.byteOffset!==0||pixels.byteLength!==pixels.buffer.byteLength;
    const buffer=exactPixelBuffer(pixels);pixels=null;phases.transferBufferMs=performance.now()-stage;
    // The exact PNG and hashed transfer bytes are now secured. Release the
    // full-frame canvas before worker initialization, without using it again.
    stage=performance.now();canvas.width=1;canvas.height=1;canvas=null;phases.canvasReleaseMs=performance.now()-stage;
    preparing=false;const start=performance.now();
    const output=await paddleEngine.read({width:plan.width,height:plan.height,buffer,pixelSha256,sourceSha256:p.sha256},{photoId:p.id,passId});phases.engineRoundTripMs=performance.now()-start;
    if(p.generation!==generation||previews.get(passId)!==preview)throw new PaddleCanceled('Photo changed or reading canceled.');
    stage=performance.now();const native=output.result;
    if(native.image.width!==plan.width||native.image.height!==plan.height||output.input?.pixelSha256!==pixelSha256||output.input?.sourceSha256!==p.sha256||output.input?.width!==plan.width||output.input?.height!==plan.height)throw new Error('Paddle source-frame verification failed. No result was used.');
    const rows=paddleRows(native,passId,output.rawMethodReturns);const raw={text:native.items.map(item=>item.text).join('\n'),textProjection:'Native lines joined by one newline; no character edits',sdkResult:native,rawMethodReturns:output.rawMethodReturns};phases.sourceValidationMs=performance.now()-stage;
    stage=performance.now();let fields,originalFields,paddleProposals,fieldError=null;
    try{const proposed=proposePaddleFields(rows,{barcodes:[]});originalFields=proposed.originalFields;paddleProposals=proposed.proposals;fields=proposed.fields;}catch(error){fieldError=String(error);fields=Object.fromEntries(['recipient','address','tracking','carrier'].map(k=>[k,{status:'UNAVAILABLE',value:null,alternatives:[]} ]));}phases.fieldProjectionMs=performance.now()-stage;
    stage=performance.now();
    const observation=immutableObservation({schema:'parcel-snap-local-reader-test-v3',buildId:BUILD_ID,createdAt:new Date().toISOString(),photo:{id:p.id,sha256:p.sha256,width:p.width,height:p.height,bytes:p.file.size},passId,readId:output.readId,rotation:0,readingMode:'paddle',automaticRunId:null,selectionScore:null,internalDeskewRadians:null,preparation:{...plan,pixelSha256},readerPreview:preview.metadata,engine:{...PADDLE_SETTINGS,predictParams:PADDLE_PARAMS,actualRuntime:output.runtimeProvenance,initialization:output.initialization},elapsedSeconds:(performance.now()-start)/1000,elapsedSecondsScope:'Legacy engine and evidence preparation only; see timingReports for Read tap to result DOM update',raw,rows,originalFields:originalFields??null,paddleProposals:paddleProposals??null,fields,fieldError,roleVerified:false,customerSelected:null,emailSent:false});
    const bytes=new TextEncoder().encode(JSON.stringify(observation)).byteLength+TIMING_REPORT_RESERVE_BYTES;
    if(bytes>SETTINGS.maxObservationBytes||storedBytes+bytes>SETTINGS.maxStoredBytes)throw new Error('Paddle result exceeds the local evidence budget. Earlier readings are unchanged.');
    preview.retained=true;passes.push(observation);storedBytes+=bytes;selectedPass=passId;phases.evidenceStoreMs=performance.now()-stage;
    stage=performance.now();render();phases.resultDomUpdateMs=performance.now()-stage;
    const tapToResultMs=performance.now()-tapStarted;
    const timing=immutableObservation({passId,readingMode:'paddle',unit:'milliseconds',tapToResultMs,scope:'Read handler entry through first synchronous result DOM update; excludes photo selection and physical screen paint',phases,engine:Object.fromEntries(['runtimeModuleMs','workerInitializeMs','predictRoundTripMs','envelopeCheckMs','hardCleanupMs','engineTotalMs'].map(key=>[key,durationOrNull(output.timings?.[key])])),nativeSdk:{initializationMs:durationOrNull(output.initialization?.elapsedMs),detectionMs:durationOrNull(native.metrics?.detMs),recognitionMs:durationOrNull(native.metrics?.recMs),pipelineMs:durationOrNull(native.metrics?.totalMs)},transferBufferCopied,workerLifecycle:'fresh one-shot worker',overlapNotice:'Engine and native SDK timings are nested inside engineRoundTripMs; do not sum nested timings. HTTP cache hits are not measured.'});
    if(new TextEncoder().encode(JSON.stringify(timing)).byteLength>TIMING_REPORT_RESERVE_BYTES)throw new Error('Timing report exceeded its reserved evidence budget.');
    timingReports.set(passId,timing);renderPassInfo(observation);

    setStatus(`Paddle finished in ${(tapToResultMs/1000).toFixed(1)} seconds from Read tap. Check every character against the photo. Download results below to keep the text and timings.`);
  }catch(error){if(p.generation===generation)setStatus(paddleEngine.blockedReason||(error instanceof PaddleCanceled||error instanceof ObsoleteRead?error.message:`Paddle could not finish: ${error.message}. Tesseract remains available.`));}
  finally{if(preview&&!preview.retained&&previews.get(passId)===preview)releasePreview(passId);if(p.generation===generation)preparing=false;if(canvas){canvas.width=1;canvas.height=1;}syncControls();}
}
async function readAutomatic(){
  if(!photo||automaticRun||engine.busy||paddleEngine.busy||preparing||pendingCaptures.size)return;
  if(passes.length+AUTO_RECIPE.rotations.length>SETTINGS.maxPasses){setStatus('Automatic reading needs four free reading slots. Download earlier results and start a new photo session.');return;}
  if(automaticRuns.length>=AUTO_RECIPE.maxRunsPerPhoto||storedBytes+AUTO_RECIPE.summaryReserveBytes+4>SETTINGS.maxStoredBytes){setStatus('This session has no capacity for another automatic comparison. Download the results and choose a new photo.');return;}
  const run={id:`auto-${++automaticSequence}`,photoId:photo.id,generation,canceled:false,attempts:[],perPreviewBytes:Math.min(PREVIEW_LIMITS.maxPreviewBytes,Math.floor((PREVIEW_LIMITS.maxTotalBytes-previewBytes)/4)),perObservationBytes:Math.min(SETTINGS.maxObservationBytes,Math.floor((SETTINGS.maxStoredBytes-storedBytes-AUTO_RECIPE.summaryReserveBytes)/4)),startedAt:new Date().toISOString()};automaticRun=run;syncControls();
  const timer=setTimeout(()=>{if(run.generation!==generation||automaticRun!==run)return;run.canceled=true;run.cancelReason='The six-minute automatic-reading deadline was reached.';releasePendingPreviews();engine.cancel('The six-minute automatic-reading deadline was reached. Completed readings are retained.');setStatus('Automatic reading timed out. Completed readings are retained; wait for the active reader to stop or reload.');},AUTO_RECIPE.batchTimeoutMs);
  try{
    for(const rotation of AUTO_RECIPE.rotations){
      if(run.canceled||run.generation!==generation)break;
      if(engine.blockedReason||pendingCaptures.size)break;
      setStatus(`Automatic reading ${run.attempts.length+1} of 4 · ${rotationLabel(rotation)}…`);
      const outcome=await read(rotation,{automatic:run});
      if(outcome?.status==='COMPLETE'){const p=outcome.observation;run.attempts.push({rotation,status:outcome.selectionEligible?'COMPLETE':'COMPLETE_BEFORE_CLEANUP_FAILURE',passId:p.passId,selectionScore:p.selectionScore,error:outcome.selectionEligible?null:briefError(engine.blockedReason)});}
      else run.attempts.push({rotation,status:outcome?.status||'NOT_STARTED',selectionScore:null,error:briefError(outcome?.error||'Reading could not start within this session’s evidence budget.')});
      if(outcome?.code==='EVIDENCE_BUDGET'||outcome?.status==='NOT_STARTED'||!outcome||outcome?.status==='CANCELED'||run.canceled||run.generation!==generation||engine.blockedReason||pendingCaptures.size)break;
    }
    if(run.generation!==generation)return;
    for(const rotation of AUTO_RECIPE.rotations)if(!run.attempts.some(p=>p.rotation===rotation))run.attempts.push({rotation,status:'NOT_RUN',selectionScore:null,error:run.canceled?'Automatic reading canceled.':'Reader cleanup, preview or evidence budget prevented another reading.'});
    const comparisonComplete=!run.canceled&&run.attempts.length===4&&run.attempts.every(p=>p.status==='COMPLETE');
    const choice=comparisonComplete?selectWholePass(run.attempts):null;
    const summary=immutableObservation({id:run.id,buildId:BUILD_ID,comparisonComplete,photoId:run.photoId,startedAt:run.startedAt,finishedAt:new Date().toISOString(),recipe:AUTO_RECIPE,perPreviewBytes:run.perPreviewBytes,perObservationBytes:run.perObservationBytes,canceled:run.canceled,cancelReason:run.cancelReason??null,attempts:run.attempts,selectedPassId:choice?.passId??null,selectionNotice:'Whole-reading engine-confidence ranking only. No fields combined. No optical correctness or recipient verified.'});const summaryBytes=new TextEncoder().encode(JSON.stringify(summary)).byteLength;if(summaryBytes>AUTO_RECIPE.summaryReserveBytes)throw new Error('Automatic comparison details exceeded their reserved budget. Completed readings remain unchanged.');storedBytes+=summaryBytes;automaticRuns.push(summary);$('results-panel').hidden=false;$('automatic-run-details').textContent=JSON.stringify({...summary,displayedPassId:selectedPass,allRecordedComparisons:automaticRuns},null,2);
    if(choice){selectedPass=choice.passId;render();setStatus(`${run.attempts.filter(p=>p.status==='COMPLETE').length} of 4 automatic readings completed. Showing the highest whole-reading score. This does not verify any field; compare the image and full text.${engine.blockedReason?' '+engine.blockedReason:''}`);}
    else {if(passes.length)render();setStatus(run.canceled?(run.cancelReason?run.cancelReason+' Completed readings remain available.':'Automatic reading canceled. Completed readings remain available.'):engine.blockedReason||'Automatic comparison incomplete. No reading was chosen by the ranking. Retained readings remain available for manual review.');}
  }catch(error){if(run.generation===generation)setStatus(`Automatic reading stopped: ${briefError(error.message??error)}. Completed readings remain available.`);}
  finally{clearTimeout(timer);if(automaticRun===run)automaticRun=null;syncControls();}
}
function appendText(parent,tag,text,className){const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;parent.append(n);return n;}
function renderPassInfo(pass){
  const timing=timingReports.get(pass.passId),summary=$('timing-summary');
  if(summary){
    const seconds=value=>Number.isFinite(value)?`${(value/1000).toFixed(1)} s`:'not available';
    const prep=timing?['decodeMs','drawAndCloseMs','previewEncodeMs','rgbaReadMs','pixelHashMs','transferBufferMs','canvasReleaseMs'].reduce((n,key)=>n+timing.phases[key],0):null;
    summary.textContent=timing?`Selected Paddle reading: ${seconds(timing.tapToResultMs)} from Read tap to result · preparation ${seconds(prep)} · reader setup ${seconds(timing.engine?.workerInitializeMs)} · detection + recognition ${seconds(timing.nativeSdk.pipelineMs)}. Full timings are in the download.`:'';
  }

  $('pass-info').textContent=`${pass.readingMode==='paddle'?'Paddle · full photo':rotationLabel(pass.rotation)+(pass.readingMode==='automatic'?' · Tesseract sparse-text + internal deskew':' · Tesseract')} · supplied image ${pass.preparation.width} × ${pass.preparation.height}${pass.readingMode==='paddle'&&pass.preparation.resized?` · full-frame downsize from ${pass.preparation.originalWidth} × ${pass.preparation.originalHeight} (scale ${pass.preparation.scaleX.toFixed(4)} × ${pass.preparation.scaleY.toFixed(4)})`:''} · ${((timingReports.get(pass.passId)?.tapToResultMs??pass.elapsedSeconds*1000)/1000).toFixed(1)} seconds${timingReports.has(pass.passId)?' from Read tap':''} · separate, unverified reading`;
}
function render(){
  const pass=passes.find(p=>p.passId===selectedPass);if(!pass)return;$('results-panel').hidden=false;$('passes').replaceChildren();
  passes.forEach((p,i)=>{const b=appendText($('passes'),'button',`${i+1}. ${p.readingMode==='paddle'?'Paddle · full photo':rotationLabel(p.rotation)+(p.readingMode==='automatic'?' · auto':' · Tesseract')}`);b.type='button';b.setAttribute('aria-pressed',String(p.passId===selectedPass));b.onclick=()=>{selectedPass=p.passId;render();};});
  renderPassInfo(pass);
  const preview=previews.get(pass.passId);$('reader-preview').hidden=false;
  // A fresh display node binds load/error events to this pass. An old image's
  // late error cannot release a newly selected pass's retained preview.
  const readerImage=document.createElement('img');readerImage.id='reader-image';readerImage.hidden=!preview;
  readerImage.alt=`Exact processed canvas for ${pass.passId}, ${rotationLabel(pass.rotation)}, ${pass.preparation.width} by ${pass.preparation.height} pixels`;
  readerImage.onerror=()=>{if($('reader-image')!==readerImage||selectedPass!==pass.passId||previews.get(pass.passId)!==preview||!preview)return;previewFailures.set(pass.passId,'This reading’s captured preview could not be displayed. Its image URL was released; the recorded dimensions, raw text and original proposals are unchanged.');releasePreview(pass.passId);render();syncControls();};
  $('reader-image-container').replaceChildren(readerImage);if(preview)readerImage.src=preview.url;
  $('reader-preview-info').textContent=preview?`Exact processed canvas captured before OCR · ${pass.passId} · ${rotationLabel(pass.rotation)} · ${preview.metadata.width} × ${preview.metadata.height} pixels · full frame.${pass.readingMode==='paddle'&&pass.preparation.resized?` Downscaled from ${pass.preparation.originalWidth} × ${pass.preparation.originalHeight}; no crop. Large-photo reading accuracy has not been measured.`:''} Not regenerated.${pass.readingMode==='automatic'?` This is the canvas supplied before Tesseract’s internal deskew (${pass.internalDeskewRadians===null?'angle unavailable':(pass.internalDeskewRadians*180/Math.PI).toFixed(2)+'°'}), not the final deskewed raster.`:''} The reader result does not establish image readability.`:(previewFailures.get(pass.passId)||'This reading’s image preview is no longer available. Its text evidence is unchanged.');
  if($('unverified-label'))$('unverified-label').hidden=pass.readingMode!=='paddle';
  if($('unverified-label-text'))$('unverified-label-text').textContent=pass.readingMode==='paddle'?(pass.raw.text||'(The reader returned no text.)'):'';
  $('reading-quality').textContent=pass.readingMode==='paddle'?'Literal text is shown beside the photo. Field roles may remain unresolved; check every character and do not treat these proposals as accepted records.':pass.fields.status==='REVIEW_REQUIRED'?'Structurally supported proposals. Check every character against the image; optical correctness has not been assessed.':'Couldn’t read reliably. Some fields are incomplete or unclassified; all raw text and original proposal evidence are retained below. This is a structural check, not a measure of optical accuracy.';
  $('fields').replaceChildren();
  for(const [key,label]of[['recipient','Recipient / name'],['address','Address'],['tracking','Tracking'],['carrier','Carrier']]){
    const field=pass.fields[key]||{status:'missing',value:null,alternatives:[]};const card=appendText($('fields'),'section','','field');appendText(card,'h3',label);appendText(card,'div',String(field.status||'unverified').replaceAll('_',' '),'state');
    appendText(card,'div',field.value||(pass.readingMode==='paddle'?'No verified field role. Review the literal text beside the photo.':field.withheld?.length?'Couldn’t read reliably. See retained evidence below.':'No single proposal. Check the full text.'),'value');
    if(field.reasons?.length)appendText(card,'p',field.reasons.join(' '),'hint');
    if(key==='tracking'&&field.unassigned?.length){appendText(card,'p','Unassigned number/code evidence, not selected tracking:','hint');for(const item of field.unassigned)appendText(card,'div',item.value,'source');}
    const alternatives=field.alternatives||[];
    if(alternatives.length){appendText(card,'p','Source proposals (unverified):','hint');const ul=document.createElement('ul');card.append(ul);for(const a of alternatives){const li=appendText(ul,'li',a.value??a.text??a.literal??'');const ids=a.rowIds??a.sourceRowIds??a.rows??[];if(ids.length)appendText(li,'div',`Rows: ${ids.join(', ')}`,'source');}}
  }
  $('unqualified-evidence').textContent=JSON.stringify({notice:'Original unqualified proposals are diagnostic evidence, not reliable extracted fields. Structural checks do not establish optical correctness.',originalFields:pass.originalFields,paddleSourcePolicy:pass.paddleProposals??null,qualification:pass.fields},null,2);
  const autoSummary=automaticRuns.find(r=>r.id===pass.automaticRunId);
  const comparisonDetails=autoSummary||(pass.automaticRunId?{id:pass.automaticRunId,status:automaticRun?.id===pass.automaticRunId?'IN_PROGRESS':'UNAVAILABLE',notice:'Comparison details for this selected reading are not final. No ranking winner is established.'}:{notice:'The selected reading is manual. Any comparison below is the latest separate automatic run.',comparison:automaticRuns.at(-1)??null});$('automatic-run-details').textContent=JSON.stringify({...comparisonDetails,displayedPassId:pass.passId,displayedAutomaticRunId:pass.automaticRunId,allRecordedComparisons:automaticRuns},null,2);
  $('automatic-selection').textContent=pass.readingMode==='automatic'?`${autoSummary&&!autoSummary.comparisonComplete?'Comparison incomplete; no ranking winner. This retained attempt is for manual review.':autoSummary?.selectedPassId===pass.passId?'Initially shown because it had the highest whole-reading score.':'A separate automatic orientation attempt.'} Engine confidence ranks readings; it does not measure field accuracy. No fields are combined across readings.`:'';
  $('field-warnings').textContent=pass.fieldError|| (pass.fields.warnings||[]).join(' ');
  $('raw-text').textContent=pass.raw.text||'(The reader returned no text.)';$('source-rows').replaceChildren();for(const row of pass.rows){const n=appendText($('source-rows'),'div',row.text,'row');appendText(n,'code',`${row.id} · ${row.source}${row.nativeScore!==undefined?` · Paddle model score ${row.nativeScore.toFixed(3)} (not field accuracy)`:row.confidence===null?'':` · engine recognition score ${row.confidence.toFixed(1)} (not field accuracy)`}`);}
}
function photoSelectionCanceled(){setPhotoStatus(photo?'Selection canceled. Your current photo is unchanged.':preparing?'Selection canceled. The photo already opening is unchanged.':'No photo selected. Take a photo or choose one from your gallery.');}
function acceptPhotoInput(input){const file=input.files?.[0];if(!file){photoSelectionCanceled();return;}input.value='';return choose(file);}
for(const id of ['camera','gallery']){const input=$(id);input.addEventListener('change',()=>acceptPhotoInput(input));input.addEventListener('cancel',photoSelectionCanceled);}
if($('paddle-read'))$('paddle-read').onclick=()=>readPaddle();$('auto-read').onclick=()=>readAutomatic();$('read').onclick=()=>read(0);$('rotate').onclick=()=>read(90);
$('cancel').onclick=()=>{if(automaticRun){automaticRun.canceled=true;automaticRun.cancelReason='Canceled by you.';setStatus('Automatic reading canceled. Waiting for current preparation or reader cleanup to settle.');}if(preparing&&(!automaticRun||automaticRun.generation!==generation)){generation++;preparing=false;setStatus('Photo preparation canceled. Choose the photo again.');setPhotoStatus('Photo preparation canceled. Choose the photo again.');if(photo?.url)URL.revokeObjectURL(photo.url);photo=null;$('photo-area').hidden=true;$('original').removeAttribute('src');}releasePendingPreviews();engine.cancel();paddleEngine.cancel();syncControls();};
function downloadResults(){if(!passes.length&&!automaticRuns.length)return;const blob=new Blob([JSON.stringify({buildId:BUILD_ID,notice:'Local unverified OCR test. No customer selection or email action.',observations:passes,automaticRuns,timingReports:[...timingReports.values()]},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='parcel-snap-reader-test.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export').onclick=downloadResults;if($('export-near-status'))$('export-near-status').onclick=downloadResults;syncExportControls();
addEventListener('pagehide',()=>{if(automaticRun)automaticRun.canceled=true;generation++;preparing=false;engine.cancel('Page closed.');paddleEngine.cancel('Page closed.');if(photo?.url)URL.revokeObjectURL(photo.url);photo=null;clearResults();$('original').removeAttribute('src');$('photo-area').hidden=true;setStatus('Choose a photo to begin.');setPhotoStatus('Ready to choose a photo.');syncControls();});

// A native selection may happen before this module and its dependencies finish
// loading. Recover its File reference once handlers exist; do not guess between
// two pre-start selections whose event order is no longer available.
setPhotoStatus('Ready to choose a photo.');
const startupSelections=['camera','gallery'].map(id=>$(id)).filter(input=>input.files?.length);
if(startupSelections.length===1)acceptPhotoInput(startupSelections[0]);
else if(startupSelections.length>1){for(const input of startupSelections)input.value='';setPhotoStatus('More than one photo was selected while loading. Choose the photo you want again.');}
