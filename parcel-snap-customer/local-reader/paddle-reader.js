import {PADDLE_SETTINGS,PADDLE_PARAMS,PaddleCanceled} from './paddle-source.js?v=ps-20261011-reader-08';
export {PADDLE_SETTINGS,PADDLE_PARAMS,PaddleCanceled,paddleCapabilities,paddlePreparation,drawPaddleFrame,paddleRows} from './paddle-source.js?v=ps-20261011-reader-08';
// Timing is diagnostic only. Missing/invalid clock values never become invented zeroes.
const duration=(start,end)=>typeof start==='number'&&typeof end==='number'&&Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>=start&&Number.isFinite(end-start)?end-start:null;

// Each worker still performs exactly one full-frame prediction. Speed comes from
// preparing the next verified worker/model before the next package is photographed,
// not from weakening the one-shot worker boundary.
export class PaddleReaderEngine{
 constructor(loadRuntime,{onState=()=>{},timeoutMs=PADDLE_SETTINGS.timeoutMs,now=()=>performance.now()}={}){
  this.now=now;this.loadRuntime=loadRuntime;this.onState=onState;this.timeoutMs=timeoutMs;
  this.active=null;this.sequence=0;this.blockedReason=null;this.runtimePromise=null;
  this.preparedApi=null;this.preparedWorker=null;this.warmPromise=null;this.warmGeneration=0;this.disposed=false;
 }
 get busy(){return !!this.active||!!this.blockedReason;}
 emit(op,phase,message){if(this.active===op)this.onState({phase,message,readId:op.id});}
 async warm(){
  if(this.disposed)throw new Error('Local OCR reader is closed. Reload to start it again.');
  if(this.blockedReason)throw new Error(this.blockedReason);
  if(this.preparedApi)return this.preparedApi.getInitializationSummary?.()??null;
  if(this.warmPromise)return this.warmPromise;
  const generation=++this.warmGeneration;
  this.onState({phase:'warming',message:'Preparing OCR for the next package…'});
  this.warmPromise=(async()=>{
   if(!this.runtimePromise)this.runtimePromise=Promise.resolve().then(()=>this.loadRuntime());
   const runtime=await this.runtimePromise;
   if(this.disposed||generation!==this.warmGeneration)return null;
   let worker=null;
   const api=runtime.createRuntime({onWorker:w=>{
    worker=w;
    if(this.disposed||generation!==this.warmGeneration){w.terminate();throw new PaddleCanceled('OCR warmup was superseded.');}
   }});
   try{
    const summary=await api.initialize();
    if(this.disposed||generation!==this.warmGeneration){api.terminate();return null;}
    if(!worker){api.terminate();throw new Error('Paddle initialization did not provide a controllable dedicated worker.');}
    this.preparedApi=api;this.preparedWorker=worker;
    this.onState({phase:'ready',message:'OCR ready for the next package.'});
    return summary;
   }catch(error){
    try{api.terminate();}catch{}
    if(!this.disposed&&generation===this.warmGeneration)this.onState({phase:'warm-failed',message:'OCR will initialize when the next package is read.'});
    throw error;
   }
  })().finally(()=>{if(generation===this.warmGeneration)this.warmPromise=null;});
  return this.warmPromise;
 }
 cancel(reason='Paddle reading canceled.'){
  const op=this.active;if(!op)return;
  op.canceled=true;op.reason=reason;
  try{op.api?.terminate();}catch(error){this.blockedReason='Paddle worker could not be stopped. Reload before another read.';}
  this.emit(op,op.worker?'canceling':'canceling-initialization',reason);
  op.abort?.();
 }
 async dispose(){
  if(this.disposed)return;
  this.disposed=true;this.warmGeneration++;
  const op=this.active;
  if(op){op.canceled=true;op.reason='Reader closed.';try{op.api?.terminate();}catch{}op.abort?.();}
  try{this.preparedApi?.terminate();}catch{}
  this.preparedApi=null;this.preparedWorker=null;this.warmPromise=null;
 }
 scheduleNextWarm(){
  if(this.disposed||this.blockedReason)return;
  setTimeout(()=>{if(!this.disposed&&!this.active&&!this.preparedApi)this.warm().catch(()=>{});},0);
 }
 async read(image,{photoId,passId,onProgress=()=>{}}={}){
  if(this.busy)throw new Error(this.blockedReason||'A Paddle read is already active.');
  const op={id:`paddle-${++this.sequence}`,worker:null,api:null,canceled:false,reason:null,abort:null};
  const aborted=new Promise(resolve=>{op.abort=()=>resolve({aborted:true});});this.active=op;
  const deadline=setTimeout(()=>this.cancel('Paddle reached its 180-second limit. Earlier readings are unchanged.'),this.timeoutMs);
  const started=this.now(),timings={runtimeModuleMs:null,workerInitializeMs:null,warmWaitMs:null,predictRoundTripMs:null,envelopeCheckMs:null,hardCleanupMs:null,engineTotalMs:null};
  const race=async promise=>{const outcome=await Promise.race([Promise.resolve(promise).then(value=>({value}),error=>({error})),aborted]);if(op.canceled||outcome.aborted)throw new PaddleCanceled(op.reason||'Paddle reading canceled.');if(outcome.error)throw outcome.error;return outcome.value;};
  try{
   const warmStarted=this.now();
   if(!this.preparedApi){this.emit(op,'initializing','Finishing OCR preparation…');await race(this.warm());}
   timings.warmWaitMs=duration(warmStarted,this.now());
   if(op.canceled)throw new PaddleCanceled(op.reason||'Paddle reading canceled.');
   const api=this.preparedApi,worker=this.preparedWorker;
   if(!api||!worker)throw new Error('Paddle reader was not prepared.');
   this.preparedApi=null;this.preparedWorker=null;op.api=api;op.worker=worker;
   this.emit(op,'reading','Reading once with Paddle…');onProgress({status:'Paddle text detection and recognition'});
   let stage=this.now();
   const envelope=await race(api.predict(image,PADDLE_PARAMS));timings.predictRoundTripMs=duration(stage,this.now());stage=this.now();
   const results=envelope.results;
   if(!Array.isArray(results)||results.length!==1)throw new Error('Paddle returned an unexpected image count.');
   if(new TextEncoder().encode(JSON.stringify(envelope)).byteLength>PADDLE_SETTINGS.maxResultBytes)throw new Error('Paddle result exceeds the local evidence limit; no partial result was used.');
   timings.envelopeCheckMs=duration(stage,this.now());
   return {timings,readId:op.id,photoId,passId,result:results[0],rawMethodReturns:envelope.rawMethodReturns,input:envelope.input,runtimeProvenance:envelope.runtime,initialization:api.getInitializationSummary?.()??null};
  }finally{
   clearTimeout(deadline);
   const cleanupStart=this.now();
   try{op.api?.terminate();}catch(error){this.blockedReason='Paddle worker cleanup failed. Reload before another read.';}
   if(this.active===op){this.active=null;this.onState({phase:this.blockedReason?'reload-required':'idle',readId:op.id,error:this.blockedReason});}
   timings.hardCleanupMs=duration(cleanupStart,this.now());timings.engineTotalMs=duration(started,this.now());
   if(!this.blockedReason)this.scheduleNextWarm();
   if(this.blockedReason)throw new Error(this.blockedReason);
  }
 }
}
