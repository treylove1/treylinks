/*
PARCEL SNAP — OCR ENGINE FOR INDEPENDENT REVIEW
Live source snapshot.

CURRENT ENGINE
- Two Tesseract workers: fast + background recovery.
- Recovery worker is terminated when a new photo begins.
- PSM 6 / OEM 1 fast pass.
- Gentle grayscale + percentile auto-levels.
- Label crop + one deskew before fast OCR.
- Adaptive-binarized recovery with PSM 6 / 11 / 4 / 3.
- ±6° only as last-resort recovery.
- ParcelSnapKnownMatcher is authoritative.
- MATCHED auto-selects; REVIEW / AMBIGUOUS never auto-select.
- Person and business accounts are separate identities.
- Clear business only may match BUSINESS.
- Business + strong known person may match PERSON.
- Sender / return-address regions are down-weighted generically.
- Newer photo selection supersedes older preprocessing/OCR/vision work.

REAL ROADIE EXPECTATIONS
1. "Your Electronic Needs" only -> BUSINESS: Your Electronic Needs
2. "Your Electronic Needs / Trevon..." with strong partial person -> PERSON: Trevon Humes
3. Damaged "Nour electoonic needs" -> BUSINESS if recipient context is strong
4. Unknown identity -> no auto-match

REVIEW FOCUS
- Android latency
- crop quality
- skew estimator
- PSM choices
- Tesseract worker lifecycle
- 250+ identity collision safety
- business/person precedence
- QR/barcode usefulness
*/

================================================================================
OCR WORKERS
================================================================================
let intakeReadToken=0;

const PARCEL_SNAP_OCR_LANG="eng";
const PARCEL_SNAP_OCR_OEM=1;
const PARCEL_SNAP_FAST_PSM="6";

const parcelSnapOcrSlots={
  fast:{promise:null,busy:false,psm:null,gen:0},
  recovery:{promise:null,busy:false,psm:null,gen:0}
};

function getSlotWorker(slot){
  if(!slot.promise){
    const gen=++slot.gen;
    slot.psm=null;
    slot.promise=(async()=>{
      const worker=await Tesseract.createWorker(PARCEL_SNAP_OCR_LANG,PARCEL_SNAP_OCR_OEM);
      await worker.setParameters({
        tessedit_pageseg_mode:PARCEL_SNAP_FAST_PSM,
        preserve_interword_spaces:"1",
        user_defined_dpi:"300"
      });
      if(slot.gen===gen)slot.psm=PARCEL_SNAP_FAST_PSM;
      return worker;
    })().catch(err=>{
      if(slot.gen===gen)slot.promise=null;
      throw err;
    });
  }
  return slot.promise;
}

async function ocrWithSlot(slot,image,psm=PARCEL_SNAP_FAST_PSM){
  const workerPromise=getSlotWorker(slot);
  const gen=slot.gen;
  slot.busy=true;
  try{
    const worker=await workerPromise;
    if(slot.gen!==gen)throw new Error("OCR worker was stopped");
    if(slot.psm!==psm){
      await worker.setParameters({tessedit_pageseg_mode:psm});
      slot.psm=psm;
    }
    const result=await worker.recognize(image);
    return result?.data?.text||"";
  }finally{
    if(slot.gen===gen)slot.busy=false;
  }
}

function stopRecoveryOcr(){
  const slot=parcelSnapOcrSlots.recovery;
  if(!slot.promise||!slot.busy)return;
  const old=slot.promise;
  slot.promise=null;
  slot.busy=false;
  slot.psm=null;
  slot.gen++;
  old.then(w=>w.terminate()).catch(()=>{});
}

async function getParcelSnapOcrWorker(){
  return await getSlotWorker(parcelSnapOcrSlots.fast);
}

function warmParcelSnapOcr(){
  if(typeof Tesseract==="undefined")return;
  getSlotWorker(parcelSnapOcrSlots.fast).catch(err=>console.warn("OCR warmup failed",err));
}

async function fastOcrRecognize(image){
  return await ocrWithSlot(parcelSnapOcrSlots.fast,image,PARCEL_SNAP_FAST_PSM);
}

================================================================================
IMAGE PREP / LABEL CROP / DESKEW / BARCODE
================================================================================
async function loadImage(dataUrl){
  return await new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=reject;
    img.src=dataUrl;
  });
}

async function readFileDataUrl(file){
  return await new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(String(r.result));
    r.onerror=()=>reject(r.error);
    r.readAsDataURL(file);
  });
}

async function resizeDataUrl(original,maxDimension,quality){
  const img=await loadImage(original);
  const scale=Math.min(1,maxDimension/Math.max(img.width,img.height));
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(img.width*scale));
  canvas.height=Math.max(1,Math.round(img.height*scale));
  const ctx=canvas.getContext("2d");
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/jpeg",quality);
}

function drawImageRegionCanvas(img,rect,maxDimension){
  const source=rect||{x:0,y:0,w:img.width,h:img.height};
  const scale=Math.min(1,maxDimension/Math.max(source.w,source.h));
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(source.w*scale));
  canvas.height=Math.max(1,Math.round(source.h*scale));
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(
    img,
    source.x,source.y,source.w,source.h,
    0,0,canvas.width,canvas.height
  );
  return canvas;
}

