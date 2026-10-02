/*
PARCEL SNAP — OCR ENGINE FOR INDEPENDENT REVIEW
Generated from the LIVE customer portal source.

WHAT IT IS TRYING TO DO
1. Show the package photo immediately.
2. Crop likely shipping-label region.
3. Preprocess for OCR.
4. Reuse one Tesseract.js worker.
5. Run ONE blocking OCR pass.
6. Match only against known people/businesses in the customer directory.
7. If no confident match, let the worker continue immediately.
8. Run the older robust OCR recovery in the background:
   enhanced image -> -6° -> +6° -> -10° -> +10° -> raw crop.
9. If the person is unclear but a known BUSINESS is clear, match the business.
10. Never invent a customer identity from random OCR text.

CURRENT REAL TEST CASE
Roadie label visibly contains:
  Your Electronic Needs / Trevon...
  16600 NW 54TH AVE UNIT 9
  HIALEAH FL ...

The system should behave as:
- clear business only -> Your Electronic Needs (BUSINESS)
- clear business + strong Trevon evidence -> Trevon Humes (PERSON)
- unknown identity -> leave unmatched and ask for name/email

REVIEW QUESTIONS
- Is the label crop algorithm selecting the correct region?
- Is the first-pass preprocessing harming typewriter-style labels?
- Should OCR run raw crop and processed crop in parallel?
- Are the confidence/margin rules safe for 250+ people/businesses?
- Can this be made materially faster on Android?
- What browser OCR engine/model would outperform Tesseract here?
- Is perspective correction needed before OCR?
- Can QR/barcode decoding provide a stronger package identity?
*/

// ============================================================================
// OCR WORKER / FAST RECOGNITION
// ============================================================================

let parcelSnapOcrWorkerPromise=null;

async function getParcelSnapOcrWorker(){
  if(!parcelSnapOcrWorkerPromise){
    parcelSnapOcrWorkerPromise=(async()=>{
      const worker=await Tesseract.createWorker("eng");
      await worker.setParameters({
        tessedit_pageseg_mode:"3",
        preserve_interword_spaces:"1"
      });
      return worker;
    })().catch(err=>{
      parcelSnapOcrWorkerPromise=null;
      throw err;
    });
  }
  return await parcelSnapOcrWorkerPromise;
}

function warmParcelSnapOcr(){
  if(typeof Tesseract==="undefined")return;
  getParcelSnapOcrWorker().catch(err=>console.warn("OCR warmup failed",err));
}

async function fastOcrRecognize(image){
  const worker=await getParcelSnapOcrWorker();
  const result=await worker.recognize(image);
  return result?.data?.text||"";
}


// ============================================================================
// IMAGE PREP / LABEL CROP / BARCODE
// ============================================================================

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

function prepareFastOcrCanvas(source){
  const w=source.width,h=source.height;
  const srcCtx=source.getContext("2d",{willReadFrequently:true});
  const im=srcCtx.getImageData(0,0,w,h);
  const d=im.data;
  const gray=new Uint8ClampedArray(w*h);

  let sum=0;
  for(let p=0,i=0;i<d.length;i+=4,p++){
    const g=Math.max(0,Math.min(255,Math.round(d[i]*.299+d[i+1]*.587+d[i+2]*.114)));
    gray[p]=g;
    sum+=g;
  }

  const mean=sum/Math.max(1,gray.length);
  const contrast=new Uint8ClampedArray(gray.length);
  for(let i=0;i<gray.length;i++){
    contrast[i]=Math.max(0,Math.min(255,Math.round(mean+2*(gray[i]-mean))));
  }

  const outCanvas=document.createElement("canvas");
  outCanvas.width=w; outCanvas.height=h;
  const outCtx=outCanvas.getContext("2d");
  const out=outCtx.createImageData(w,h);
  const od=out.data;

  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const p=y*w+x;
      let v=contrast[p];

      if(x>0&&x<w-1&&y>0&&y<h-1){
        const smooth=(
          contrast[p-w-1]+contrast[p-w]+contrast[p-w+1]+
          contrast[p-1]+5*contrast[p]+contrast[p+1]+
          contrast[p+w-1]+contrast[p+w]+contrast[p+w+1]
        )/13;
        v=Math.max(0,Math.min(255,Math.round(2*contrast[p]-smooth)));
      }

      const i=p*4;
      od[i]=od[i+1]=od[i+2]=v;
      od[i+3]=255;
    }
  }

  outCtx.putImageData(out,0,0);
  return outCanvas;
}

