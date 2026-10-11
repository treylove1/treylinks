import {AUTO_RECIPE} from './auto-reading.js?v=ps-20261011-reader-07';
export const SETTINGS = Object.freeze({engine:'Tesseract.js',version:'6.0.1',coreVersion:'6.0.0',language:'eng',oem:1,psm:6,maxFileBytes:20*1024*1024,maxInputPixels:40_000_000,maxEdge:2400,maxPixels:4_000_000,timeoutMs:180_000,maxPasses:6,maxStoredBytes:16*1024*1024,maxObservationBytes:6*1024*1024,maxProposalRows:500,maxProposalRowChars:4096});
export const WORKER_OPTIONS = Object.freeze({workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',langPath:'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int',cacheMethod:'none',gzip:true,workerBlobURL:true});
export class ObsoleteRead extends Error { constructor(message='This read was canceled.'){super(message);this.name='ObsoleteRead';} }
// A pending createWorker cannot be terminated until its handle resolves. It keeps
// the single-flight lock, including after cancellation, so another init cannot overlap.
export class ReaderEngine {
  constructor(factory,{onState=()=>{},timeoutMs=SETTINGS.timeoutMs}={}) {this.factory=factory;this.onState=onState;this.timeoutMs=timeoutMs;this.active=null;this.sequence=0;this.blockedReason=null;}
  get busy(){return this.active!==null||this.blockedReason!==null;}
  emit(op,phase,detail={}) { if(this.active===op)this.onState({phase,readId:op.id,...detail}); }
  async stopWorker(op){if(!op.worker)return; if(!op.termination)op.termination=Promise.resolve().then(()=>op.worker.terminate()); await op.termination;}
  cancel(reason='Canceled by you.') {const op=this.active;if(!op)return;op.canceled=true;op.reason=reason;this.emit(op,op.worker?'canceling':'canceling-initialization',{message:op.worker?reason:`${reason} The current reader download must settle before another read. Reload this page to stop it immediately.`});op.abort(); if(op.worker)this.stopWorker(op).catch(e=>{op.cleanupError=String(e);});}
  async read(image,{photoId,passId,onProgress=()=>{},mode='original'}={}) {
    if(!['original','automatic'].includes(mode))throw new Error('Unsupported reader mode.');
    const recipe=mode==='automatic'?{psm:AUTO_RECIPE.psm,rotateAuto:true,timeoutMs:Math.min(this.timeoutMs,AUTO_RECIPE.perReadTimeoutMs)}:{psm:SETTINGS.psm,rotateAuto:false,timeoutMs:this.timeoutMs};
    if(this.busy)throw new Error(this.blockedReason||'A read is already active. Wait for cancellation to finish.');
    const op={id:`read-${++this.sequence}`,photoId,passId,worker:null,canceled:false,abort:null};
    const aborted=new Promise(resolve=>{op.abort=()=>resolve({aborted:true});});
    this.active=op;this.emit(op,'initializing');
    const timer=setTimeout(()=>this.cancel(`The ${recipe.timeoutMs/1000}-second read limit was reached.`),recipe.timeoutMs);
    let failure=null;
    try {
      op.worker=await this.factory({...WORKER_OPTIONS,logger:m=>{if(!op.canceled&&this.active===op)onProgress(m);}});
      if(op.canceled)throw new ObsoleteRead(op.reason);
      const params=await Promise.race([Promise.resolve().then(()=>op.worker.setParameters({tessedit_pageseg_mode:String(recipe.psm),preserve_interword_spaces:'1',user_defined_dpi:'300'})).then(value=>({value}),error=>({error})),aborted]);
      if(params.error)throw params.error;
      if(op.canceled)throw new ObsoleteRead(op.reason);
      this.emit(op,'reading');
      const recognition=Promise.resolve().then(()=>op.worker.recognize(image,recipe.rotateAuto?{rotateAuto:true}:{}, {text:true,blocks:true}));
      // Attach both handlers even if cancellation wins: no detached rejection.
      const outcome=await Promise.race([recognition.then(value=>({value}),error=>({error})),aborted]);
      if(op.canceled||outcome.aborted)throw new ObsoleteRead(op.reason);
      if(outcome.error)throw outcome.error;
      return {readId:op.id,photoId,passId,recipe,data:outcome.value.data};
    } catch(e){failure=e;if(!op.worker)this.blockedReason='Reader initialization failed without a usable worker handle. Reload this page before trying again.';throw e;} finally {
      clearTimeout(timer);
      try{await this.stopWorker(op);}catch(e){op.cleanupError=String(e);this.blockedReason='Reader cleanup could not be confirmed. Reload this page before trying again.';}
      if(this.active===op){this.active=null;this.onState({phase:this.blockedReason?'reload-required':'idle',readId:op.id,canceled:op.canceled,error:this.blockedReason||op.cleanupError||(failure?String(failure):null)});}
    }
  }
}
export function outputRows(data,frameId){
  const rows=[];let i=0;
  for(const block of data.blocks||[])for(const para of block.paragraphs||[])for(const line of para.lines||[]){
    const b=line.bbox;
    rows.push({id:`${frameId}:row-${i++}`,text:String(line.text??''),confidence:Number.isFinite(line.confidence)?line.confidence:null,bbox:b&&['x0','y0','x1','y1'].every(k=>Number.isFinite(b[k]))?{x0:b.x0,y0:b.y0,x1:b.x1,y1:b.y1}:null,frameId,source:'native-line'});
  }
  if(rows.length===0){let offset=0;for(const text of String(data.text??'').split('\n')){rows.push({id:`${frameId}:row-${i++}`,text,confidence:null,bbox:null,frameId,source:'raw-text-line-split',rawTextStart:offset,rawTextEnd:offset+text.length});offset+=text.length+1;}}
  return rows;
}
export function resizePlan(width,height,rotation=0){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>SETTINGS.maxInputPixels)throw new Error('Photo dimensions are unsupported (maximum 40 megapixels).');
  if(![0,90,180,270].includes(rotation))throw new Error('Unsupported rotation.');
  const scale=Math.min(1,SETTINGS.maxEdge/Math.max(width,height),Math.sqrt(SETTINGS.maxPixels/(width*height)));
  const w=Math.max(1,Math.floor(width*scale)),h=Math.max(1,Math.floor(height*scale));
  return {originalWidth:width,originalHeight:height,scaledWidth:w,scaledHeight:h,width:rotation%180?h:w,height:rotation%180?w:h,rotation,scaleX:w/width,scaleY:h/height,operation:rotation?`full-frame clockwise ${rotation} degrees with downscale`:'full-frame downscale only',crop:null};
}

export function immutableObservation(value){
  const copy=structuredClone(value);
  const seen=new WeakSet();
  function freeze(x){if(x&&typeof x==='object'&&!seen.has(x)){seen.add(x);for(const v of Object.values(x))freeze(v);Object.freeze(x);}return x;}
  return freeze(copy);
}
