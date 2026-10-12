// Browser integration adapter. The Node-only diagnostic port is never imported.
export const PADDLE_SETTINGS=Object.freeze({engine:'PaddleOCR.js',version:'0.4.2',runtimeVersion:'1.22.0',backend:'wasm',numThreads:1,textDetectionModelName:'PP-OCRv6_small_det',textRecognitionModelName:'PP-OCRv6_small_rec',maxFileBytes:20*1024*1024,maxInputPixels:10_000_000,maxSourcePixels:40_000_000,timeoutMs:180_000,maxResultBytes:2*1024*1024,maxRows:500,maxRowChars:4096,modelArchiveBytes:31_211_520,phoneAccuracy:'NOT_VALIDATED',cpuDiagnosticRuntimeVersion:'1.22.0'});
export const PADDLE_PARAMS=Object.freeze({textDetLimitSideLen:1280,textDetLimitType:'max',textDetMaxSideLimit:1280,textDetThresh:0.2,textDetBoxThresh:0.45,textDetUnclipRatio:1.4,textRecScoreThresh:0});
export class PaddleCanceled extends Error{constructor(message='Paddle reading canceled.'){super(message);this.name='PaddleCanceled';}}
export function paddleCapabilities(scope=globalThis){
 const missing=[];
 for(const name of ['Worker','createImageBitmap'])if(typeof scope[name]!=='function')missing.push(name);
 if(!scope.WebAssembly||!scope.crypto?.subtle)missing.push('WebAssembly or secure hashing');
 return {supported:missing.length===0,missing,deviceMemoryGiB:Number.isFinite(scope.navigator?.deviceMemory)?scope.navigator.deviceMemory:null};
}
export function paddlePreparation(width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>PADDLE_SETTINGS.maxSourcePixels)throw new Error('Photo dimensions are unsupported (maximum 40 megapixels).');
 const resized=width*height>PADDLE_SETTINGS.maxInputPixels;
 const scale=resized?Math.sqrt(PADDLE_SETTINGS.maxInputPixels/(width*height)):1;
 const w=resized?Math.floor(width*scale):width,h=resized?Math.floor(height*scale):height;
 if(w<1||h<1||w*h>PADDLE_SETTINGS.maxInputPixels)throw new Error('This photo’s aspect ratio cannot be reduced safely to the 10 megapixel reader limit. Your photo remains unchanged.');
 return {originalWidth:width,originalHeight:height,scaledWidth:w,scaledHeight:h,width:w,height:h,rotation:0,scaleX:w/width,scaleY:h/height,resized,operation:resized?'Full decoded frame downscaled only to at most 10 megapixels; browser decoder orientation applies':'Full decoded frame unchanged before the SDK detector resize; browser decoder orientation applies',resampling:resized?'Browser-native canvas smoothing; high quality requested, not guaranteed pixel-identical across browsers':'none',crop:null,detectorMaxEdge:1280,largePhotoRecipeValidation:resized?'FICTIONAL_PREPARATION_TESTS_ONLY_NO_ACCURACY_MEASUREMENT':'NOT_APPLICABLE'};
}
export function drawPaddleFrame(ctx,bitmap,plan){
 if(plan.resized){ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(bitmap,0,0,plan.width,plan.height);}
 else ctx.drawImage(bitmap,0,0);
}
export function paddleRows(result,frameId,rawMethodReturns){
 if(!result||!Array.isArray(result.items)||!result.image)throw new Error('Paddle returned an unsupported result shape.');
 const {width,height}=result.image;if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>PADDLE_SETTINGS.maxInputPixels)throw new Error('Paddle returned an invalid or oversized processed frame.');
 const detections=rawMethodReturns?.detection,recognitions=rawMethodReturns?.recognition;
 if(!Array.isArray(detections)||detections.length!==1||!Array.isArray(detections[0])||detections[0].length!==1||!Array.isArray(detections[0][0].boxes)||!Array.isArray(recognitions))throw new Error('Paddle native source-return binding is unavailable.');
 if(detections[0][0].srcW!==width||detections[0][0].srcH!==height)throw new Error('Paddle native detection frame dimensions disagree.');
 const boxes=detections[0][0].boxes;const rec=boxes.length?recognitions[0]:[];
 if((boxes.length&&(recognitions.length!==1||!Array.isArray(rec)))||(!boxes.length&&recognitions.length!==0)||rec.length!==boxes.length)throw new Error('Paddle native detection/recognition counts disagree.');
 const items=rec.map((item,index)=>({poly:boxes[index].poly,text:item.text,score:item.score}));
 const projected=items.filter(item=>item.text&&item.score>=0);
 if(JSON.stringify(projected)!==JSON.stringify(result.items))throw new Error('Paddle final results do not match their native source returns.');
 if(items.length>PADDLE_SETTINGS.maxRows)throw new Error('Paddle returned too many source rows; no partial result was used.');
 return items.map((item,index)=>{
  if(typeof item.text!=='string'||item.text.length>PADDLE_SETTINGS.maxRowChars||!Number.isFinite(item.score)||item.score<0||item.score>1||!Array.isArray(item.poly)||item.poly.length!==4||item.poly.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v))||p[0]<0||p[0]>width||p[1]<0||p[1]>height))throw new Error('Paddle returned invalid source text, confidence or coordinates; no partial result was used.');
  const poly=item.poly.map(p=>[...p]);return {id:`${frameId}:row-${index}`,frameId,nativeSourceIndex:index,text:item.text,confidence:null,nativeScore:item.score,nativeScoreScale:'Paddle model score0–1; not calibrated field confidence',poly,bboxDerivedFrom:'native-polygon-axis-aligned-enclosure',bbox:{x0:Math.min(...poly.map(p=>p[0])),y0:Math.min(...poly.map(p=>p[1])),x1:Math.max(...poly.map(p=>p[0])),y1:Math.max(...poly.map(p=>p[1]))},source:'paddleocr-native-line'};
 });
}
