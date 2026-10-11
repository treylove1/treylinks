import {PADDLE_SETTINGS,PADDLE_PARAMS,PaddleCanceled} from './paddle-source.js?v=ps-20261011-reader-07';
export {PADDLE_SETTINGS,PADDLE_PARAMS,PaddleCanceled,paddleCapabilities,paddlePreparation,drawPaddleFrame,paddleRows} from './paddle-source.js?v=ps-20261011-reader-07';
// Keep a single import promise. Cancellation cannot abort a browser module import;
// it holds the lock until that import settles, then never creates a late worker.
export class PaddleReaderEngine{
 constructor(loadRuntime,{onState=()=>{},timeoutMs=PADDLE_SETTINGS.timeoutMs}={}){this.loadRuntime=loadRuntime;this.onState=onState;this.timeoutMs=timeoutMs;this.active=null;this.sequence=0;this.blockedReason=null;this.runtimePromise=null;}
 get busy(){return !!this.active||!!this.blockedReason;}
 emit(op,phase,message){if(this.active===op)this.onState({phase,message,readId:op.id});}
 terminate(op){if(op.worker&&!op.terminated){op.terminated=true;if(op.api)op.api.terminate();else op.worker.terminate();}}
 cancel(reason='Paddle reading canceled.'){const op=this.active;if(!op)return;op.canceled=true;op.reason=reason;try{this.terminate(op);}catch(error){this.blockedReason='Paddle worker could not be stopped. Reload before another read.';}this.emit(op,op.worker?'canceling':'canceling-initialization',op.worker?reason:`${reason} The runtime download must settle before another read; reload to stop immediately.`);op.abort();}
 async read(image,{photoId,passId,onProgress=()=>{}}={}){
  if(this.busy)throw new Error(this.blockedReason||'A Paddle read is already active.');
  const op={id:`paddle-${++this.sequence}`,worker:null,terminated:false,canceled:false,abort:null};
  const aborted=new Promise(resolve=>{op.abort=()=>resolve({aborted:true});});this.active=op;
  const deadline=setTimeout(()=>this.cancel('Paddle reached its 180-second limit. Earlier readings are unchanged.'),this.timeoutMs);
  let api=null;
  const race=async promise=>{const outcome=await Promise.race([Promise.resolve(promise).then(value=>({value}),error=>({error})),aborted]);if(op.canceled||outcome.aborted)throw new PaddleCanceled(op.reason);if(outcome.error)throw outcome.error;return outcome.value;};
  try{
   this.emit(op,'initializing','Loading the free Paddle reader and verified models…');
   if(!this.runtimePromise)this.runtimePromise=Promise.resolve().then(()=>this.loadRuntime());
   const runtime=await this.runtimePromise;
   if(op.canceled)throw new PaddleCanceled(op.reason);
   api=runtime.createRuntime({onWorker:worker=>{if(op.canceled){worker.terminate();throw new PaddleCanceled(op.reason);}if(op.worker){worker.terminate();throw new Error('A second Paddle worker was refused.');}op.worker=worker;}});op.api=api;
   await race(api.initialize());
   if(!op.worker)throw new Error('Paddle initialization did not provide a controllable dedicated worker.');
   this.emit(op,'reading','Reading once with Paddle…');onProgress({status:'Paddle text detection and recognition'});
   const envelope=await race(api.predict(image,PADDLE_PARAMS));const results=envelope.results;
   if(!Array.isArray(results)||results.length!==1)throw new Error('Paddle returned an unexpected image count.');
   if(new TextEncoder().encode(JSON.stringify(envelope)).byteLength>PADDLE_SETTINGS.maxResultBytes)throw new Error('Paddle result exceeds the local evidence limit; no partial result was used.');
   return {readId:op.id,photoId,passId,result:results[0],rawMethodReturns:envelope.rawMethodReturns,input:envelope.input,runtimeProvenance:envelope.runtime,initialization:api.getInitializationSummary?.()??null};
  }finally{
   clearTimeout(deadline);
   // A dedicated worker owns the model heaps. terminate(), not an unbounded
   // graceful dispose request, is the cancellation/cleanup boundary.
   try{this.terminate(op);}catch(error){this.blockedReason='Paddle worker cleanup failed. Reload before another read.';}
   if(this.active===op){this.active=null;this.onState({phase:this.blockedReason?'reload-required':'idle',readId:op.id,error:this.blockedReason});}
   if(this.blockedReason)throw new Error(this.blockedReason);
  }
 }
}