function drawImageRegion(img,rect,maxDimension,quality){
  return drawImageRegionCanvas(img,rect,maxDimension).toDataURL("image/jpeg",quality);
}

function detectBrightLabelRegion(img){
  const maxSample=180;
  const scale=Math.min(1,maxSample/Math.max(img.width,img.height));
  const w=Math.max(32,Math.round(img.width*scale));
  const h=Math.max(32,Math.round(img.height*scale));
  const canvas=document.createElement("canvas");
  canvas.width=w; canvas.height=h;
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(img,0,0,w,h);

  const data=ctx.getImageData(0,0,w,h).data;
  const lum=new Uint8Array(w*h);
  const histogram=new Uint32Array(256);
  let sum=0;

  for(let p=0,i=0;i<data.length;i+=4,p++){
    const value=Math.max(0,Math.min(255,Math.round(data[i]*.299+data[i+1]*.587+data[i+2]*.114)));
    lum[p]=value;
    histogram[value]++;
    sum+=value;
  }

  const mean=sum/Math.max(1,w*h);
  const target=Math.floor(w*h*.70);
  let running=0,p70=0;
  for(let value=0;value<256;value++){
    running+=histogram[value];
    if(running>=target){p70=value;break}
  }

  const threshold=Math.min(210,Math.max(mean+18,p70));
  let mask=new Uint8Array(w*h);
  for(let i=0;i<lum.length;i++)mask[i]=lum[i]>=threshold?1:0;

  // Bridge dark text holes so the paper label remains one region.
  const dilated=mask.slice();
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const p=y*w+x;
      if(!mask[p])continue;
      for(let dy=-1;dy<=1;dy++){
        for(let dx=-1;dx<=1;dx++){
          const nx=x+dx,ny=y+dy;
          if(nx>=0&&nx<w&&ny>=0&&ny<h)dilated[ny*w+nx]=1;
        }
      }
    }
  }
  mask=dilated;

  const seen=new Uint8Array(w*h);
  const stack=[];
  let best=null;

  for(let sy=0;sy<h;sy++){
    for(let sx=0;sx<w;sx++){
      const seed=sy*w+sx;
      if(!mask[seed]||seen[seed])continue;

      let minX=sx,maxX=sx,minY=sy,maxY=sy,count=0;
      stack.push(seed);
      seen[seed]=1;

      while(stack.length){
        const p=stack.pop();
        const y=Math.floor(p/w),x=p-y*w;
        count++;
        if(x<minX)minX=x;if(x>maxX)maxX=x;
        if(y<minY)minY=y;if(y>maxY)maxY=y;

        const next=[
          x>0?p-1:-1,
          x<w-1?p+1:-1,
          y>0?p-w:-1,
          y<h-1?p+w:-1
        ];
        for(const n of next){
          if(n>=0&&mask[n]&&!seen[n]){seen[n]=1;stack.push(n)}
        }
      }

      const bw=maxX-minX+1,bh=maxY-minY+1;
      const boxArea=bw*bh;
      const fill=count/Math.max(1,boxArea);
      const areaFraction=boxArea/(w*h);
      const aspect=bw/bh;

      if(
        areaFraction>=.035&&areaFraction<=.88&&
        aspect>=.35&&aspect<=3.2&&
        fill>=.30
      ){
        const score=boxArea*fill;
        if(!best||score>best.score)best={minX,maxX,minY,maxY,score};
      }
    }
  }

  if(!best)return null;

  const padX=Math.round((best.maxX-best.minX+1)*.06);
  const padY=Math.round((best.maxY-best.minY+1)*.06);
  const x1=Math.max(0,best.minX-padX);
  const y1=Math.max(0,best.minY-padY);
  const x2=Math.min(w-1,best.maxX+padX);
  const y2=Math.min(h-1,best.maxY+padY);

  const rx=x1/w*img.width;
  const ry=y1/h*img.height;
  const rw=(x2-x1+1)/w*img.width;
  const rh=(y2-y1+1)/h*img.height;

  if(rw<160||rh<100)return null;
  return {x:rx,y:ry,w:rw,h:rh};
}

async function toCanvas(source){
  if(source&&typeof source.getContext==="function")return source;
  const img=typeof source==="string"?await loadImage(source):source;
  const w=img.naturalWidth||img.videoWidth||img.width;
  const h=img.naturalHeight||img.videoHeight||img.height;
  const canvas=document.createElement("canvas");
  canvas.width=w;canvas.height=h;
  canvas.getContext("2d").drawImage(img,0,0,w,h);
  return canvas;
}

function scaleCanvas(source,factor){
  if(factor===1)return source;
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(source.width*factor));
  canvas.height=Math.max(1,Math.round(source.height*factor));
  const ctx=canvas.getContext("2d");
  ctx.imageSmoothingQuality="high";
  ctx.drawImage(source,0,0,canvas.width,canvas.height);
  return canvas;
}

function fitForOcr(source,minLong=1100,maxLong=1500){
  const long=Math.max(source.width,source.height);
  let factor=1;
  if(minLong>0&&long<minLong)factor=minLong/long;
  else if(maxLong>0&&long>maxLong)factor=maxLong/long;
  return factor===1?source:scaleCanvas(source,factor);
}