async function preparePackageImages(file){
  const original=await readFileDataUrl(file);
  const img=await loadImage(original);
  const labelRect=detectBrightLabelRegion(img);
  const rawOcrCanvas=drawImageRegionCanvas(img,labelRect,1350);
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


// ============================================================================
// FAST READ + OLD ROBUST BACKGROUND RECOVERY
// ============================================================================

function rotateCanvas(source,degrees){
  const rad=degrees*Math.PI/180;
  const sin=Math.abs(Math.sin(rad)),cos=Math.abs(Math.cos(rad));
  const canvas=document.createElement("canvas");
  canvas.width=Math.ceil(source.width*cos+source.height*sin);
  canvas.height=Math.ceil(source.width*sin+source.height*cos);
  const ctx=canvas.getContext("2d");
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
  if(!recovered||!canBackgroundReplaceCustomer())return false;

  intakeOcrText=combined;
  intakeOcrName=recovered.customer.name;
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
  return true;
}

async function runDeepRecovery(source,token,initialText){
  let combined=initialText||"";
  const enhanced=deepRecoveryCanvas(source);
  const passes=[
    enhanced,
    rotateCanvas(enhanced,-6),
    rotateCanvas(enhanced,6),
    rotateCanvas(enhanced,-10),
    rotateCanvas(enhanced,10),
    source
  ];

  for(let i=0;i<passes.length;i++){
    if(token!==intakeReadToken||!canBackgroundReplaceCustomer())return null;

    // Yield between attempts so the warehouse UI remains responsive.
    await new Promise(resolve=>setTimeout(resolve,0));

    const text=await fastOcrRecognize(passes[i]);
    if(token!==intakeReadToken)return null;
    if(text)combined+="\n"+text;

    const recovered=bestCustomerFromText(combined);
    if(recovered){
      applyRecoveredCustomer(recovered,combined);
      return recovered;
    }
  }

  intakeOcrText=combined;
  return null;
}

async function readPackagePhoto(source){
  const processing=$("processingBox");
  $("processingText").textContent="Reading package…";
  $("processingDetail").textContent="";
  processing.classList.remove("hidden");

  const token=++intakeReadToken;
  const started=performance.now();
  const barcodePromise=detectBarcode(source);

  // One blocking OCR pass only.
  let merged=await fastOcrRecognize(source);
  let match=bestCustomerFromText(merged);

  let tracking=await barcodePromise;
  if(!tracking)tracking=guessTracking(merged);

  intakeOcrText=merged;

  const knownResult=window.ParcelSnapKnownMatcher
    ?window.ParcelSnapKnownMatcher.matchDirectory(workspace?.customers||[],merged)
    :null;

  const candidate=knownResult?.status==="MATCHED"
    ?knownResult.customer?.name||""
    :"";

  intakeOcrName=match?.customer?.name||candidate||"";
  $("receiveTracking").value=tracking||"";

  const carrier=guessCarrier(merged);
  if(carrier&&!$("receiveCarrier").value)$("receiveCarrier").value=carrier;

  const elapsed=Math.max(0,(performance.now()-started)/1000).toFixed(1);

  if(match){
    $("receiveCustomer").value=match.customer.id;
    hideInlineCustomer();
    $("processingText").textContent=match.customer.name;
    $("processingDetail").textContent=tracking
      ?"Customer matched · tracking captured · "+elapsed+"s"
      :"Customer matched · "+elapsed+"s";
  }else{
    $("receiveCustomer").value="";
    showInlineCustomer("");
    $("receiveNewCustomerName").value="";
    $("processingText").textContent="No known customer matched";
    $("processingDetail").textContent=tracking
      ?"Enter customer name/email · tracking captured · "+elapsed+"s"
      :"Enter customer name and email · "+elapsed+"s";

    // Old robust OCR behavior restored as a NON-BLOCKING recovery path.
    // The employee already has control of the screen while this runs.
    if((workspace?.customers||[]).length){
      runDeepRecovery(source,token,merged)
        .catch(err=>console.warn("Background OCR recovery failed",err));
    }
  }

  return {
    match,
    tracking,
    candidate:intakeOcrName,
    carrier,
    address:guessRecipientAddress(merged),
    elapsed_seconds:Number(elapsed),
    recovery_pending:!match&&(workspace?.customers||[]).length>0
  };
}



// ============================================================================
// KNOWN PERSON / BUSINESS MATCHER
// ============================================================================

(function(g){
"use strict";
const N=s=>String(s||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
const C=s=>N(s).replace(/ /g,"");
function lev(a,b){a=String(a||"");b=String(b||"");const d=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));for(let i=0;i<=a.length;i++)d[i][0]=i;for(let j=0;j<=b.length;j++)d[0][j]=j;for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[a.length][b.length];}
function sim(a,b){a=C(a);b=C(b);return !a||!b?0:1-lev(a,b)/Math.max(a.length,b.length);}
function prefixScore(alias,text,minCoverage=.58){alias=C(alias);text=C(text);let best=0;for(let i=0;i<text.length;i++){let k=0;while(k<alias.length&&i+k<text.length&&alias[k]===text[i+k])k++;best=Math.max(best,k);}if(best<7||best/alias.length<minCoverage)return 0;return Math.min(.96,.72+(best/alias.length)*.25);}
function aliases(customer){const primaryType=(customer.customer_type||"PERSON")==="BUSINESS"?"BUSINESS_NAME":"PERSON_NAME";const out=[{alias:customer.name,alias_type:primaryType}];for(const x of (customer.aliases||[])){if(x?.alias&&!out.some(y=>N(y.alias)===N(x.alias)))out.push(x);}return out;}
function typeWeight(customer,type){type=String(type||"LABEL");const ct=customer.customer_type||"PERSON";if(type==="CUSTOMER_CODE"||type==="LABEL")return 1.05;if(type==="PERSON_NAME")return ct==="PERSON"?1.03:.85;if(type==="BUSINESS_NAME")return ct==="BUSINESS"?1.03:.68;return 1;}
function lineContext(lines,index){const senderStart=lines.findIndex(x=>/return\s+address/i.test(x));let senderEnd=-1;if(senderStart>=0){senderEnd=Math.min(lines.length-1,senderStart+4);for(let i=senderStart+1;i<Math.min(lines.length,senderStart+6);i++){if(/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i.test(lines[i])){senderEnd=i;break;}}}if(senderStart>=0&&index>=senderStart&&index<=senderEnd)return .45;const line=lines[index]||"";if(/electr.*needs|\byen\b/i.test(line)&&/[\/|:-]/.test(line))return 1.08;const next=lines[index+1]||"";if(/^\d{3,6}\s+/.test(next)&&/\b(ave|avenue|st|street|rd|road|blvd|dr|lane|ln)\b/i.test(next))return 1.08;return 1;}
function tokenSim(a,b){return sim(a,b);}function knownTokenScore(known,seen){const k=C(known),s=C(seen);if(!k||!s)return 0;if(k===s)return 1;if(s.startsWith(k)&&s.length<=k.length+5)return .96;if(k.startsWith(s)&&s.length>=4)return .92;return sim(k,s);}
function phraseCoverage(alias,line){const at=N(alias).split(" ").filter(Boolean),lt=N(line).split(" ").filter(Boolean);if(!at.length||!lt.length)return 0;let total=0;for(const a of at){let best=0;for(const t of lt)best=Math.max(best,tokenSim(a,t));total+=best;}return total/at.length;}
function compoundPersonHit(customer,lines){if((customer.customer_type||"PERSON")!=="PERSON")return null;const nameTokens=N(customer.name).split(" ").filter(Boolean);if(!nameTokens.length)return null;const first=nameTokens[0],last=nameTokens[nameTokens.length-1];const business=(customer.aliases||[]).filter(x=>x.alias_type==="BUSINESS_NAME"&&x.alias);if(!business.length)return null;let best=null;for(let i=0;i<lines.length;i++){const line=lines[i]+" "+(lines[i+1]||"");for(const b of business){const bs=phraseCoverage(b.alias,line);if(bs<.82)continue;const lt=N(line).split(" ").filter(Boolean);let fs=0,ls=0;for(const t of lt){fs=Math.max(fs,knownTokenScore(first,t));ls=Math.max(ls,knownTokenScore(last,t));}if(fs<.80)continue;let score=.90+Math.min(.05,(fs-.80)*.25)+Math.min(.03,Math.max(0,ls-.72)*.12);score=Math.min(.98,score*lineContext(lines,i));const hit={score,evidence:line.trim(),reason:"business-plus-known-person",alias:b.alias+" + "+customer.name,alias_type:"COMPOUND"};if(!best||score>best.score)best=hit;}}return best;}
function scoreAlias(customer,a,lines){const ac=C(a.alias);if(!ac)return null;let best={score:0,evidence:"",reason:""};for(let i=0;i<lines.length;i++){const windows=[lines[i],lines[i]+" "+(lines[i+1]||"")];for(const w of windows){const wc=C(w),wn=N(w),an=N(a.alias);const type=String(a.alias_type||"LABEL"),ct=customer.customer_type||"PERSON";const phrase=(" "+wn+" ").includes(" "+an+" ");let s=0,reason="";if(wn===an){s=1;reason="exact-line";}else if(phrase){s=.985;reason="word-boundary-phrase";}else if(type!=="PERSON_NAME"&&wc.includes(ac)){s=.97;reason="compact-exact";}else{let minCoverage=1.1;if(type==="PERSON_NAME")minCoverage=.58;else if(type==="LABEL")minCoverage=.82;else if(type==="BUSINESS_NAME"&&ct==="BUSINESS")minCoverage=.75;s=minCoverage<=1?prefixScore(a.alias,w,minCoverage):0;reason=s?"known-target-partial":"";if(!s&&type==="PERSON_NAME"&&Math.abs(wc.length-ac.length)<=8){const f=sim(a.alias,w);if(f>=.82){s=Math.min(.88,f);reason="fuzzy-window";}}}if(!s)continue;s=s*typeWeight(customer,a.alias_type)*lineContext(lines,i);if(reason==="known-target-partial")s=Math.min(.89,s);else if(reason==="fuzzy-window")s=Math.min(.88,s);else if(reason==="word-boundary-phrase")s=Math.min(.90,s);else if(reason==="compact-exact")s=Math.min(.92,s);else s=Math.min(1,s);if(s>best.score)best={score:s,evidence:w.trim(),reason};}}return best.score?{...best,alias:a.alias,alias_type:a.alias_type}:null;}
function matchDirectory(customers,rawText){const lines=String(rawText||"").replace(/\r/g,"").split("\n").map(x=>x.trim()).filter(Boolean);const ranked=[];for(const customer of (customers||[])){const hits=aliases(customer).map(a=>scoreAlias(customer,a,lines)).filter(Boolean);const compound=compoundPersonHit(customer,lines);if(compound)hits.push(compound);hits.sort((a,b)=>b.score-a.score);if(!hits.length)continue;const strong=hits.find(h=>h.alias_type!=="BUSINESS_NAME"||(customer.customer_type||"PERSON")==="BUSINESS");const score=strong?Math.max(hits[0].score,strong.score):Math.min(hits[0].score,.69);ranked.push({customer,score,evidence:hits[0],hits:hits.slice(0,4)});}ranked.sort((a,b)=>b.score-a.score);const best=ranked[0],second=ranked[1];if(!best)return {status:"NO_MATCH",customer:null,score:0,ranked:[]};const margin=best.score-(second?.score||0);const personOverBusiness=Boolean(best.customer?.customer_type==="PERSON"&&best.evidence?.reason==="business-plus-known-person"&&second?.customer?.customer_type==="BUSINESS"&&best.score>=.94&&margin>=.04);let status="NO_MATCH";if((best.score>=.90&&margin>=.08)||personOverBusiness)status="MATCHED";else if(best.score>=.72)status=margin<.08?"AMBIGUOUS":"REVIEW";return {status,customer:status==="MATCHED"?best.customer:null,candidate:best.customer,score:best.score,margin,evidence:best.evidence,ranked:ranked.slice(0,5)};}
g.ParcelSnapKnownMatcher={matchDirectory,normalize:N,compact:C};
})(typeof window!=="undefined"?window:globalThis);

