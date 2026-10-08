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
 async function barcode(data){
  try{const image=await loadImage(data);const reader=new ZXingBrowser.BrowserMultiFormatReader();const r=await reader.decodeFromImageElement(image);return r.getText();}catch{return null;}
 }
 function trackingFromBarcode(raw){
  if(!raw)return null;
  const text=raw.trim();
  if(/^[a-z0-9][a-z0-9 ._-]{5,99}$/i.test(text))return text;
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
  const title=document.createElement('p');title.textContent=fallback?'Local OCR fallback — low confidence, please verify':'AI reading confidence: '+Math.round(result.confidence*100)+'% · Review highlighted fields';box.append(title);
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
  try{
   const photo=await fullPhoto(file);if(current!==generation)return;intakePhotoDataUrl=photo;$('packagePhotoPreview').innerHTML='<img src="'+photo+'" alt="Package photo">';
   const codePromise=barcode(photo);
   let result;
   try{result=await vision(photo);}catch(error){
    if(current!==generation)return;
    // Full frame fallback avoids the clipped label detector entirely.
    const img=await loadImage(photo);const canvas=drawImageRegionCanvas(img,null,1600);
    const local=await readPackagePhoto(canvas,{raw:canvas,startedAt:started});stopRecoveryOcr();if(current!==generation||local?.superseded)return;
    const raw=await codePromise;if(current!==generation)return;const tracking=trackingFromBarcode(raw);if(tracking)$('receiveTracking').value=tracking;
    $('processingDetail').textContent='Low confidence, please verify · '+error.message+' · '+((performance.now()-started)/1000).toFixed(1)+'s';
    $('receiveResult').textContent='Verify all fields before saving. '+((workspace?.customers||[]).find(c=>c.id===$('receiveCustomer').value)?.email?'':'Email not listed');renderLabelReadout();editor({...Object.fromEntries(keys.map(k=>[k,null])),recipient_name:intakeOcrName||null,address_line:intakeOcrAddress||null,tracking:$('receiveTracking').value||null,confidence:0},raw,true);return;
   }
   const raw=await codePromise;if(current!==generation)return;const decoded=trackingFromBarcode(raw);if(decoded)result.tracking=decoded;
   sync(result);const ranked=rank(result);const best=ranked[0];const gap=best?best.score-(ranked[1]?.score||0):0;
   const high=result.confidence>=.90&&result.recipient_name&&best?.name>=.94&&best.score>=.93&&gap>=.10&&(best.address===null||best.address>=.80);
   if(high){$('receiveCustomer').value=best.customer.id;hideInlineCustomer();}else{showInlineCustomer(result.recipient_name||'');}
   renderLabelReadout();editor(result,raw);if(!high)suggestions(result,ranked);
   $('processingText').textContent=result.recipient_name||'Name not read';$('processingDetail').textContent='AI confidence '+Math.round(result.confidence*100)+'% · '+((performance.now()-started)/1000).toFixed(1)+'s';
   const customer=high?best.customer:null;
   $('receiveResult').textContent=customer?.email?'Verify highlighted fields':'Email not listed';
   // Missing required identity/address/tracking fields block unattended sending.
   if(high&&customer.email&&result.address_line&&result.city&&result.zip&&result.tracking&&$('receiveOrigin').value&&token===intakeReadToken){autoReceivedToken=token;await receivePackage();}
  }catch(error){if(current!==generation)return;$('processingText').textContent='Photo could not be read';$('processingDetail').textContent='Low confidence, please verify · '+error.message;showInlineCustomer('');}
 };
 window.ParcelVisionInternals={rank,trackingFromBarcode,fullPhoto};
})();