function canvasGray(source){
  const w=source.width,h=source.height;
  const ctx=source.getContext("2d",{willReadFrequently:true});
  const d=ctx.getImageData(0,0,w,h).data;
  const gray=new Uint8ClampedArray(w*h);
  for(let p=0,i=0;i<d.length;i+=4,p++){
    gray[p]=d[i+3]<128?255:Math.round(d[i]*.299+d[i+1]*.587+d[i+2]*.114);
  }
  return {w,h,gray};
}

function grayToCanvas(w,h,gray){
  const canvas=document.createElement("canvas");
  canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext("2d");
  const out=ctx.createImageData(w,h);
  const od=out.data;
  for(let p=0,i=0;p<gray.length;p++,i+=4){
    od[i]=od[i+1]=od[i+2]=gray[p];
    od[i+3]=255;
  }
  ctx.putImageData(out,0,0);
  return canvas;
}

function prepareFastOcrCanvas(source){
  const {w,h,gray}=canvasGray(source);
  const hist=new Uint32Array(256);
  for(let i=0;i<gray.length;i++)hist[gray[i]]++;

  const percentile=f=>{
    const target=Math.floor(gray.length*f);
    let run=0;
    for(let v=0;v<256;v++){run+=hist[v];if(run>=target)return v}
    return 255;
  };

  const lo=percentile(.01);
  const hi=percentile(.92);
  if(hi-lo<40)return grayToCanvas(w,h,gray);

  const range=hi-lo;
  const out=new Uint8ClampedArray(gray.length);
  for(let i=0;i<gray.length;i++){
    out[i]=Math.max(0,Math.min(255,Math.round((gray[i]-lo)*255/range)));
  }
  return grayToCanvas(w,h,out);
}

function adaptiveBinarizeCanvas(source,t=.15){
  const {w,h,gray}=canvasGray(source);
  const W=w+1;
  const integral=new Float64Array(W*(h+1));
  for(let y=1;y<=h;y++){
    let row=0;
    for(let x=1;x<=w;x++){
      row+=gray[(y-1)*w+x-1];
      integral[y*W+x]=integral[(y-1)*W+x]+row;
    }
  }

  const half=Math.max(8,Math.round(Math.max(w,h)/28));
  const out=new Uint8ClampedArray(w*h);

  for(let y=0;y<h;y++){
    const y1=Math.max(0,y-half),y2=Math.min(h-1,y+half);
    for(let x=0;x<w;x++){
      const x1=Math.max(0,x-half),x2=Math.min(w-1,x+half);
      const count=(x2-x1+1)*(y2-y1+1);
      const sum=integral[(y2+1)*W+x2+1]-integral[y1*W+x2+1]
               -integral[(y2+1)*W+x1]+integral[y1*W+x1];
      out[y*w+x]=gray[y*w+x]*count<=sum*(1-t)?0:255;
    }
  }
  return grayToCanvas(w,h,out);
}

function estimateSkewDegrees(source,maxAngle=12){
  const maxSide=480;
  const scale=Math.min(1,maxSide/Math.max(source.width,source.height));
  const w=Math.max(1,Math.round(source.width*scale));
  const h=Math.max(1,Math.round(source.height*scale));
  const small=scaleCanvas(source,scale);
  const {gray}=canvasGray(small);

  let sum=0;
  for(let i=0;i<gray.length;i++)sum+=gray[i];
  const threshold=Math.min(150,(sum/gray.length)*.72);

  const xs=[],ys=[];
  const cx=w/2,cy=h/2;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      if(gray[y*w+x]<threshold){xs.push(x-cx);ys.push(y-cy)}
    }
  }

  const n=xs.length;
  if(n<150||n>w*h*.5)return 0;

  const step=Math.max(1,Math.floor(n/12000));
  const diag=Math.ceil(Math.hypot(w,h)/2)+2;
  const bins=new Int32Array(diag*2+1);

  const scoreAt=deg=>{
    const r=deg*Math.PI/180,s=Math.sin(r),co=Math.cos(r);
    bins.fill(0);
    for(let i=0;i<n;i+=step){
      bins[Math.round(-xs[i]*s+ys[i]*co)+diag]++;
    }
    let score=0;
    for(let i=0;i<bins.length;i++)score+=bins[i]*bins[i];
    return score;
  };

  const base=scoreAt(0);
  let best=0,bestScore=base;
  for(let a=-maxAngle;a<=maxAngle;a+=1){
    const s=scoreAt(a);
    if(s>bestScore){bestScore=s;best=a}
  }
  const coarse=best;
  for(let a=coarse-.75;a<=coarse+.75;a+=.25){
    const s=scoreAt(a);
    if(s>bestScore){bestScore=s;best=a}
  }

  if(bestScore<base*1.03)return 0;
  return Math.round(best*4)/4;
}

function deskewCanvas(source,skewDegrees){
  if(!skewDegrees||Math.abs(skewDegrees)<1.5)return source;
  return rotateCanvas(source,-skewDegrees);
}

async function preparePackageImages(file){
  const original=await readFileDataUrl(file);
  const img=await loadImage(original);
  const labelRect=detectBrightLabelRegion(img);
  const rawOcrCanvas=fitForOcr(drawImageRegionCanvas(img,labelRect,2400),1100,1500);
  const ocrCanvas=prepareFastOcrCanvas(rawOcrCanvas);

  return {
    preview:drawImageRegion(img,null,1600,.82),
    ocrCanvas,
    rawOcrCanvas,
    vision:drawImageRegion(img,labelRect||null,1600,.90),
    label_crop_used:Boolean(labelRect),
    crop_width:ocrCanvas.width,
    crop_height:ocrCanvas.height
  };
}

