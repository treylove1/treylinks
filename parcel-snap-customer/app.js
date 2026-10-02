const SUPABASE_URL="https://evjoitqnogmpedrulepv.supabase.co";
const SUPABASE_KEY="sb_publishable_wv2cDeErfEorwoGCLl9rMA_yo01I01X";
const PORTAL_API=SUPABASE_URL+"/functions/v1/parcel-snap-portal";

const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
let authMode="signin";
let workspace=null;
let intakePhotoDataUrl=null;
let intakeOcrText="";
let intakeOcrName="";
let intakeOcrAddress="";
let transferPhotoDataUrl=null;
let businessSetupStep=1;
let businessSetupLocations=[];
let businessSetupPreviewMode=false;
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

const $=id=>document.getElementById(id);
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}

function normText(s=""){return String(s).toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim()}
function editDistance(a,b){a=normText(a);b=normText(b);const m=a.length,n=b.length,dp=Array.from({length:m+1},()=>Array(n+1).fill(0));for(let i=0;i<=m;i++)dp[i][0]=i;for(let j=0;j<=n;j++)dp[0][j]=j;for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return dp[m][n]}
function tokenSimilarity(a,b){a=normText(a);b=normText(b);if(!a||!b)return 0;if(a===b)return 1;if((a.length>=4&&b.includes(a))||(b.length>=4&&a.includes(b)))return .92;return 1-editDistance(a,b)/Math.max(a.length,b.length)}
function cleanRecipientCandidate(value){
  let v=String(value||"")
    .replace(/[\\|]+/g," ")
    .replace(/[^A-Za-z.' -]/g," ")
    .replace(/\s+/g," ")
    .trim();

  v=v.replace(/^(customer|recipient|consignee)\s*[:\-]?\s*/i,"");
  if(!v)return "";

  const words=v.split(" ").filter(Boolean);
  if(words.length>5)return "";
  if(words.some(w=>w.length===1))return "";
  if(/return address|tracking|package|order reference|partner order|in hand date|street|road|avenue|lane|unit|warehouse|hialeah|sweetwater|florida|bahamas|roadie|fedex|usps|amazon/i.test(v))return "";

  if(words.length===1 && words[0].length<6)return "";
  if(words.length>=2 && !words.some(w=>w.length>=4))return "";

  return words.map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(" ");
}

function recipientAnalysis(text){
  const raw=String(text||"").replace(/\r/g,"");
  const lines=raw.split("\n").map(x=>x.trim()).filter(Boolean);

  const streetRegex=/^\s*\d{3,6}\s+.*\b(?:NW|NE|SW|SE)?\s*(?:AVE|AVENUE|ST|STREET|RD|ROAD|BLVD|DR|DRIVE|LANE|LN|HWY|HIGHWAY)\b/i;
  const cityZipRegex=/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i;

  for(const line of lines){
    const explicit=line.match(/(?:your\s+)?electr[\W_]*[o0]nic\s+needs\s*[\\/|:\-]+\s*(.+)$/i)
      || line.match(/\byen\s*[\\/|:\-]+\s*(.+)$/i);
    if(explicit){
      const name=cleanRecipientCandidate(explicit[1]);
      if(name)return {name,confidence:.97,reason:"business-slash-recipient"};
    }
  }

  for(let i=0;i<lines.length;i++){
    if(streetRegex.test(lines[i])){
      const previous=lines[i-1]||"";
      const previous2=lines[i-2]||"";

      const slashSource=[previous,previous2].find(x=>/[\\/|]/.test(x)&&/needs|yen|electr/i.test(x));
      if(slashSource){
        const tail=slashSource.replace(/^.*?[\\/|]\s*/,"");
        const name=cleanRecipientCandidate(tail);
        if(name)return {name,confidence:.95,reason:"recipient-line-before-destination-address"};
      }

      const name=cleanRecipientCandidate(previous);
      const hasCityAfter=Boolean(lines[i+1]&&cityZipRegex.test(lines[i+1]));
      if(name&&hasCityAfter){
        return {name,confidence:.82,reason:"name-directly-above-destination-address"};
      }
    }
  }

  return {name:"",confidence:0,reason:"unresolved"};
}

function extractNameCandidate(text){
  const result=recipientAnalysis(text);
  return result.confidence>=.82?result.name:"";
}

function candidateScore(name,candidate){
  const nameCompact=normText(name).replace(/ /g,"");
  const candidateCompact=normText(candidate).replace(/ /g,"");
  if(!nameCompact||!candidateCompact)return 0;
  if(nameCompact===candidateCompact)return 1;
  if(candidateCompact.length>=6&&(nameCompact.startsWith(candidateCompact)||candidateCompact.startsWith(nameCompact)))return .96;
  if(candidateCompact.length>=6&&nameCompact.includes(candidateCompact))return .94;
  return 1-editDistance(nameCompact,candidateCompact)/Math.max(nameCompact.length,candidateCompact.length);
}

function scoreName(name,text){
  const analysis=recipientAnalysis(text);
  if(!analysis.name||analysis.confidence<.82)return 0;
  return candidateScore(name,analysis.name)*analysis.confidence;
}

function bestCustomerFromText(text){
  if(!workspace?.customers?.length)return null;

  if(window.ParcelSnapKnownMatcher){
    const result=window.ParcelSnapKnownMatcher.matchDirectory(workspace.customers,text);
    if(result.status==="MATCHED"&&result.customer){
      return {customer:result.customer,score:result.score,knownMatch:result};
    }
    return null;
  }

  const ranked=workspace.customers
    .map(customer=>({customer,score:scoreName(customer.name,text)}))
    .sort((a,b)=>b.score-a.score);
  const best=ranked[0],second=ranked[1];
  if(!best)return null;
  const clear=best.score>=.78&&(!second||best.score-second.score>=.06);
  return clear?best:null;
}

function guessTracking(text){
  const raw=String(text||"");
  const anchored=raw.match(/PACKAGE\s+TRACKING\s+CODE[\s\S]{0,120}?([A-Z0-9][A-Z0-9-]{7,40})/i);
  if(anchored?.[1])return anchored[1];
  const tokens=raw.match(/[A-Z0-9][A-Z0-9-]{8,35}/gi)||[];
  return tokens.find(t=>!/^(ADDRESS|PACKAGE|CUSTOMER|TRACKING|ELECTRONIC|REFERENCE)$/i.test(t))||"";
}

function guessCarrier(text){
  const t=String(text||"").toUpperCase();
  if(t.includes("ROADIE"))return "Roadie";
  if(t.includes("FEDEX"))return "FedEx";
  if(t.includes("USPS")||t.includes("UNITED STATES POSTAL"))return "USPS";
  if(/\bUPS\b/.test(t))return "UPS";
  if(t.includes("AMAZON"))return "Amazon";
  return "";
}

function guessRecipientAddress(text){
  const lines=String(text||"").replace(/\r/g,"").split("\n").map(x=>x.trim()).filter(Boolean);
  const nameCandidate=extractNameCandidate(text);
  let start=-1;

  if(nameCandidate){
    const target=normText(nameCandidate).replace(/ /g,"");
    for(let i=0;i<lines.length;i++){
      const compact=normText(lines[i]).replace(/ /g,"");
      if(compact.includes(target.slice(0,Math.min(target.length,7)))){start=i+1;break}
    }
  }

  if(start<0){
    for(let i=0;i<lines.length;i++){
      if(/^\d{3,6}\s+/.test(lines[i])&&/\b(?:AVE|AVENUE|ST|STREET|RD|ROAD|BLVD|DR|LANE|LN|HWY)\b/i.test(lines[i])){
        start=i;
        break;
      }
    }
  }

  if(start<0)return "";
  const collected=[];
  for(let i=start;i<Math.min(lines.length,start+3);i++){
    if(/order reference|partner order|in hand date|tracking code/i.test(lines[i]))break;
    collected.push(lines[i]);
  }
  return collected.join(", ");
}

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

function showInlineCustomer(candidate=""){
  $("receiveNewCustomer").classList.remove("hidden");
  if(candidate&&!$("receiveNewCustomerName").value)$("receiveNewCustomerName").value=candidate;
}

function hideInlineCustomer(){
  $("receiveNewCustomer").classList.add("hidden");
}

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

function setMode(mode){
  authMode=mode;
  $("signInMode").classList.toggle("active",mode==="signin");
  $("signUpMode").classList.toggle("active",mode==="signup");
  $("joinStaffMode").classList.toggle("active",mode==="join");
  $("signupCompanyWrap").classList.toggle("hidden",mode!=="signup");
  $("staffInviteWrap").classList.toggle("hidden",mode!=="join");
  $("authButton").textContent=mode==="signin"?"Sign in":mode==="signup"?"Create company account":"Create staff account";
  $("password").autocomplete=mode==="signin"?"current-password":"new-password";
  $("authMessage").textContent="";
}
$("signInMode").onclick=()=>setMode("signin");
$("signUpMode").onclick=()=>setMode("signup");
$("joinStaffMode").onclick=()=>setMode("join");

async function api(body){
  const {data:{session}}=await sb.auth.getSession();
  if(!session)throw new Error("Please sign in again.");
  const r=await fetch(PORTAL_API,{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization":"Bearer "+session.access_token,
      "apikey":SUPABASE_KEY
    },
    body:JSON.stringify(body)
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||"Portal request failed.");
  return data;
}

$("authButton").onclick=async()=>{
  const email=$("email").value.trim();
  const password=$("password").value;
  $("authMessage").textContent="";
  try{
    if(authMode==="signin"){
      const {error}=await sb.auth.signInWithPassword({email,password});
      if(error)throw error;
    }else if(authMode==="signup"){
      const company_name=$("signupCompany").value.trim();
      if(!company_name)throw new Error("Enter your company name.");
      const {data,error}=await sb.auth.signUp({email,password});
      if(error)throw error;
      if(!data.session){
        $("authMessage").textContent="Account created. Check your email to confirm it, then sign in.";
        return;
      }
      await api({action:"onboard",company_name});
    }else{
      const inviteCode=$("staffInviteCode").value.trim().toUpperCase();
      if(!inviteCode)throw new Error("Enter the staff invite code.");
      localStorage.setItem("parcel-snap-pending-invite",inviteCode);
      const {data,error}=await sb.auth.signUp({email,password});
      if(error)throw error;
      if(!data.session){
        $("authMessage").textContent="Account created. Confirm your email, then sign in. Your staff code is saved on this device.";
        return;
      }
      await api({action:"claim_staff_invite",code:inviteCode});
      localStorage.removeItem("parcel-snap-pending-invite");
    }
    await boot();
  }catch(e){
    $("authMessage").textContent=e.message||String(e);
  }
};

$("signOut").onclick=async()=>{await sb.auth.signOut();location.reload()};

async function boot(){
  const {data:{session}}=await sb.auth.getSession();
  if(!session){
    $("authView").classList.remove("hidden");
    $("appView").classList.add("hidden");
    return;
  }
  $("authView").classList.add("hidden");
  $("appView").classList.remove("hidden");

  const pendingInvite=localStorage.getItem("parcel-snap-pending-invite");
  if(pendingInvite){
    try{
      await api({action:"claim_staff_invite",code:pendingInvite});
      localStorage.removeItem("parcel-snap-pending-invite");
    }catch(e){
      console.warn("Pending staff invite could not be claimed:",e);
    }
  }

  await loadWorkspace();
}

function showOnly(id){
  ["loadingState","onboardingState","billingState","businessSetupState","activeWorkspace"].forEach(x=>$(x).classList.add("hidden"));
  $(id).classList.remove("hidden");
}

async function loadWorkspace(){
  showOnly("loadingState");
  try{
    workspace=await api({action:"workspace"});
    if(workspace.state==="NO_COMPANY"){
      showOnly("onboardingState");
      if(workspace.onboarding?.company_name)$("onboardingCompany").value=workspace.onboarding.company_name;
      return;
    }
    if(workspace.state==="PAYMENT_REQUIRED"){
      showOnly("billingState");
      $("companyTitle").textContent=workspace.company?.name||"Parcel Snap";
      $("companyMeta").textContent=workspace.company?.role?"Role: "+workspace.company.role:"";
      $("billingStatus").textContent="Status: "+(workspace.subscription?.status||"Payment required");
      $("payLink").href=workspace.payment_link;
      return;
    }
    if(workspace.state==="BUSINESS_SETUP_REQUIRED"){
      prepareBusinessSetup(workspace);
      showOnly("businessSetupState");
      return;
    }
    if(workspace.state==="ACTIVE"){
      renderWorkspace();
      showOnly("activeWorkspace");
      return;
    }
    throw new Error("Unknown workspace state.");
  }catch(e){
    $("loadingState").innerHTML="<h2>Workspace unavailable</h2><p>"+esc(e.message||String(e))+"</p>";
  }
}

$("saveOnboarding").onclick=async()=>{
  const company_name=$("onboardingCompany").value.trim();
  if(!company_name)return;
  try{
    const r=await api({action:"onboard",company_name});
    workspace=r;
    showOnly("billingState");
    $("companyTitle").textContent=r.company_name||company_name;
    $("billingStatus").textContent="Payment required";
    $("payLink").href=r.payment_link;
  }catch(e){alert(e.message)}
};
$("recheckAccess").onclick=loadWorkspace;

function setBusinessSetupStep(step){
  businessSetupStep=Number(step)||1;
  [1,2,3,4].forEach(n=>{
    const panel=$("businessSetupStep"+n);
    if(panel)panel.classList.toggle("hidden",n!==businessSetupStep);
    const dot=document.querySelector('[data-setup-dot="'+n+'"]');
    if(dot)dot.classList.toggle("active",n===businessSetupStep);
  });
}

function prepareBusinessSetup(data){
  const profile=data.profile||{};
  businessSetupLocations=Array.isArray(data.locations)?data.locations.map(x=>({...x})):[];
  $("businessSetupPreviewResult").classList.add("hidden");
  $("businessSetupPreviewResult").innerHTML="";
  $("businessSetupMessage").textContent="";
  $("exitBusinessSetupPreview").classList.toggle("hidden",!businessSetupPreviewMode);
  $("profileBusinessType").value=profile.business_type||"";
  $("profileBusinessName").value=profile.primary_business_name||data.company?.name||"";
  $("profileEmployees").value=profile.employee_count??"";
  $("profileCustomers").value=profile.estimated_customers??"";
  $("profilePackagesPerDay").value=profile.packages_per_day??"";
  $("profileWebsite").value=profile.website||"";
  $("profilePallets").checked=Boolean(profile.handles_pallets);
  $("profileOversize").checked=Boolean(profile.handles_oversize);
  $("profileAppliances").checked=Boolean(profile.handles_appliances);
  $("profileTVs").checked=Boolean(profile.handles_tvs);
  $("profileStorage").checked=Boolean(profile.needs_storage);
  $("profileReturns").checked=Boolean(profile.needs_returns);
  $("profileInspection").checked=Boolean(profile.needs_inspection);
  $("profileDelivery").checked=Boolean(profile.needs_delivery);
  $("profileNotifications").checked=profile.needs_customer_notifications!==false;
  $("profileEmail").checked=(profile.notification_channels||["EMAIL"]).includes("EMAIL");
  $("profileWhatsApp").checked=(profile.notification_channels||[]).includes("WHATSAPP");
  $("profileWorkerLogins").checked=profile.needs_worker_sublogins!==false;
  $("profileDrivers").checked=Boolean(profile.needs_driver_access);
  $("profileNotes").value=profile.notes||"";
  renderBusinessSetupLocations();
  setBusinessSetupStep(1);
}

function renderBusinessSetupLocations(){
  const root=$("setupLocationList");
  if(!root)return;
  if(!businessSetupLocations.length){
    root.innerHTML='<div class="empty">No locations added yet.</div>';
    return;
  }
  root.innerHTML=businessSetupLocations.map((loc,index)=>{
    const roleLabels={
      RECEIVE:"Receives packages",
      DESTINATION:"Destination / storage",
      BOTH:"Receives and sends/moves packages",
      NON_WAREHOUSE:"No package handling"
    };
    return '<div class="setupLocationCard"><div class="itemTop"><div><strong>'+
      esc(loc.label||loc.city||("Location "+(index+1)))+
      '</strong><br><small>'+
      esc([loc.city,loc.region,loc.country].filter(Boolean).join(", "))+
      ' · '+esc(roleLabels[loc.operation_role]||loc.operation_role||"BOTH")+
      '</small></div><button class="ghost" data-remove-setup-location="'+index+'">Remove</button></div></div>';
  }).join("");
  root.querySelectorAll("[data-remove-setup-location]").forEach(btn=>{
    btn.onclick=()=>{
      businessSetupLocations.splice(Number(btn.dataset.removeSetupLocation),1);
      renderBusinessSetupLocations();
    };
  });
}

function addBusinessSetupLocation(){
  const city=$("setupLocationCity").value.trim();
  if(!city){alert("Enter the city for this location.");return}
  const location={
    label:$("setupLocationLabel").value.trim()||city+" Location",
    city,
    region:$("setupLocationRegion").value.trim()||null,
    country:$("setupLocationCountry").value.trim()||null,
    address_line1:$("setupLocationAddress").value.trim()||null,
    use_type:$("setupLocationUseType").value,
    operation_role:$("setupLocationRole").value,
    employee_count:$("setupLocationEmployees").value||null,
    handles_customer_pickup:$("setupLocationPickup").checked,
    handles_delivery_dispatch:$("setupLocationDispatch").checked,
    handles_returns:$("setupLocationReturns").checked,
    handles_inspection:$("setupLocationInspection").checked
  };
  businessSetupLocations.push(location);
  ["setupLocationLabel","setupLocationCity","setupLocationRegion","setupLocationCountry","setupLocationEmployees","setupLocationAddress"].forEach(id=>$(id).value="");
  ["setupLocationPickup","setupLocationDispatch","setupLocationReturns","setupLocationInspection"].forEach(id=>$(id).checked=false);
  renderBusinessSetupLocations();
}

document.querySelectorAll("[data-setup-next]").forEach(btn=>btn.onclick=()=>{
  const next=Number(btn.dataset.setupNext);
  if(businessSetupStep===1){
    if(!$("profileBusinessType").value.trim()){alert("Tell us what kind of business you operate.");return}
    if(!$("profileBusinessName").value.trim()){alert("Enter the business name.");return}
  }
  if(businessSetupStep===2&&!businessSetupLocations.length){
    alert("Add at least one business location.");
    return;
  }
  setBusinessSetupStep(next);
});
document.querySelectorAll("[data-setup-back]").forEach(btn=>btn.onclick=()=>setBusinessSetupStep(Number(btn.dataset.setupBack)));
$("addSetupLocation").onclick=addBusinessSetupLocation;

$("saveBusinessSetup").onclick=async()=>{
  if(!businessSetupLocations.length){alert("Add at least one business location.");return}
  const channels=[];
  if($("profileEmail").checked)channels.push("EMAIL");
  if($("profileWhatsApp").checked)channels.push("WHATSAPP");

  const profile={
    business_type:$("profileBusinessType").value.trim(),
    primary_business_name:$("profileBusinessName").value.trim(),
    employee_count:$("profileEmployees").value||null,
    estimated_customers:$("profileCustomers").value||null,
    packages_per_day:$("profilePackagesPerDay").value||null,
    website:$("profileWebsite").value.trim()||null,
    handles_pallets:$("profilePallets").checked,
    handles_oversize:$("profileOversize").checked,
    handles_appliances:$("profileAppliances").checked,
    handles_tvs:$("profileTVs").checked,
    needs_storage:$("profileStorage").checked,
    needs_returns:$("profileReturns").checked,
    needs_inspection:$("profileInspection").checked,
    needs_delivery:$("profileDelivery").checked,
    needs_customer_notifications:$("profileNotifications").checked,
    notification_channels:channels.length?channels:["EMAIL"],
    needs_worker_sublogins:$("profileWorkerLogins").checked,
    needs_driver_access:$("profileDrivers").checked,
    notes:$("profileNotes").value.trim()||null
  };

  $("saveBusinessSetup").disabled=true;
  $("businessSetupMessage").textContent="Building your Parcel Snap workspace…";
  try{
    if(businessSetupPreviewMode){
      const result=await api({action:"preview_business_profile",profile,locations:businessSetupLocations});
      const t=result.tailored||{};
      const facilities=(t.facilities||[]).map(f=>"<li>"+esc(f.name)+" — "+esc(f.facility_type)+"</li>").join("");
      const recommendations=(t.recommendations||[]).map(x=>"<li>"+esc(x)+"</li>").join("");
      $("businessSetupPreviewResult").innerHTML=
        "<article class='card'><span class='eyebrow'>OWNER PREVIEW — NOTHING SAVED</span>"+
        "<h3>Parcel Snap would build this workspace</h3>"+
        "<p><strong>"+esc(String(t.employee_count??""))+"</strong> employees · "+
        "<strong>"+esc(String(t.estimated_customers??""))+"</strong> customers · "+
        "<strong>"+esc(String(t.packages_per_day??""))+"</strong> packages/day</p>"+
        "<h4>Facilities</h4><ul>"+facilities+"</ul>"+
        "<h4>Recommended setup</h4><ul>"+recommendations+"</ul></article>";
      $("businessSetupPreviewResult").classList.remove("hidden");
      $("businessSetupMessage").textContent="Preview complete. Your real workspace was not changed.";
    }else{
      await api({action:"save_business_profile",profile,locations:businessSetupLocations});
      $("businessSetupMessage").textContent="Workspace created.";
      await loadWorkspace();
    }
  }catch(e){
    $("businessSetupMessage").textContent=e.message||String(e);
  }finally{
    $("saveBusinessSetup").disabled=false;
  }
};

$("testBusinessSetup").onclick=()=>{
  businessSetupPreviewMode=true;
  prepareBusinessSetup({
    company:workspace.company,
    profile:{
      primary_business_name:"",
      notification_channels:["EMAIL"],
      needs_customer_notifications:true,
      needs_worker_sublogins:true
    },
    locations:[]
  });
  showOnly("businessSetupState");
};

$("exitBusinessSetupPreview").onclick=async()=>{
  businessSetupPreviewMode=false;
  await loadWorkspace();
};

function renderWorkspace(){
  $("companyTitle").textContent=workspace.company.name;
  $("companyMeta").textContent=workspace.company.role+" · "+workspace.subscription.status;
  $("packageCount").textContent=workspace.packages.length;
  $("customerCount").textContent=workspace.customers.length;
  $("facilityCount").textContent=workspace.facilities.length;
  $("attentionCount").textContent=workspace.attention.length;
  renderAttention();
  renderPackages("");
  renderCustomers();
  renderAliasControls();
  renderFacilities();
  renderReceiveControls();
  renderTransferControls();
  renderStaffControls();
  setTimeout(warmParcelSnapOcr,0);
  $("testBusinessSetup").classList.toggle("hidden",workspace.company.role!=="OWNER");
  $("subscriptionCard").innerHTML="<div class='billingBox'><strong>ParcelSnap Business Subscription</strong><span>"+esc(workspace.subscription.status)+"</span><small>"+(workspace.subscription.current_period_end?"Current period ends "+new Date(workspace.subscription.current_period_end).toLocaleDateString():"Active access")+"</small></div>";
}

function renderAttention(){
  const root=$("attentionList");
  if(!workspace.attention.length){root.innerHTML="<div class='empty'>Nothing needs attention right now.</div>";return}
  root.innerHTML=workspace.attention.map(x=>"<div class='item'><div class='itemTop'><div><strong>"+esc(x.customer_name||x.tracking_number||"Package")+"</strong><br><small>"+esc(x.tracking_number||"No tracking")+"</small></div><span class='status warn'>"+esc(x.action_needed)+"</span></div><div class='meta'><div><small>Status</small><strong>"+esc(x.stage)+"</strong></div><div><small>Suggested location</small><strong>"+esc(x.suggested_location_code||"-")+"</strong></div><div><small>Storage fee</small><strong>$"+Number(x.storage_fee||0).toFixed(2)+"</strong></div></div></div>").join("");
}

function renderPackages(q){
  q=String(q||"").toLowerCase();
  const rows=workspace.packages.filter(p=>[p.customer_name,p.tracking_number,p.location_code,p.stage].filter(Boolean).join(" ").toLowerCase().includes(q));
  $("packageList").innerHTML=rows.length?rows.map(p=>"<div class='item'><div class='itemTop'><div><strong>"+esc(p.customer_name||"Unmatched customer")+"</strong><br><small>"+esc(p.tracking_number||"No tracking number")+"</small></div><span class='status'>"+esc(p.stage)+"</span></div><div class='meta'><div><small>Payment</small><strong>"+esc(p.payment_status)+"</strong></div><div><small>Location</small><strong>"+esc(p.location_code||"-")+"</strong></div><div><small>Updated</small><strong>"+new Date(p.updated_at).toLocaleDateString()+"</strong></div></div></div>").join(""):"<div class='empty'>No packages found.</div>";
}
$("packageSearch").oninput=e=>renderPackages(e.target.value);

function renderCustomers(){
  $("customerList").innerHTML=workspace.customers.length
    ? workspace.customers.map(c=>{
        const aliases=(c.aliases||[]).map(a=>esc(a.alias)).filter(Boolean);
        return "<div class='item'>"+
          "<div class='itemTop'><div><strong>"+esc(c.name)+"</strong><br><small>"+esc(c.customer_type||"PERSON")+" · "+esc(c.email||"No email")+" · "+esc(c.phone||"No phone")+"</small></div><span class='status'>RECOGNITION TARGET</span></div>"+
          (aliases.length?"<div class='meta'><div><small>Known label names / codes</small><strong>"+aliases.join(" · ")+"</strong></div></div>":"")+
          "</div>";
      }).join("")
    : "<div class='empty'>No recognition targets yet.</div>";
}
function renderAliasControls(){
  const root=$("aliasCustomer");
  if(!root)return;
  const current=root.value;
  root.innerHTML='<option value="">Select customer</option>'+
    (workspace?.customers||[]).map(c=>'<option value="'+c.id+'">'+esc(c.name)+'</option>').join("");
  if((workspace?.customers||[]).some(c=>c.id===current))root.value=current;
}

$("addAliasButton").onclick=async()=>{
  const customer_id=$("aliasCustomer").value;
  const alias=$("aliasValue").value.trim();
  const alias_type=$("aliasType").value;

  if(!customer_id){alert("Choose the customer.");return}
  if(!alias){alert("Enter the alias or customer code.");return}

  try{
    await api({action:"add_customer_alias",customer_id,alias,alias_type});
    $("aliasValue").value="";
    await loadWorkspace();
    document.querySelector('[data-tab="customers"]').click();
  }catch(e){alert(e.message||String(e))}
};

function renderFacilities(){
  $("facilityList").innerHTML=workspace.facilities.length?workspace.facilities.map(f=>"<div class='item'><div class='itemTop'><div><strong>"+esc(f.name)+"</strong><br><small>"+esc([f.address_line1,f.city,f.region,f.country].filter(Boolean).join(", ")||"Address not set")+"</small></div><span class='status'>"+esc(f.facility_type)+"</span></div></div>").join(""):"<div class='empty'>No warehouse profiles yet.</div>";
}

function renderStaffControls(){
  const role=workspace?.company?.role||"";
  const staffFeatureEnabled=workspace?.profile?.needs_worker_sublogins!==false;
  const canManageStaff=["OWNER","MANAGER"].includes(role)&&staffFeatureEnabled;

  $("staffTabButton").classList.toggle("hidden",!canManageStaff);
  $("billingTabButton").classList.toggle("hidden",role!=="OWNER");

  if(!canManageStaff)return;

  $("staffFacilityChoices").innerHTML=(workspace.facilities||[]).map(f=>
    '<label class="facilityChoice"><input type="checkbox" value="'+f.id+'"><span>'+esc(f.name)+'</span></label>'
  ).join("")||"<div class='empty'>Add a warehouse before creating warehouse-worker access.</div>";

  $("staffList").innerHTML=(workspace.staff||[]).length
    ? workspace.staff.map(s=>"<div class='item'><div class='itemTop'><div><strong>"+esc(s.email||"Staff account")+"</strong><br><small>"+esc(s.role)+"</small></div><span class='status'>"+(s.active?"ACTIVE":"INACTIVE")+"</span></div></div>").join("")
    : "<div class='empty'>No staff accounts yet.</div>";

  $("pendingInviteList").innerHTML=(workspace.pending_invites||[]).length
    ? workspace.pending_invites.map(i=>"<div class='item'><strong>"+esc(i.email||"Unassigned email")+"</strong><br><small>"+esc(i.role)+" · expires "+new Date(i.expires_at).toLocaleDateString()+"</small></div>").join("")
    : "<div class='empty'>No pending invite codes.</div>";
}

$("createStaffInviteButton").onclick=async()=>{
  const role=$("staffRole").value;
  const facility_ids=[...$("staffFacilityChoices").querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value);
  const email=$("staffEmail").value.trim();

  $("staffInviteResult").classList.add("hidden");
  try{
    const r=await api({action:"create_staff_invite",email,role,facility_ids});
    $("staffInviteResult").innerHTML="<strong>One-time staff code</strong><span class='inviteCode'>"+esc(r.invite.code)+"</span><small>"+esc(r.invite.role)+" · expires "+new Date(r.invite.expires_at).toLocaleString()+"</small>";
    $("staffInviteResult").classList.remove("hidden");
    $("staffEmail").value="";
    await loadWorkspace();
    document.querySelector('[data-tab="staff"]').click();
  }catch(e){
    alert(e.message||String(e));
  }
};

function facilitySort(items){
  const order={MIA:1,FLL:2,ORL:3,NAS:4};
  return [...items].sort((a,b)=>(order[a.code]||50)-(order[b.code]||50)||String(a.name).localeCompare(String(b.name)));
}

function renderReceiveControls(){
  const customers=workspace?.customers||[];
  const facilities=facilitySort((workspace?.facilities||[]).filter(f=>f.active!==false));

  const currentCustomer=$("receiveCustomer").value;
  const currentOrigin=$("receiveOrigin").value;
  const currentDestination=$("receiveDestination").value;

  $("receiveCustomer").innerHTML='<option value="">New / unmatched customer</option>'+
    customers.map(c=>'<option value="'+c.id+'">'+esc(c.name)+(c.email?" — "+esc(c.email):"")+'</option>').join("");
  if(customers.some(c=>c.id===currentCustomer))$("receiveCustomer").value=currentCustomer;

  const allFacilityOptions=facilities.map(f=>'<option value="'+f.id+'">'+esc(f.name)+'</option>').join("");
  $("receiveOrigin").innerHTML=allFacilityOptions||'<option value="">No warehouse configured</option>';
  $("receiveDestination").innerHTML='<option value="">No next warehouse selected</option>'+allFacilityOptions;

  if(facilities.length){
    const miami=facilities.find(f=>f.code==="MIA");
    const nassau=facilities.find(f=>f.code==="NAS");
    if(facilities.some(f=>f.id===currentOrigin))$("receiveOrigin").value=currentOrigin;
    else if(miami)$("receiveOrigin").value=miami.id;

    if(facilities.some(f=>f.id===currentDestination))$("receiveDestination").value=currentDestination;
    else if(nassau)$("receiveDestination").value=nassau.id;
  }

  if(!$("receiveCustomer").value)showInlineCustomer(intakeOcrName);
  else hideInlineCustomer();
}

$("receiveCustomer").onchange=()=>{
  if($("receiveCustomer").value)hideInlineCustomer();
  else showInlineCustomer(intakeOcrName);
};

$("packagePhoto").onchange=async e=>{
  const file=e.target.files?.[0];
  if(!file)return;
  $("receiveResult").textContent="";
  $("receiveNewCustomerEmail").value="";
  $("receiveNewCustomerPhone").value="";
  try{
    const [uploadImage,ocrImage]=await Promise.all([
      compressImage(file),
      prepareOcrImage(file)
    ]);
    intakePhotoDataUrl=uploadImage;
    $("packagePhotoPreview").innerHTML='<img src="'+intakePhotoDataUrl+'" alt="Package photo">';
    const result=await readPackagePhoto(ocrImage);
    intakeOcrAddress=result.address||"";
  }catch(err){
    console.error(err);
    $("processingBox").classList.remove("hidden");
    $("processingText").textContent="New / unmatched customer";
    $("processingDetail").textContent="Enter customer name and email";
    showInlineCustomer(intakeOcrName);
  }
};

async function createReceiveCustomer(){
  const name=$("receiveNewCustomerName").value.trim();
  const email=$("receiveNewCustomerEmail").value.trim();
  const phone=$("receiveNewCustomerPhone").value.trim();
  if(!name)throw new Error("Enter the customer name.");
  if(!email)throw new Error("Enter the customer email so Parcel Snap can send the arrival notice.");

  const result=await api({action:"create_customer",name,email,phone});
  const customer=result.customer;
  workspace.customers=workspace.customers||[];
  workspace.customers.push(customer);
  renderReceiveControls();
  $("receiveCustomer").value=customer.id;
  hideInlineCustomer();
  return customer.id;
}

$("saveReceiveCustomer").onclick=async()=>{
  try{
    const customerId=await createReceiveCustomer();
    $("receiveCustomer").value=customerId;
    $("processingText").textContent=$("receiveNewCustomerName").value.trim()||"Customer saved";
    $("processingDetail").textContent="Email saved for future package notices";
  }catch(e){
    alert(e.message||String(e));
  }
};

$("addCustomerButton").onclick=async()=>{
  const name=$("newCustomerName").value.trim();
  const email=$("newCustomerEmail").value.trim();
  const phone=$("newCustomerPhone").value.trim();
  const customer_type=$("newCustomerType").value;
  const labelAlias=$("newCustomerAlias").value.trim();
  const customerCode=$("newCustomerCode").value.trim();

  if(!name){alert("Enter the customer or business name.");return}

  const aliases=[];
  if(labelAlias)aliases.push({alias:labelAlias,alias_type:"LABEL"});
  if(customerCode)aliases.push({alias:customerCode,alias_type:"CUSTOMER_CODE"});

  try{
    await api({action:"create_customer",name,email,phone,customer_type,aliases});
    ["newCustomerName","newCustomerEmail","newCustomerPhone","newCustomerAlias","newCustomerCode"].forEach(id=>$(id).value="");
    $("newCustomerType").value="PERSON";
    await loadWorkspace();
    document.querySelector('[data-tab="customers"]').click();
  }catch(e){alert(e.message)}
};

$("addFacilityButton").onclick=async()=>{
  const body={
    action:"create_facility",
    name:$("newFacilityName").value.trim(),
    facility_type:$("newFacilityType").value,
    city:$("newFacilityCity").value.trim(),
    address_line1:$("newFacilityAddress").value.trim()||null,
    region:$("newFacilityRegion").value.trim()||null,
    postal_code:$("newFacilityPostal").value.trim()||null,
    country:$("newFacilityCountry").value.trim()||null
  };
  if(!body.name||!body.city){alert("Enter the warehouse name and city.");return}
  try{
    await api(body);
    ["newFacilityName","newFacilityCity","newFacilityAddress","newFacilityRegion","newFacilityPostal","newFacilityCountry"].forEach(id=>$(id).value="");
    await loadWorkspace();
    document.querySelector('[data-tab="warehouses"]').click();
  }catch(e){alert(e.message)}
};

$("receivePackageButton").onclick=async()=>{
  let customer_id=$("receiveCustomer").value;
  const origin_facility_id=$("receiveOrigin").value;

  if(!intakePhotoDataUrl){alert("Take a package photo first.");return}
  if(!origin_facility_id){alert("Choose the receiving warehouse.");return}

  $("receivePackageButton").disabled=true;
  $("receiveResult").textContent="Saving package…";

  try{
    if(!customer_id){
      customer_id=await createReceiveCustomer();
    }

    const r=await api({
      action:"receive_package",
      customer_id,
      origin_facility_id,
      destination_facility_id:$("receiveDestination").value||null,
      tracking_number:$("receiveTracking").value||null,
      carrier:$("receiveCarrier").value.trim()||null,
      size_class:$("receiveSize").value,
      weight_lb:$("receiveWeight").value||null,
      payment_status:$("receivePayment").value,
      ocr_name:intakeOcrName||null,
      ocr_tracking:$("receiveTracking").value||null,
      ocr_raw_text:intakeOcrText||null,
      ocr_recipient_address:intakeOcrAddress||null,
      photo_data_url:intakePhotoDataUrl
    });

    const emailStatus=r.email?.status||"SKIPPED";
    $("receiveResult").textContent=
      "Package received · photo saved · email "+emailStatus+
      (r.assigned_location_id?" · location assigned":"");

    intakePhotoDataUrl=null;
    intakeOcrText="";
    intakeOcrName="";
    intakeOcrAddress="";
    $("packagePhoto").value="";
    $("packagePhotoPreview").innerHTML="";
    $("processingBox").classList.add("hidden");
    $("receiveTracking").value="";
    $("receiveCarrier").value="";
    $("receiveWeight").value="";
    $("receiveNewCustomerName").value="";
    $("receiveNewCustomerEmail").value="";
    $("receiveNewCustomerPhone").value="";
    hideInlineCustomer();

    await loadWorkspace();
    document.querySelector('[data-tab="receive"]').click();
  }catch(e){
    $("receiveResult").textContent=e.message||String(e);
  }finally{
    $("receivePackageButton").disabled=false;
  }
};


function renderTransferControls(){
  const facilities=facilitySort((workspace?.facilities||[]).filter(f=>f.active!==false));
  const packages=(workspace?.packages||[]).filter(p=>!["DELIVERED","PICKED_UP"].includes(p.stage));

  const currentFacility=$("transferFacility")?.value||"";
  const currentPackage=$("transferPackage")?.value||"";

  if($("transferFacility")){
    $("transferFacility").innerHTML=facilities.map(f=>'<option value="'+f.id+'">'+esc(f.name)+'</option>').join("")||'<option value="">No warehouse configured</option>';
    if(facilities.some(f=>f.id===currentFacility))$("transferFacility").value=currentFacility;
    else{
      const nassau=facilities.find(f=>f.code==="NAS");
      if(nassau)$("transferFacility").value=nassau.id;
    }
  }

  if($("transferPackage")){
    $("transferPackage").innerHTML='<option value="">Select package</option>'+packages.map(p=>{
      const ref=p.tracking_number||"No tracking";
      const who=p.customer_name||"Unknown customer";
      return '<option value="'+p.id+'">'+esc(who)+' — '+esc(ref)+' — '+esc(p.stage)+'</option>';
    }).join("");
    if(packages.some(p=>p.id===currentPackage))$("transferPackage").value=currentPackage;
  }
}

function normalizeTracking(v){
  return String(v||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
}

function chooseTransferCandidates(tracking,customerId){
  const active=(workspace?.packages||[]).filter(p=>!["DELIVERED","PICKED_UP"].includes(p.stage));
  const t=normalizeTracking(tracking);

  let candidates=[];
  if(t){
    candidates=active.filter(p=>normalizeTracking(p.tracking_number)===t);
    if(candidates.length)return candidates;
  }

  if(customerId){
    candidates=active.filter(p=>String(p.customer_id||"")===String(customerId));
    if(candidates.length)return candidates;
  }

  return active;
}

async function analyzeTransferImage(dataUrl){
  const started=performance.now();
  const barcodePromise=detectBarcode(dataUrl);

  let merged=await fastOcrRecognize(dataUrl);
  let tracking=await barcodePromise;
  if(!tracking)tracking=guessTracking(merged);

  let m=window.ParcelSnapKnownMatcher
    ? window.ParcelSnapKnownMatcher.matchDirectory(workspace?.customers||[],merged)
    : {status:"NO_MATCH",customer:null};

  if(!tracking&&m.status!=="MATCHED"){
    const enhanced=await enhanceForReading(dataUrl);
    const recovery=await fastOcrRecognize(enhanced);
    if(recovery)merged+="\n"+recovery;
    if(!tracking)tracking=guessTracking(merged);
    m=window.ParcelSnapKnownMatcher
      ? window.ParcelSnapKnownMatcher.matchDirectory(workspace?.customers||[],merged)
      : {status:"NO_MATCH",customer:null};
  }

  return {
    tracking,
    text:merged,
    customer:m.customer||null,
    match:m,
    elapsed_seconds:Number(((performance.now()-started)/1000).toFixed(1))
  };
}

$("transferPhoto").onchange=async e=>{
  const file=e.target.files?.[0];
  if(!file)return;

  $("transferResult").textContent="";
  $("transferProcessing").classList.remove("hidden");
  $("transferProcessingText").textContent="Reading package…";
  $("transferProcessingDetail").textContent="";

  try{
    const original=await readFileDataUrl(file);
    const [uploadImage,ocrImage]=await Promise.all([
      resizeDataUrl(original,1600,.82),
      resizeDataUrl(original,2800,.96)
    ]);

    transferPhotoDataUrl=uploadImage;
    $("transferPhotoPreview").innerHTML='<img src="'+uploadImage+'" alt="Arrival package photo">';

    const result=await analyzeTransferImage(ocrImage);
    const candidates=chooseTransferCandidates(result.tracking,result.customer?.id);

    $("transferPackage").innerHTML='<option value="">Select package</option>'+candidates.map(p=>{
      const ref=p.tracking_number||"No tracking";
      const who=p.customer_name||"Unknown customer";
      return '<option value="'+p.id+'">'+esc(who)+' — '+esc(ref)+' — '+esc(p.stage)+'</option>';
    }).join("");

    if(candidates.length===1)$("transferPackage").value=candidates[0].id;

    if(candidates.length===1){
      $("transferProcessingText").textContent=candidates[0].customer_name||"Package matched";
      $("transferProcessingDetail").textContent=result.tracking
        ?"Existing package found · tracking matched"
        :"Existing package found · customer matched";
    }else if(candidates.length>1){
      $("transferProcessingText").textContent=result.customer?.name||"Multiple possible packages";
      $("transferProcessingDetail").textContent="Choose the correct package";
    }else{
      $("transferProcessingText").textContent="Existing package not found";
      $("transferProcessingDetail").textContent=result.tracking
        ?"Tracking read, but no active package matched"
        :"Choose an existing package manually";
      renderTransferControls();
    }
  }catch(err){
    console.error(err);
    $("transferProcessingText").textContent="Could not identify package";
    $("transferProcessingDetail").textContent="Choose the package manually";
    renderTransferControls();
  }
};

$("saveTransfer").onclick=async()=>{
  const package_id=$("transferPackage").value;
  const facility_id=$("transferFacility").value;

  if(!package_id){alert("Choose the package.");return}
  if(!facility_id){alert("Choose the arriving warehouse.");return}
  if(!transferPhotoDataUrl){alert("Take the arrival photo first.");return}

  $("saveTransfer").disabled=true;
  $("transferResult").textContent="Saving arrival…";

  try{
    const r=await api({
      action:"destination_arrival",
      package_id,
      facility_id,
      note:$("transferNote").value.trim()||null,
      photo_data_url:transferPhotoDataUrl
    });

    $("transferResult").textContent=
      "Arrival saved · photo saved · email "+(r.email?.status||"SKIPPED")+
      (r.assigned_location_id?" · location assigned":"");

    transferPhotoDataUrl=null;
    $("transferPhoto").value="";
    $("transferPhotoPreview").innerHTML="";
    $("transferProcessing").classList.add("hidden");
    $("transferNote").value="";

    await loadWorkspace();
    document.querySelector('[data-tab="transfer"]').click();
  }catch(e){
    $("transferResult").textContent=e.message||String(e);
  }finally{
    $("saveTransfer").disabled=false;
  }
};

document.querySelectorAll(".tab").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===btn));
  document.querySelectorAll(".panel").forEach(x=>x.classList.add("hidden"));
  $("tab-"+btn.dataset.tab).classList.remove("hidden");
});

if("requestIdleCallback" in window){
  requestIdleCallback(warmParcelSnapOcr,{timeout:800});
}else{
  setTimeout(warmParcelSnapOcr,100);
}

sb.auth.onAuthStateChange((_event,session)=>{if(!session){$("authView").classList.remove("hidden");$("appView").classList.add("hidden")}});
boot();
