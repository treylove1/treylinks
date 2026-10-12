import {PaddleReaderEngine,PADDLE_SETTINGS,PADDLE_PARAMS,PaddleCanceled,paddlePreparation,drawPaddleFrame,paddleRows} from './local-reader/paddle-reader.js?v=ps-private-reader-timing-01';
import {proposePaddleFields} from './local-reader/paddle-fields.js';

const MAX_PREVIEW=16*1024*1024,MAX_EVIDENCE=6*1024*1024;
// Only local durations are retained; no wall-clock timestamps, logging or telemetry.
const metric=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const duration=(start,end)=>metric(start)!==null&&metric(end)!==null&&end>=start?metric(end-start):null;
const hex=buffer=>Array.from(new Uint8Array(buffer),v=>v.toString(16).padStart(2,'0')).join('');
export async function digest(bytes){return hex(await crypto.subtle.digest('SHA-256',bytes));}
export function validateFile(file){
  if(!file||!Number.isFinite(file.size)||file.size<1||file.size>PADDLE_SETTINGS.maxFileBytes)throw new Error('Choose a photo no larger than 20 MiB.');
  const mime=String(file.type||'').toLowerCase(),name=String(file.name||'');
  if(!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(mime)&&
     !(mime===''&&/\.(jpe?g|png|webp|heic|heif)$/i.test(name)))throw new Error('Choose a JPEG, PNG, WebP, HEIC or HEIF photo.');
}
function previewBlob(canvas){return new Promise((resolve,reject)=>{
  canvas.toBlob(blob=>{if(!blob)return reject(new Error('Could not encode the reader frame.'));
    if(blob.size>MAX_PREVIEW)return reject(new Error('Reader frame exceeds the 16 MiB local preview limit.'));resolve(blob);},'image/png');
});}
export class FreeIntakeReader {
  constructor({onState=()=>{},loadRuntime=()=>import('./local-reader/paddle-runtime/paddle-runtime.mjs'),
    loadProjector=()=>import('./paddle-label-blocks.js?v=ps-readonly-review-20261012-03'),decode=file=>globalThis.createImageBitmap(file),
    makeCanvas=()=>document.createElement('canvas'),capturePreview=previewBlob,hash=digest,now=()=>performance.now()}={}){
    this.now=now;this.onState=onState;this.decode=decode;this.makeCanvas=makeCanvas;this.capturePreview=capturePreview;this.hash=hash;
    this.loadProjector=loadProjector;this.generation=0;this.photo=null;this.active=null;this.passCount=0;this.storedBytes=0;
    this.engine=new PaddleReaderEngine(loadRuntime,{onState,now});
  }
  get busy(){return Boolean(this.active)||this.engine.busy;}
  cancel(reason='Reading canceled.'){this.generation++;if(this.active)this.active.canceled=true;this.engine.cancel(reason);}
  clear(){this.cancel('Photo or workspace changed.');this.photo=null;this.passCount=0;this.storedBytes=0;}
  async open(file,{photoId}={}){
    validateFile(file);this.clear();const generation=this.generation;
    const bitmap=await this.decode(file);let width,height;
    try{width=bitmap.width;height=bitmap.height;paddlePreparation(width,height);}finally{bitmap.close();}
    const sha256=await this.hash(await file.arrayBuffer());
    if(generation!==this.generation)throw new PaddleCanceled('A newer photo replaced this selection.');
    this.photo=Object.freeze({id:photoId||`photo-${generation}`,file,width,height,sha256,generation});
    return this.photo;
  }
  async read(){
    if(!this.photo)throw new Error('Choose a photo first.');
    if(this.busy)throw new Error('The previous reader is still stopping or preparing. Wait before another read.');
    if(this.passCount>=6||this.storedBytes>=16*1024*1024)throw new Error('Local result limit reached. Choose the photo again to start a new review.');
    const photo=this.photo,generation=this.generation,op={canceled:false};this.active=op;
    const passId=`${photo.id}:paddle:${this.passCount+1}`,started=this.now();let canvas,frameBlob;
    const check=()=>{if(op.canceled||generation!==this.generation||this.photo!==photo)throw new PaddleCanceled('Photo changed or reading canceled.');};
    try{
      this.onState({phase:'preparing',message:'Preparing the full photo for the free local reader…'});
      const bitmap=await this.decode(photo.file);let plan;
      try{check();plan=paddlePreparation(bitmap.width,bitmap.height);canvas=this.makeCanvas();canvas.width=plan.width;canvas.height=plan.height;
        const ctx=canvas.getContext('2d',{alpha:true,willReadFrequently:true});if(!ctx)throw new Error('This browser could not prepare the photo.');drawPaddleFrame(ctx,bitmap,plan);
      }finally{bitmap.close();}
      frameBlob=await this.capturePreview(canvas);check();
      let pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      const pixelSha256=await this.hash(pixels);check();
      const buffer=pixels.byteOffset===0&&pixels.byteLength===pixels.buffer.byteLength?pixels.buffer:pixels.buffer.slice(pixels.byteOffset,pixels.byteOffset+pixels.byteLength);pixels=null;
      canvas.width=1;canvas.height=1;canvas=null;
      const preparationMs=duration(started,this.now());
      const output=await this.engine.read({width:plan.width,height:plan.height,buffer,pixelSha256,sourceSha256:photo.sha256},{photoId:photo.id,passId});check();
      const parserStarted=this.now(),native=output.result;
      if(native.image.width!==plan.width||native.image.height!==plan.height||output.input?.pixelSha256!==pixelSha256||
        output.input?.sourceSha256!==photo.sha256||output.input?.width!==plan.width||output.input?.height!==plan.height)
        throw new Error('Paddle source-frame verification failed. No result was used.');
      const rows=paddleRows(native,passId,output.rawMethodReturns);
      const raw={text:native.items.map(item=>item.text).join('\n'),textProjection:'Native lines joined with newline; no character edits',sdkResult:native,rawMethodReturns:output.rawMethodReturns};
      const rawResultSha256=await this.hash(new TextEncoder().encode(JSON.stringify(raw)));check();
      const binding={id:passId,photoId:photo.id,photoSha256:photo.sha256,rawResultSha256};
      const {projectPaddleLabelBlocks}=await this.loadProjector();check();
      const proposals=projectPaddleLabelBlocks({observationId:passId,photoId:photo.id,photoSha256:photo.sha256,rawResultSha256,rows});
      const fields=proposePaddleFields(rows,{barcodes:[]});
      const observation={...binding,reviewOnly:true,roleVerified:false,raw,rows,proposals,fields:fields.fields,trackingProposal:fields.proposals.tracking,
        rawResultHashScope:'SHA-256 of UTF-8 JSON.stringify(observation.raw)',
        preparation:{...plan,pixelSha256},engine:{...PADDLE_SETTINGS,predictParams:PADDLE_PARAMS,runtime:output.runtimeProvenance}};
      // Totals and SDK metrics are nested observations, never additive buckets.
      // Finish at evidence construction, before the existing size/check/freeze boundary.
      const prepared=this.now(),readerTotalMs=duration(started,prepared),engineTiming=output.timings;
      observation.elapsedSeconds=readerTotalMs===null?null:readerTotalMs/1000;
      observation.timing={schema:'parcel-snap-local-timing-v1',units:'ms',clock:'local-monotonic',
        nesting:'Nonadditive: engine stages are within engineTotalMs; nativeMetrics are within predictionRoundTripMs; preparation, engine and parser are within readerTotalMs.',
        readerScope:'Read start through evidence construction; excludes final evidence size validation, recursive freeze and UI rendering.',
        cleanupScope:'Final terminate boundary plus idle notification; the runtime may already have terminated before this boundary.',
        preparationMs,runtimeModuleMs:metric(engineTiming?.runtimeModuleMs),workerInitializeMs:metric(engineTiming?.workerInitializeMs),
        predictionRoundTripMs:metric(engineTiming?.predictRoundTripMs),engineTotalMs:metric(engineTiming?.engineTotalMs),
        envelopeCheckMs:metric(engineTiming?.envelopeCheckMs),hardCleanupMs:metric(engineTiming?.hardCleanupMs),
        parserMs:duration(parserStarted,prepared),readerTotalMs,
        nativeMetrics:{nativeDetectionMs:metric(native.metrics?.detMs),nativeRecognitionMs:metric(native.metrics?.recMs),nativeTotalMs:metric(native.metrics?.totalMs)}};
      const size=new TextEncoder().encode(JSON.stringify(observation)).byteLength;
      if(size>MAX_EVIDENCE||this.storedBytes+size>16*1024*1024)throw new Error('Reader output exceeds the local evidence limit. No partial result was used.');
      check();this.passCount++;this.storedBytes+=size;
      const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
      return {observation:freeze(observation),frameBlob};
    }finally{if(canvas){canvas.width=1;canvas.height=1;}if(this.active===op)this.active=null;}
  }
}