async function compressImage(file){
  const original=await readFileDataUrl(file);
  return await resizeDataUrl(original,1600,.82);
}

async function prepareOcrImage(file){
  const original=await readFileDataUrl(file);
  return await resizeDataUrl(original,1900,.92);
}

async function rotateDataUrl(dataUrl,degrees){
  const img=await loadImage(dataUrl);
  const rad=degrees*Math.PI/180;
  const sin=Math.abs(Math.sin(rad)),cos=Math.abs(Math.cos(rad));
  const canvas=document.createElement("canvas");
  canvas.width=Math.ceil(img.width*cos+img.height*sin);
  canvas.height=Math.ceil(img.width*sin+img.height*cos);
  const ctx=canvas.getContext("2d");
  ctx.translate(canvas.width/2,canvas.height/2);
  ctx.rotate(rad);
  ctx.drawImage(img,-img.width/2,-img.height/2);
  return canvas.toDataURL("image/jpeg",.94);
}

async function enhanceForReading(source){
  const img=typeof source==="string" ? await loadImage(source) : source;
  const width=img.width||img.videoWidth||img.naturalWidth;
  const height=img.height||img.videoHeight||img.naturalHeight;
  const scale=Math.min(1.65,Math.max(1,1800/Math.max(width,height)));
  const canvas=document.createElement("canvas");
  canvas.width=Math.round(width*scale);
  canvas.height=Math.round(height*scale);
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const im=ctx.getImageData(0,0,canvas.width,canvas.height),d=im.data;
  for(let i=0;i<d.length;i+=4){
    const g=.299*d[i]+.587*d[i+1]+.114*d[i+2];
    const v=Math.max(0,Math.min(255,(g-128)*1.55+148));
    d[i]=d[i+1]=d[i+2]=v;
  }
  ctx.putImageData(im,0,0);
  return canvas;
}

async function detectBarcode(source){
  if(!("BarcodeDetector" in window))return "";
  try{
    const target=typeof source==="string" ? await loadImage(source) : source;
    const detector=new BarcodeDetector({formats:["qr_code","code_128","code_39","ean_13","ean_8","upc_a","upc_e","itf","codabar"]});
    const codes=await detector.detect(target);
    return (codes||[]).map(x=>String(x.rawValue||"").trim()).find(v=>v.length>=6&&v.length<=80)||"";
  }catch{return ""}
}

================================================================================
MATCH DECISION + FAST READ + BACKGROUND RECOVERY
================================================================================
function decideCustomer(text){
  const customers=workspace?.customers||[];
  if(window.ParcelSnapKnownMatcher&&customers.length){
    const r=window.ParcelSnapKnownMatcher.matchDirectory(customers,text);
    return {
      customer:r.status==="MATCHED"?r.customer:null,
      status:r.status,
      candidate:r.candidate||null,
      score:r.score||0,
      margin:r.margin||0,
      evidence:r.evidence||null
    };
  }

  if(typeof bestCustomerFromText==="function"){
    const m=bestCustomerFromText(text);
    if(m?.customer)return {...m,status:"MATCHED",candidate:m.customer,legacy:true};
  }

  return {customer:null,status:"NO_MATCH",candidate:null,score:0,margin:0,evidence:null};
}

function rotateCanvas(source,degrees){
  const rad=degrees*Math.PI/180;
  const sin=Math.abs(Math.sin(rad)),cos=Math.abs(Math.cos(rad));
  const canvas=document.createElement("canvas");
  canvas.width=Math.ceil(source.width*cos+source.height*sin);
  canvas.height=Math.ceil(source.width*sin+source.height*cos);
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="#fff";
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.translate(canvas.width/2,canvas.height/2);
  ctx.rotate(rad);
  ctx.drawImage(source,-source.width/2,-source.height/2);
  return canvas;
}

function deepRecoveryCanvas(source){
  const scale=Math.min(2.2,Math.max(1.35,2000/Math.max(source.width,source.height)));
  const canvas=document.createElement("canvas");
  canvas.width=Math.round(source.width*scale);
  canvas.height=Math.round(source.height*scale);
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(source,0,0,canvas.width,canvas.height);

  const im=ctx.getImageData(0,0,canvas.width,canvas.height);
  const d=im.data;
  for(let i=0;i<d.length;i+=4){
    const g=.299*d[i]+.587*d[i+1]+.114*d[i+2];
    const v=Math.max(0,Math.min(255,(g-128)*1.65+145));
    d[i]=d[i+1]=d[i+2]=v;
  }
  ctx.putImageData(im,0,0);
  return canvas;
}

function canBackgroundReplaceCustomer(){
  return !$("receiveCustomer").value
    && !$("receiveNewCustomerName").value.trim()
    && !$("receiveNewCustomerEmail").value.trim();
}

