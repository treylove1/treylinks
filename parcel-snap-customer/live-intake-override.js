(function(scope){
  'use strict';
  const SUPABASE_URL='https://evjoitqnogmpedrulepv.supabase.co';
  const SUPABASE_KEY='sb_publishable_wv2cDeErfEorwoGCLl9rMA_yo01I01X';
  const LIVE_URL=SUPABASE_URL+'/functions/v1/parcel-snap-live-intake';
  let sending=false,lastSignature='';
  const $=id=>document.getElementById(id);
  const client=typeof sb!=='undefined'?sb:scope.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);

  function previewPhoto(){
    const src=document.querySelector('#packagePhotoPreview img')?.src||'';
    return /^data:image\/(?:jpeg|png|webp);base64,/i.test(src)?src:'';
  }
  function value(id){return $(id)?.value?.trim?.()||'';}
  function exactAutoDecision(){
    try{return scope.ParcelSnapIntakeReview?.autoDirectoryDecision?.()||null;}catch{return null;}
  }
  function signature(){return [previewPhoto().slice(-96),value('receiveCustomer'),value('receiveTracking'),value('receiveOrigin')].join('|');}
  function show(message){if($('receiveResult'))$('receiveResult').textContent=message;}

  async function liveReceivePackage({automatic=false}={}){
    if(sending)return;
    const customerId=value('receiveCustomer'),origin=value('receiveOrigin'),tracking=value('receiveTracking'),recipient=value('receiveLabelName'),address=value('receiveAddress'),photo=previewPhoto();
    if(automatic){
      const d=exactAutoDecision();
      if(!d?.autoSafe||d.customerId!==customerId)return;
    }
    if(!customerId){show('Select the saved customer first. No email was sent.');return;}
    if(!origin){show('Choose the receiving warehouse. No email was sent.');return;}
    if(!recipient){show('Recipient name was not read from the label. Review the photo; no email was sent.');return;}
    if(!tracking){show('Tracking number was not read from the label. Review the photo; no email was sent.');return;}
    if(!photo){show('Choose a package photo first. No email was sent.');return;}
    const sig=signature();if(automatic&&sig===lastSignature)return;
    sending=true;lastSignature=sig;
    const button=$('receivePackageButton');if(button){button.disabled=true;button.textContent='Saving + emailing…';}
    show('Saving package and sending the stored customer email…');
    try{
      const {data:{session},error:sessionError}=await client.auth.getSession();
      if(sessionError||!session?.access_token)throw new Error('Please sign in again.');
      const weight=value('receiveWeight');
      const body={
        action:'receive_package',
        package_id:crypto.randomUUID(),
        customer_id:customerId,
        origin_facility_id:origin,
        destination_facility_id:value('receiveDestination')||null,
        tracking_number:tracking,
        carrier:value('receiveCarrier')||null,
        size_class:value('receiveSize')||'UNKNOWN',
        payment_status:value('receivePayment')||'UNKNOWN',
        weight_lb:weight===''?null:Number(weight),
        recipient_name:recipient,
        recipient_address:address||null,
        ocr_raw_text:$('labelRawText')?.textContent||null,
        photo_data_url:photo
      };
      const response=await fetch(LIVE_URL,{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json().catch(()=>({error:'Parcel Snap returned an unreadable response.'}));
      if(!response.ok&&!result?.ok)throw new Error(result?.error||('Package intake failed ('+response.status+').'));
      const status=result?.email?.status||'UNKNOWN';
      if(status==='SENT'){
        show('✓ Package saved. Arrival email SENT to the customer email already stored in Parcel Snap.'+(weight===''?' Weight was left blank by design.':''));
      }else if(result?.duplicate){
        show('Package was already saved. No duplicate email was sent. Recorded email status: '+status+'.');
      }else if(status==='FAILED'){
        show('Package saved, but email FAILED: '+(result.email?.error||'provider rejected the send')+'.');
      }else{
        show('Package saved. Email status is '+status+'. '+(result.email?.error||'Do not press send again until the status is checked.'));
      }
      if(typeof scope.loadWorkspace==='function')setTimeout(()=>scope.loadWorkspace().catch?.(()=>{}),500);
    }catch(error){
      if(automatic)lastSignature='';
      show((error?.message||String(error))+' Nothing was automatically resent.');
    }finally{
      sending=false;
      if(button){button.disabled=false;button.textContent='Save Package + Email Customer';}
    }
  }

  function install(){
    const button=$('receivePackageButton');
    if(!button)return;
    button.onclick=()=>liveReceivePackage({automatic:false});
    button.disabled=false;
    button.textContent='Save Package + Email Customer';
    new MutationObserver(()=>{if(!sending&&button.disabled)button.disabled=false;}).observe(button,{attributes:true,attributeFilter:['disabled']});

    const weight=$('receiveWeight');
    if(weight){
      weight.required=false;
      weight.placeholder='Optional — leave blank if not printed';
      const label=weight.closest('label');
      const first=label?.childNodes?.[0];
      if(first?.nodeType===Node.TEXT_NODE&&!/optional/i.test(first.nodeValue||''))first.nodeValue='Weight (lb) — optional\n';
    }

    const notice=document.querySelector('#tab-receive .localReviewNotice');
    if(notice){
      const strong=notice.querySelector('strong');if(strong)strong.textContent='Live receiving enabled for exact saved-customer matches';
      const p=notice.querySelector('p');if(p)p.textContent='Take or choose a label photo. Parcel Snap reads the label, fills the package fields, matches the saved customer, saves the package and emails the stored customer address. Weight is optional. Uncertain customer or tracking reads stop for review.';
    }

    const result=$('receiveResult');
    if(result){
      new MutationObserver(()=>{
        const text=result.textContent||'';
        if(/Exact customer matched and fields are ready|Automatic save\/email is still held/i.test(text))setTimeout(()=>liveReceivePackage({automatic:true}),0);
      }).observe(result,{childList:true,characterData:true,subtree:true});
    }
    const confirm=$('receiveLabelConfirmed');
    confirm?.addEventListener('change',()=>{if(confirm.checked&&exactAutoDecision()?.autoSafe)setTimeout(()=>liveReceivePackage({automatic:true}),0);});
  }

  scope.ParcelSnapLiveIntake=Object.freeze({liveReceivePackage});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
