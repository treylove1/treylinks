(() => {
 let generation=0;
 const keys=['recipient_name','address_line','unit','city','state','zip','tracking','order_reference','partner_order','carrier'];
 const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 function rank(result){
  const address=[result.address_line,result.unit,result.city,result.state,result.zip].filter(Boolean).join(' ');
  return (workspace?.customers||[]).map(customer=>{
   const name=candidateScore(customer.name,result.recipient_name||'');
   const saved=customer.address||customer.shipping_address||customer.recipient_address||'';
   const a=saved?candidateScore(saved,address):null;
   return {customer,name,score:a===null?name:name*.85+a*.15,address:a};
  }).sort((a,b)=>b.score-a.score).slice(0,3);
 }
 async function fullPhoto(file){
  let image;
  try{image=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{image=await loadImage(await readFileDataUrl(file));}
  const scale=Math.min(1,1600/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);image.close?.();
  return canvas.toDataURL('image/jpeg',.85);
 }
 function trackingFromBarcode(raw){
  if(!raw)return null;
  const text=raw.trim();
  // A QR payload is not automatically a tracking number. Accept only recognizable plain codes.
  if(/^1Z[A-Z0-9]{16}$/i.test(text)||/^\d{10,22}$/.test(text))return text;
  try{const u=new URL(text);return u.searchParams.get('tracking')||u.searchParams.get('tracking_number')||null;}catch{}
  try{const j=JSON.parse(text);return typeof j.tracking==='string'?j.tracking:null;}catch{return null;}
 }
 async function vision(photo){
  if(!window.PARCEL_VISION_URL)throw Error('Vision proxy is not configured');
  const {data:{session}}=await sb.auth.getSession();if(!session)throw Error('Please sign in');
  const response=await fetch(window.PARCEL_VISION_URL,{method:'POST',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({image_data_url:photo})});
  const body=await response.json();if(!response.ok)throw Error(body.error||'Vision unavailable');
  const r=body.result;if(!r||keys.some(k=>!(k in r)||(r[k]!==null&&typeof r[k]!=='string'))||!Number.isFinite(r.confidence)||r.confidence<0||r.confidence>1)throw Error('Invalid vision result');return r;
 }
 function editor(result,rawBarcode,fallback=false){
  let box=$('visionFields');if(!box){box=document.createElement('div');box.id='visionFields';$('labelReadout').append(box);}box.replaceChildren();
  const title=document.createElement('p');title.textContent=fallback?'Local OCR fallback — verify every field':'AI-estimated confidence: '+Math.round(result.confidence*100)+'% (not verified) · Review all fields';box.append(title);
  for(const key of keys){const label=document.createElement('label');label.textContent=key.replaceAll('_',' ')+(result[key]===null?' — not read':'');const input=document.createElement('input');input.value=result[key]||'';input.dataset.field=key;if(result[key]===null){input.style.border='2px solid #f0ad4e';input.placeholder='Not read — enter manually';}input.oninput=()=>{result[key]=input.value.trim()||null;sync(result);renderLabelReadout();};label.append(input);box.append(label);}
  if(rawBarcode){const p=document.createElement('p');p.textContent='Decoded barcode: '+rawBarcode;box.append(p);}
 }
 function sync(r){intakeOcrName=r.recipient_name||'';intakeOcrAddress=[r.address_line,r.unit,r.city,r.state,r.zip].filter(Boolean).join(', ');intakeOcrText=keys.map(k=>k+': '+(r[k]??'Not read')).join('\n');$('receiveTracking').value=r.tracking||'';$('receiveCarrier').value=r.carrier||'';if(!$('receiveCustomer').value)$('receiveNewCustomerName').value=intakeOcrName;}
 function suggestions(r,ranked){
  const box=$('visionFields');const p=document.createElement('p');p.textContent='Choose a customer (top suggestions):';box.append(p);
  for(const item of ranked){const b=document.createElement('button');b.type='button';b.textContent=item.customer.name+' · '+Math.round(item.score*100)+'% match';b.onclick=()=>{$('receiveCustomer').value=item.customer.id;hideInlineCustomer();renderLabelReadout();$('receiveResult').textContent=item.customer.email?'Customer selected — verify and save':'Email not listed';};box.append(b);}
 }
 $('packagePhoto').onchange=async event=>{
  const file=event.target.files?.[0];if(!file||receiveInFlight)return;
  const current=++generation;const started=performance.now();stopRecoveryOcr();intakeReadToken++;const token=intakeReadToken;
  intakePackageId=crypto.randomUUID();intakeOcrText='';intakeOcrName='';intakeOcrAddress='';
  for(const id of ['receiveTracking','receiveCarrier','receiveCustomer','receiveNewCustomerName','receiveNewCustomerEmail','receiveNewCustomerPhone'])$(id).value='';
  $('visionFields')?.remove();$('receiveResult').textContent='';$('processingBox').classList.remove('hidden');$('processingText').textContent='Reading full photo with AI…';$('processingDetail').textContent='';
  let barcodeResult=null, activeResult=null;
  const codePromise=window.ParcelBarcode.decodePhoto(file,()=>current===generation).catch(()=>({raw:null,status:'Barcode decoder failed — refresh and retry'}));
  const barcodeStatus=document.createElement('p');barcodeStatus.id='barcodeStatus';$('barcodeStatus')?.remove();$('processingBox').append(barcodeStatus);barcodeStatus.textContent='Scanning QR / barcode…';
  // Barcode decoding must not block the completed AI reading or overwrite a different tracking number.
  codePromise.then(decoded=>{
    if(current!==generation)return;
    barcodeResult=decoded;
    barcodeStatus.textContent=decoded.raw?'Decoded barcode: '+decoded.raw:decoded.status;
    const tracking=trackingFromBarcode(decoded.raw);
    if(!tracking){if(decoded.raw)barcodeStatus.textContent+=' · Verify whether this is a tracking number';return;}
    const currentTracking=activeResult?.tracking||$('receiveTracking').value.trim();
    if(currentTracking&&norm(currentTracking)!==norm(tracking)){barcodeStatus.textContent+=' · CONFLICT with AI tracking — verify manually';return;}
    if(!currentTracking){
      $('receiveTracking').value=tracking;
      if(activeResult){
        activeResult.tracking=tracking;
        const input=$('visionFields')?.querySelector('[data-field="tracking"]');
        if(input)input.value=tracking;
        renderLabelReadout();
      }
    }
  });
  try{
   const photo=await fullPhoto(file);if(current!==generation)return;intakePhotoDataUrl=photo;$('packagePhotoPreview').innerHTML='<img src="'+photo+'" alt="Package photo">';

   let result;
   const visionStarted=performance.now();
   try{result=await vision(photo);}catch(error){
    if(current!==generation)return;
    // Full frame fallback avoids the clipped label detector entirely.
    let img;try{img=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{img=await loadImage(await readFileDataUrl(file));}
    let rect;try{rect=detectBrightLabelRegion(img);}catch{}
    if(rect){const px=rect.w*.15,py=rect.h*.15;const x=Math.max(0,rect.x-px),y=Math.max(0,rect.y-py);rect={x,y,w:Math.min(img.width,rect.x+rect.w+px)-x,h:Math.min(img.height,rect.y+rect.h+py)-y};}
    const canvas=drawImageRegionCanvas(img,rect||null,2400);img.close?.();
    const local=await readPackagePhoto(prepareFastOcrCanvas(fitForOcr(canvas,900,1300)),{raw:fitForOcr(canvas,1100,1600),startedAt:started});stopRecoveryOcr();if(current!==generation||local?.superseded)return;
    const raw=barcodeResult?.raw||null;if(current!==generation)return;const tracking=trackingFromBarcode(raw);if(tracking&&!$('receiveTracking').value)$('receiveTracking').value=tracking;
    $('processingDetail').textContent='Low confidence, please verify · '+error.message+' · '+((performance.now()-started)/1000).toFixed(1)+'s';
    $('receiveResult').textContent='Verify all fields before saving. '+((workspace?.customers||[]).find(c=>c.id===$('receiveCustomer').value)?.email?'':'Email not listed');renderLabelReadout();activeResult={...Object.fromEntries(keys.map(k=>[k,null])),recipient_name:intakeOcrName||null,address_line:intakeOcrAddress||null,tracking:$('receiveTracking').value||null,confidence:0};editor(activeResult,raw,true);return;
   }
   // Render the AI result immediately; the independent barcode scan may finish later.
   const raw=barcodeResult?.raw||null;
   const decoded=trackingFromBarcode(raw);
   if(decoded){
     if(!result.tracking||norm(result.tracking)===norm(decoded))result.tracking=decoded;
     else barcodeStatus.textContent='Barcode and AI tracking differ — verify manually';
   }
   activeResult=result;
   sync(result);const ranked=rank(result);const best=ranked[0];const gap=best?best.score-(ranked[1]?.score||0):0;
   const high=result.confidence>=.90&&result.recipient_name&&best?.name>=.94&&best.score>=.93&&gap>=.10&&(best.address===null||best.address>=.80);
   if(high){$('receiveCustomer').value=best.customer.id;hideInlineCustomer();}else{showInlineCustomer(result.recipient_name||'');}
   renderLabelReadout();editor(result,raw);if(!high)suggestions(result,ranked);
   $('processingText').textContent=result.recipient_name||'Name not read';$('processingDetail').textContent='AI '+((performance.now()-visionStarted)/1000).toFixed(1)+'s · Total '+((performance.now()-started)/1000).toFixed(1)+'s · Verify name, address and tracking';
   const customer=high?best.customer:null;
   $('receiveResult').textContent=customer?.email?'Verify highlighted fields':'Email not listed';
   // CAMERA-READINESS FREEZE: no automatic parcel saving or customer email before human review.
   // Model confidence is self-reported, not calibrated against real package-label evaluations.
  }catch(error){if(current!==generation)return;$('processingText').textContent='Photo could not be read';$('processingDetail').textContent='Low confidence, please verify · '+error.message;showInlineCustomer('');}
 };
 window.ParcelVisionInternals={rank,trackingFromBarcode,fullPhoto};
})();