function applyRecoveredCustomer(recovered,combined){
  if(!recovered||!recovered.customer||!canBackgroundReplaceCustomer())return false;

  intakeOcrText=combined;
  intakeOcrName=recovered.customer.name;
  intakeOcrAddress=guessRecipientAddress(combined)||intakeOcrAddress||"";

  $("receiveCustomer").value=recovered.customer.id;
  hideInlineCustomer();

  if(!$("receiveTracking").value){
    const recoveredTracking=guessTracking(combined);
    if(recoveredTracking)$("receiveTracking").value=recoveredTracking;
  }
  if(!$("receiveCarrier").value){
    const recoveredCarrier=guessCarrier(combined);
    if(recoveredCarrier)$("receiveCarrier").value=recoveredCarrier;
  }

  $("processingText").textContent=recovered.customer.name;
  $("processingDetail").textContent=$("receiveTracking").value
    ?"Customer matched in background · tracking captured"
    :"Customer matched in background";
  $("processingBox").classList.add("bg-matched");
  return true;
}

async function runDeepRecovery(source,token,initialText,options={}){
  const slot=parcelSnapOcrSlots.recovery;
  const raw=options.raw||source;
  const skew=typeof options.skew==="number"?options.skew:estimateSkewDegrees(source);
  const straight=deskewCanvas(source,skew);
  const rawStraight=deskewCanvas(raw,skew);

  const passes=[
    {psm:"6",build:()=>adaptiveBinarizeCanvas(rawStraight)},
    {psm:"11",build:()=>straight},
    {psm:"4",build:()=>adaptiveBinarizeCanvas(fitForOcr(scaleCanvas(rawStraight,1.5),0,2200))},
    {psm:"3",build:()=>raw},
    {psm:"6",build:()=>rotateCanvas(straight,-6)},
    {psm:"6",build:()=>rotateCanvas(straight,6)}
  ];

  let combined=initialText||"";

  for(const pass of passes){
    if(token!==intakeReadToken||!canBackgroundReplaceCustomer())return null;

    await new Promise(resolve=>setTimeout(resolve,0));

    let text="";
    try{
      text=await ocrWithSlot(slot,pass.build(),pass.psm);
    }catch(err){
      if(token!==intakeReadToken)return null;
      throw err;
    }

    if(token!==intakeReadToken)return null;
    if(!text)continue;

    combined+="\n"+text;

    let recovered=decideCustomer(text);
    if(!recovered.customer)recovered=decideCustomer(combined);

    if(recovered.customer){
      applyRecoveredCustomer(recovered,combined);
      return recovered;
    }
  }

  if(token===intakeReadToken)intakeOcrText=combined;
  return null;
}

async function readPackagePhoto(source,options={}){
  const processing=$("processingBox");
  $("processingText").textContent="Reading package…";
  $("processingDetail").textContent="";
  processing.classList.remove("hidden","bg-matched");

  const token=++intakeReadToken;
  stopRecoveryOcr();
  const started=performance.now();

  const ocrSource=await toCanvas(source);
  const rawSource=options.raw?await toCanvas(options.raw):ocrSource;

  const barcodePromise=detectBarcode(rawSource);

  const skew=estimateSkewDegrees(ocrSource);
  const fastImage=deskewCanvas(ocrSource,skew);

  const merged=await fastOcrRecognize(fastImage);

  if(token!==intakeReadToken){
    return {
      superseded:true,
      read_token:token,
      match:null,
      tracking:"",
      candidate:"",
      recovery_pending:false
    };
  }

  let tracking=await barcodePromise;
  if(token!==intakeReadToken){
    return {
      superseded:true,
      read_token:token,
      match:null,
      tracking:"",
      candidate:"",
      recovery_pending:false
    };
  }

  const decision=decideCustomer(merged);
  if(!tracking)tracking=guessTracking(merged);

  intakeOcrText=merged;
  intakeOcrName=decision.customer?.name||"";
  intakeOcrAddress=guessRecipientAddress(merged)||"";

  $("receiveTracking").value=tracking||"";

  const carrier=guessCarrier(merged);
  if(carrier&&!$("receiveCarrier").value)$("receiveCarrier").value=carrier;

  const elapsed=Math.max(0,(performance.now()-started)/1000).toFixed(1);
  const customers=workspace?.customers||[];

  if(decision.customer){
    $("receiveCustomer").value=decision.customer.id;
    hideInlineCustomer();
    $("processingText").textContent=decision.customer.name;
    $("processingDetail").textContent=tracking
      ?"Customer matched · tracking captured · "+elapsed+"s"
      :"Customer matched · "+elapsed+"s";
  }else{
    $("receiveCustomer").value="";
    showInlineCustomer("");
    $("receiveNewCustomerName").value="";

    const suggestion=decision.candidate&&(decision.status==="REVIEW"||decision.status==="AMBIGUOUS")
      ?"Possible: "+decision.candidate.name+" — please confirm · "
      :"";

    $("processingText").textContent="No known customer matched";
    $("processingDetail").textContent=suggestion+(tracking
      ?"Enter customer name/email · tracking captured · "+elapsed+"s"
      :"Enter customer name and email · "+elapsed+"s");

    if(customers.length){
      runDeepRecovery(ocrSource,token,merged,{raw:rawSource,skew})
        .catch(err=>console.warn("Background OCR recovery failed",err));
    }
  }

  return {
    read_token:token,
    match:decision.customer?decision:null,
    status:decision.status,
    tracking,
    candidate:intakeOcrName,
    suggestion:decision.customer?"":(decision.candidate?.name||""),
    carrier,
    address:intakeOcrAddress,
    elapsed_seconds:Number(elapsed),
    skew_degrees:skew,
    recovery_pending:!decision.customer&&customers.length>0
  };
}

================================================================================
KNOWN PERSON / BUSINESS MATCHER
================================================================================
(function(g){
"use strict";
const N=s=>String(s||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
const C=s=>N(s).replace(/ /g,"");
function lev(a,b){a=String(a||"");b=String(b||"");const d=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));for(let i=0;i<=a.length;i++)d[i][0]=i;for(let j=0;j<=b.length;j++)d[0][j]=j;for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[a.length][b.length];}
function sim(a,b){a=C(a);b=C(b);return !a||!b?0:1-lev(a,b)/Math.max(a.length,b.length);}
function prefixScore(alias,text,minCoverage=.58){alias=C(alias);text=C(text);let best=0;for(let i=0;i<text.length;i++){let k=0;while(k<alias.length&&i+k<text.length&&alias[k]===text[i+k])k++;best=Math.max(best,k);}if(best<7||best/alias.length<minCoverage)return 0;return Math.min(.96,.72+(best/alias.length)*.25);}
function aliases(customer){const primaryType=(customer.customer_type||"PERSON")==="BUSINESS"?"BUSINESS_NAME":"PERSON_NAME";const out=[{alias:customer.name,alias_type:primaryType}];for(const x of (customer.aliases||[])){if(x?.alias&&!out.some(y=>N(y.alias)===N(x.alias)))out.push(x);}return out;}
function typeWeight(customer,type){type=String(type||"LABEL");const ct=customer.customer_type||"PERSON";if(type==="CUSTOMER_CODE"||type==="LABEL")return 1.05;if(type==="PERSON_NAME")return ct==="PERSON"?1.03:.85;if(type==="BUSINESS_NAME")return ct==="BUSINESS"?1.03:.68;return 1;}
function lineContext(lines,index){const senderStart=lines.findIndex(x=>/return\s+address|^\s*(?:ship\s*from|sender|from)\b/i.test(x));let senderEnd=-1;if(senderStart>=0){senderEnd=Math.min(lines.length-1,senderStart+4);for(let i=senderStart+1;i<Math.min(lines.length,senderStart+6);i++){if(/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i.test(lines[i])){senderEnd=i;break;}}}if(senderStart>=0&&index>=senderStart&&index<=senderEnd)return .45;const line=lines[index]||"",prev=lines[index-1]||"",next=lines[index+1]||"";if(/^\s*(?:ship|deliver)\s*to\b/i.test(line))return 1.08;if(/^\s*(?:ship\s*to|deliver\s*to|to)\s*:?\s*$/i.test(prev))return 1.08;if(/^\d{3,6}\s+/.test(next)&&/\b(ave|avenue|st|street|rd|road|blvd|dr|drive|lane|ln|hwy|highway)\b/i.test(next))return 1.08;return 1;}
function tokenSim(a,b){return sim(a,b);}function knownTokenScore(known,seen){const k=C(known),s=C(seen);if(!k||!s)return 0;if(k===s)return 1;if(s.startsWith(k)&&s.length<=k.length+5)return .96;if(k.startsWith(s)&&s.length>=4)return .92;return sim(k,s);}
function phraseCoverage(alias,line){const at=N(alias).split(" ").filter(Boolean),lt=N(line).split(" ").filter(Boolean);if(!at.length||!lt.length)return 0;let total=0;for(const a of at){let best=0;for(const t of lt)best=Math.max(best,tokenSim(a,t));total+=best;}return total/at.length;}
function compoundPersonHit(customer,lines){if((customer.customer_type||"PERSON")!=="PERSON")return null;const nameTokens=N(customer.name).split(" ").filter(Boolean);if(!nameTokens.length)return null;const first=nameTokens[0],last=nameTokens[nameTokens.length-1];const business=(customer.aliases||[]).filter(x=>x.alias_type==="BUSINESS_NAME"&&x.alias);if(!business.length)return null;let best=null;for(let i=0;i<lines.length;i++){const line=lines[i]+" "+(lines[i+1]||"");for(const b of business){const bs=phraseCoverage(b.alias,line);if(bs<.82)continue;const lt=N(line).split(" ").filter(Boolean);let fs=0,ls=0;for(const t of lt){fs=Math.max(fs,knownTokenScore(first,t));ls=Math.max(ls,knownTokenScore(last,t));}if(fs<.80)continue;let score=.90+Math.min(.05,(fs-.80)*.25)+Math.min(.03,Math.max(0,ls-.72)*.12);score=Math.min(.98,score*lineContext(lines,i));const hit={score,evidence:line.trim(),reason:"business-plus-known-person",alias:b.alias+" + "+customer.name,alias_type:"COMPOUND"};if(!best||score>best.score)best=hit;}}return best;}
function scoreAlias(customer,a,lines){const ac=C(a.alias);if(!ac)return null;let best={score:0,evidence:"",reason:""};for(let i=0;i<lines.length;i++){const windows=[lines[i],lines[i]+" "+(lines[i+1]||"")];for(const w of windows){const wc=C(w),wn=N(w),an=N(a.alias);const type=String(a.alias_type||"LABEL"),ct=customer.customer_type||"PERSON";const phrase=(" "+wn+" ").includes(" "+an+" ");let s=0,reason="";if(wn===an){s=1;reason="exact-line";}else if(phrase){s=.985;reason="word-boundary-phrase";}else if(type!=="PERSON_NAME"&&wc.includes(ac)){s=.97;reason="compact-exact";}else{let minCoverage=1.1;if(type==="PERSON_NAME")minCoverage=.58;else if(type==="LABEL")minCoverage=.82;else if(type==="BUSINESS_NAME"&&ct==="BUSINESS")minCoverage=.75;s=minCoverage<=1?prefixScore(a.alias,w,minCoverage):0;reason=s?"known-target-partial":"";if(!s&&type==="PERSON_NAME"&&Math.abs(wc.length-ac.length)<=8){const f=sim(a.alias,w);if(f>=.82){s=Math.min(.88,f);reason="fuzzy-window";}}if(!s&&type==="BUSINESS_NAME"&&ct==="BUSINESS"){const coverage=phraseCoverage(a.alias,w);if(coverage>=.88){s=Math.min(.92,.84+(coverage-.88)*.65);reason="fuzzy-business";}}}if(!s)continue;s=s*typeWeight(customer,a.alias_type)*lineContext(lines,i);if(reason==="known-target-partial")s=Math.min(.89,s);else if(reason==="fuzzy-window")s=Math.min(.88,s);else if(reason==="word-boundary-phrase")s=Math.min(.90,s);else if(reason==="compact-exact")s=Math.min(.92,s);else if(reason==="fuzzy-business")s=Math.min(.92,s);else s=Math.min(1,s);if(s>best.score)best={score:s,evidence:w.trim(),reason};}}return best.score?{...best,alias:a.alias,alias_type:a.alias_type}:null;}
function matchDirectory(customers,rawText){const lines=String(rawText||"").replace(/\r/g,"").split("\n").map(x=>x.trim()).filter(Boolean);const ranked=[];for(const customer of (customers||[])){const hits=aliases(customer).map(a=>scoreAlias(customer,a,lines)).filter(Boolean);const compound=compoundPersonHit(customer,lines);if(compound)hits.push(compound);hits.sort((a,b)=>b.score-a.score);if(!hits.length)continue;const strong=hits.find(h=>h.alias_type!=="BUSINESS_NAME"||(customer.customer_type||"PERSON")==="BUSINESS");const score=strong?Math.max(hits[0].score,strong.score):Math.min(hits[0].score,.69);ranked.push({customer,score,evidence:hits[0],hits:hits.slice(0,4)});}ranked.sort((a,b)=>b.score-a.score);const best=ranked[0],second=ranked[1];if(!best)return {status:"NO_MATCH",customer:null,score:0,ranked:[]};const margin=best.score-(second?.score||0);const personOverBusiness=Boolean(best.customer?.customer_type==="PERSON"&&best.evidence?.reason==="business-plus-known-person"&&second?.customer?.customer_type==="BUSINESS"&&best.score>=.94&&margin>=.04);let status="NO_MATCH";if((best.score>=.90&&margin>=.08)||personOverBusiness)status="MATCHED";else if(best.score>=.72)status=margin<.08?"AMBIGUOUS":"REVIEW";return {status,customer:status==="MATCHED"?best.customer:null,candidate:best.customer,score:best.score,margin,evidence:best.evidence,ranked:ranked.slice(0,5)};}
g.ParcelSnapKnownMatcher={matchDirectory,normalize:N,compact:C};
})(typeof window!=="undefined"?window:globalThis);


================================================================================
VISION CLIENT INTEGRATION
================================================================================
(() => {
  const VISION_API = SUPABASE_URL + "/functions/v1/parcel-snap-vision";
  let visionUnavailableForSession=false;
  let packageSelectionGeneration=0;

  async function analyzePackageWithVision(imageDataUrl) {
    if(visionUnavailableForSession) return null;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;

    const response = await fetch(VISION_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + session.access_token,
        "apikey": SUPABASE_KEY
      },
      body: JSON.stringify({ image_data_url: imageDataUrl })
    });

    const data = await response.json().catch(() => ({}));
    if (response.status === 503 && data.error === "VISION_NOT_CONFIGURED") {
      visionUnavailableForSession=true;
      return null;
    }
    if (!response.ok) throw new Error(data.error || "Vision analysis failed");
    return data.result || null;
  }

  function bestDirectoryMatch(name, confidence) {
    if (!name || !workspace?.customers?.length || Number(confidence || 0) < 0.65) return null;

    const ranked = workspace.customers
      .map(customer => ({
        customer,
        score: candidateScore(customer.name, name)
      }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    const second = ranked[1];
    if (!best) return null;

    const threshold = confidence >= 0.85 ? 0.76 : 0.86;
    return best.score >= threshold && (!second || best.score - second.score >= 0.07)
      ? best.customer
      : null;
  }

  function applyVision(result) {
    if (!result) return false;

    const confidence = Number(result.confidence || 0);
    const match = bestDirectoryMatch(result.recipient_name, confidence);

    if (result.carrier && !$("receiveCarrier").value) $("receiveCarrier").value = result.carrier;
    if (result.tracking_code) $("receiveTracking").value = result.tracking_code;
    if (result.recipient_address) intakeOcrAddress = result.recipient_address;

    if (match && !result.needs_review) {
      $("receiveCustomer").value = match.id;
      hideInlineCustomer();
      intakeOcrName = match.name;
      $("processingText").textContent = match.name;
      $("processingDetail").textContent = result.tracking_code
        ? "Vision matched customer · tracking captured"
        : "Vision matched customer";
      return true;
    }

    $("receiveCustomer").value = "";
    const safeName = confidence >= 0.65 ? String(result.recipient_name || "").trim() : "";
    intakeOcrName = safeName;
    showInlineCustomer(safeName);
    $("processingText").textContent = safeName || "Name not clear";
    $("processingDetail").textContent = result.tracking_code
      ? "Review customer · tracking captured"
      : "Review customer before saving";
    return true;
  }

  const input = $("packagePhoto");
  if (!input) return;

  function visionDirectoryMatch(result){
    if(!result||!workspace?.customers?.length)return null;

    const evidence=[
      result.recipient_business,
      result.recipient_name,
      result.recipient_address
    ].filter(Boolean).join("\n");

    if(window.ParcelSnapKnownMatcher&&evidence){
      const matched=window.ParcelSnapKnownMatcher.matchDirectory(workspace.customers,evidence);
      if(matched.status==="MATCHED"&&matched.customer)return matched.customer;
      return null;
    }

    if(!result.recipient_name)return null;
    return bestDirectoryMatch(result.recipient_name,Number(result.confidence||0));
  }

  function refineFromVision(result,local){
    if(!result)return;

    if(result.carrier&&!$("receiveCarrier").value)$("receiveCarrier").value=result.carrier;
    if(result.tracking_code&&!$("receiveTracking").value)$("receiveTracking").value=result.tracking_code;
    if(result.recipient_address&&!intakeOcrAddress)intakeOcrAddress=result.recipient_address;

    const vMatch=visionDirectoryMatch(result);

    if(local?.match){
      if(vMatch&&vMatch.id===local.match.customer.id&&!result.needs_review){
        $("processingDetail").textContent=$("receiveTracking").value
          ?"Customer matched · tracking captured · AI confirmed"
          :"Customer matched · AI confirmed";
      }else if(vMatch&&vMatch.id!==local.match.customer.id){
        $("receiveCustomer").value="";
        showInlineCustomer("");
        $("processingText").textContent="Customer needs review";
        $("processingDetail").textContent="OCR and vision disagree — choose customer";
      }
      return;
    }

    if(vMatch&&!result.needs_review&&Number(result.confidence||0)>=.78){
      $("receiveCustomer").value=vMatch.id;
      hideInlineCustomer();
      intakeOcrName=vMatch.name;
      $("processingText").textContent=vMatch.name;
      $("processingDetail").textContent=result.tracking_code
        ?"Vision matched customer · tracking captured"
        :"Vision matched customer";
      return;
    }

    if(!$("receiveCustomer").value){
      const safe=Number(result.confidence||0)>=.65
        ?String(result.recipient_name||"").trim()
        :"";
      if(safe&&!$("receiveNewCustomerName").value)$("receiveNewCustomerName").value=safe;
    }
  }

  input.onchange = async event => {
    const file = event.target.files?.[0];
    if (!file) return;

    const selectionGeneration=++packageSelectionGeneration;
    stopRecoveryOcr();

    $("receiveResult").textContent = "";
    $("receiveNewCustomerEmail").value = "";
    $("receiveNewCustomerPhone").value = "";
    intakeOcrText = "";
    intakeOcrName = "";
    intakeOcrAddress = "";

    try {
      $("processingBox").classList.remove("hidden");
      $("processingText").textContent = "Reading package…";
      $("processingDetail").textContent = "";

      // Instant visual feedback before any OCR/image preparation work.
      const instantUrl=URL.createObjectURL(file);
      $("packagePhotoPreview").innerHTML=
        '<img src="' + instantUrl + '" alt="Package photo">';

      // Yield one frame so the employee sees the photo immediately.
      await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
      if(selectionGeneration!==packageSelectionGeneration){URL.revokeObjectURL(instantUrl);return;}

      const prepared=await preparePackageImages(file);
      if(selectionGeneration!==packageSelectionGeneration){URL.revokeObjectURL(instantUrl);return;}
      intakePhotoDataUrl=prepared.preview;

      const visionPromise=analyzePackageWithVision(prepared.vision)
        .catch(error=>{
          console.warn("Vision engine unavailable",error);
          return null;
        });

      // Do not wait for remote vision. Local OCR owns the fast path.
      const local=await readPackagePhoto(prepared.ocrCanvas,{raw:prepared.rawOcrCanvas});
      URL.revokeObjectURL(instantUrl);
      if(selectionGeneration!==packageSelectionGeneration||local?.superseded)return;
      intakeOcrAddress=local.address||"";

      visionPromise.then(result=>{
        if(result&&selectionGeneration===packageSelectionGeneration&&!local?.superseded&&local?.read_token===intakeReadToken){
          refineFromVision(result,local);
        }
      });

      if(prepared.label_crop_used){
        const detail=$("processingDetail").textContent;
        $("processingDetail").textContent=detail
          ?detail+" · label "+prepared.crop_width+"×"+prepared.crop_height
          :"Label crop used";
      }
    } catch (error) {
      console.error(error);
      $("processingBox").classList.remove("hidden");
      $("processingText").textContent = "Name not clear";
      $("processingDetail").textContent = "Enter customer name and email";
      showInlineCustomer("");
    }
  };
})();

