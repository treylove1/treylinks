const SUPABASE_URL="https://evjoitqnogmpedrulepv.supabase.co";
const SUPABASE_KEY="sb_publishable_wv2cDeErfEorwoGCLl9rMA_yo01I01X";
const PORTAL_API=SUPABASE_URL+"/functions/v1/parcel-snap-portal";

const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
let authMode="signin";
let workspace=null;
let workspaceLoadGeneration=0;
let signOutState="IDLE";
let authActionInFlight=false;
let intakePhotoDataUrl=null;
let intakeOcrText="";
let intakeOcrName="";
// Presentation only: never use a tentative vision name as matching/intake evidence.
let intakeRecipientDisplay=null;
let intakeTrackingReview=null;
let intakeVisionWarnings=[];
let intakeFieldEditGeneration=0;
let intakePhotoPending=false;
let intakeOcrAddress="";
let transferPhotoDataUrl=null;
let transferInFlight=false;
let transferPhotoGeneration=0;
let transferPhotoPending=false;
let transferFieldEditGeneration=0;
let businessSetupStep=1;
let businessSetupLocations=[];
let businessSetupPreviewMode=false;
let businessSetupPrepay=false;
let intakeReadToken=0;
let autoReceivedToken=0;
let receiveInFlight=false;
let intakePackageId=null;
const displayedArrivalContacts={receive:null,transfer:null};
const confirmedArrivalReviews={receive:null,transfer:null};
let displayedTransferPackage=null;
const arrivalEmailRecovery={receive:null,transfer:null};
let arrivalEmailRecoveryGeneration=0;
let arrivalListRefreshGeneration=0;

function bindPhotoSources(cameraId,galleryId,isSaving){
  const camera=$(cameraId),gallery=$(galleryId);
  if(!camera||!gallery)return;
  for(const input of [camera,gallery]){
    input.onclick=event=>{
      if(isSaving()){event?.preventDefault();return false;}
      // Let the same file trigger change again. Cancelling the native picker
      // leaves the reviewed image and fields intact; only change selects a photo.
      input.value="";
    };
  }
  // Resolve the current handler at selection time: vision-client may replace
  // the intake camera handler after app.js has installed the local fallback.
  gallery.onchange=event=>camera.onchange?.(event);
}

function clearInactivePhotoSource(cameraId,galleryId,activeInput){
  for(const id of [cameraId,galleryId]){
    const input=$(id);
    if(input&&input!==activeInput)input.value="";
  }
}

let intakeTiming={
  read_token:0,
  started_at_ms:0,
  first_result_seconds:null,
  background_recovery_seconds:null,
  background_extra_seconds:null
};

function resetIntakeTiming(readToken=0,startedAt=0){
  intakeTiming={
    read_token:readToken,
    started_at_ms:startedAt,
    first_result_seconds:null,
    background_recovery_seconds:null,
    background_extra_seconds:null
  };
}

function recordBackgroundRecoveryTiming(readToken,startedAt){
  if(intakeTiming.read_token!==readToken||!startedAt)return;
  const total=Number(Math.max(0,(performance.now()-startedAt)/1000).toFixed(1));
  const first=Number.isFinite(intakeTiming.first_result_seconds)
    ? intakeTiming.first_result_seconds
    : null;
  intakeTiming.background_recovery_seconds=total;
  intakeTiming.background_extra_seconds=first===null
    ? null
    : Number(Math.max(0,total-first).toFixed(1));
}

function intakeTimingSummary(){
  const parts=[];
  if(Number.isFinite(intakeTiming.first_result_seconds)){
    parts.push("first "+intakeTiming.first_result_seconds.toFixed(1)+"s");
  }
  if(Number.isFinite(intakeTiming.background_recovery_seconds)){
    parts.push("recovery "+intakeTiming.background_recovery_seconds.toFixed(1)+"s");
  }
  return parts.length?" · OCR "+parts.join(" · "):"";
}

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

async function fastOcrRecognizeDetailed(image){
  const slot=parcelSnapOcrSlots.fast;
  const workerPromise=getSlotWorker(slot);
  const gen=slot.gen;
  slot.busy=true;
  try{
    const worker=await workerPromise;
    if(slot.gen!==gen)throw new Error("OCR worker was stopped");
    if(slot.psm!==PARCEL_SNAP_FAST_PSM){
      await worker.setParameters({tessedit_pageseg_mode:PARCEL_SNAP_FAST_PSM});
      slot.psm=PARCEL_SNAP_FAST_PSM;
    }
    const result=await worker.recognize(image,{}, {text:true,blocks:true});
    return {
      text:result?.data?.text||"",
      blocks:Array.isArray(result?.data?.blocks)?result.data.blocks:[]
    };
  }finally{
    if(slot.gen===gen)slot.busy=false;
  }
}

const $=id=>document.getElementById(id);
function resetLabelConfirmation(){
  confirmedArrivalReviews.receive=null;
  const checkbox=$("receiveLabelConfirmed");
  if(checkbox)checkbox.checked=false;
}
function markIntakeEdit(){
  intakeFieldEditGeneration++;
  resetLabelConfirmation();
}
function resetTransferConfirmation(){
  confirmedArrivalReviews.transfer=null;
  if($("transferLabelConfirmed"))$("transferLabelConfirmed").checked=false;
}
function contactReviewSnapshot(customer){
  return customer?{customer_id:customer.id,name:String(customer.name||""),
    email:customer.contact_email_visible===true?String(customer.email||""):"",
    contact_email_visible:typeof customer.contact_email_visible==="boolean"?customer.contact_email_visible:null,
    contact_version:typeof customer.contact_email_visible==="boolean"&&typeof customer.contact_version==="string"?customer.contact_version:null}:null;
}
function displayArrivalContact(kind,customer){
  const contact=contactReviewSnapshot(customer);
  if(JSON.stringify(displayedArrivalContacts[kind])!==JSON.stringify(contact)){
    if(kind==="receive")resetLabelConfirmation();else resetTransferConfirmation();
  }
  // Only display paths may refresh this version; sending never reads a newer directory version.
  displayedArrivalContacts[kind]=contact;
  const wording=$(kind+"ConfirmationText");
  if(wording)wording.textContent=kind==="receive"
    ?(contact?.contact_email_visible!==true
      ?"I checked the photo, selected customer, address and tracking. Send the arrival notice to this customer's saved contact."
      :"I checked the photo, recipient, address, tracking and customer email. Send the arrival notice to this customer.")
    :(contact?.contact_email_visible!==true
      ?"I checked this arrival photo, selected package, tracking and customer. Send the arrival notice to this customer's saved contact."
      :"I checked this arrival photo, selected package, tracking and customer email. Send the arrival notice.");
  return contact;
}
function arrivalEmailDescription(contact){
  if(contact&&contact.contact_email_visible===null)return "Customer contact visibility unavailable; refresh before confirming";
  if(contact?.contact_email_visible===false)return "Email address hidden for your role; notice uses the selected customer's saved contact";
  return contact?.email?"Email: "+contact.email:"Email not listed";
}
function arrivalReviewSignature(kind){
  const ids=kind==="receive"
    ?["receiveCustomer","receiveOrigin","receiveDestination","receiveTracking","receiveAddress","receiveCarrier","receiveSize","receiveWeight","receivePayment","receiveNewCustomerName","receiveNewCustomerEmail","receiveNewCustomerPhone","receiveNewCustomerAlias"]
    :["transferPackage","transferFacility","transferNote"];
  return JSON.stringify({company:workspace?.company?.id||null,generation:arrivalEmailRecoveryGeneration,
    values:ids.map(id=>$(id)?.value||""),contact:displayedArrivalContacts[kind],
    package:kind==="transfer"?displayedTransferPackage:null});
}
function selectedArrivalCustomerId(kind){
  return kind==="receive"?$("receiveCustomer").value:
    (workspace?.packages||[]).find(p=>p.id===$("transferPackage").value)?.customer_id;
}
function captureArrivalConfirmation(kind){
  const checkbox=$(kind==="receive"?"receiveLabelConfirmed":"transferLabelConfirmed");
  const contact=displayedArrivalContacts[kind];
  confirmedArrivalReviews[kind]=null;
  if(!checkbox?.checked)return;
  if(!contact?.contact_version||contact.customer_id!==selectedArrivalCustomerId(kind)){
    checkbox.checked=false;
    $(kind==="receive"?"receiveResult":"transferResult").textContent=kind==="receive"&&!selectedArrivalCustomerId(kind)
      ?"Save or select the customer first, then review their contact and confirm."
      :"Review the saved customer contact before confirming. If the contact cannot be verified, refresh the workspace first.";
    return;
  }
  if(kind==="transfer"&&!displayedTransferPackage?.review_version){
    checkbox.checked=false;
    $("transferResult").textContent="Review the current package details before confirming. Refresh the workspace if package review is unavailable.";
    return;
  }
  confirmedArrivalReviews[kind]={contact:{...contact},signature:arrivalReviewSignature(kind),
    package_review_version:kind==="transfer"?displayedTransferPackage.review_version:null,
    photo:kind==="receive"?intakePhotoDataUrl:transferPhotoDataUrl};
}
function reviewedArrivalConfirmation(kind){
  const checkbox=$(kind==="receive"?"receiveLabelConfirmed":"transferLabelConfirmed");
  const review=confirmedArrivalReviews[kind];
  if(checkbox?.checked&&review&&review.signature===arrivalReviewSignature(kind)
    &&review.contact.customer_id===selectedArrivalCustomerId(kind)
    &&review.photo===(kind==="receive"?intakePhotoDataUrl:transferPhotoDataUrl))return {...review.contact,package_review_version:review.package_review_version};
  if(kind==="receive")resetLabelConfirmation();else resetTransferConfirmation();
  return null;
}
function renderTransferRecipient(){
  const selected=(workspace?.packages||[]).find(p=>p.id===$("transferPackage").value);
  const customer=(workspace?.customers||[]).find(c=>c.id===selected?.customer_id);
  const contact=displayArrivalContact("transfer",customer);
  const shown=selected?{id:selected.id,customer_id:selected.customer_id,name:contact?.name||selected.customer_name||"",tracking:selected.tracking_number||"",
    review_version:typeof selected.review_version==="string"?selected.review_version:null}:null;
  if(JSON.stringify(shown)!==JSON.stringify(displayedTransferPackage))resetTransferConfirmation();
  displayedTransferPackage=shown;
  const readout=$("transferRecipient");
  if(readout)readout.textContent=selected
    ?"Recipient: "+(contact?.name||selected.customer_name||"Unknown customer")+" · "+
      arrivalEmailDescription(contact)+" · Tracking: "+(selected.tracking_number||"Not listed")
    :"Choose a package to review its customer email.";
  if(confirmedArrivalReviews.transfer)reviewedArrivalConfirmation("transfer");
}
function renderArrivalEmailRecovery(kind){
  const state=arrivalEmailRecovery[kind];
  const box=$(kind+"EmailRecovery"),button=$(kind+"CheckEmailStatus"),message=$(kind+"EmailStatus");
  if(!box||!button||!message)return;
  box.classList.toggle("hidden",!state);
  button.classList.toggle("hidden",!state||!["UNKNOWN","SENDING"].includes(state.status));
  button.disabled=Boolean(state?.inFlight);
  message.textContent=state?"Saved package "+state.reference+": "+state.message:"";
}

function arrivalEmailRecoveryScope(){
  return {generation:arrivalEmailRecoveryGeneration,companyId:workspace?.company?.id||null};
}
function isCurrentArrivalEmailScope(scope){
  return scope?.generation===arrivalEmailRecoveryGeneration&&scope.companyId===(workspace?.company?.id||null);
}
function clearArrivalEmailRecovery(){
  arrivalEmailRecoveryGeneration++;
  resetLabelConfirmation();resetTransferConfirmation();
  displayedArrivalContacts.receive=null;displayedArrivalContacts.transfer=null;displayedTransferPackage=null;
  for(const kind of ["receive","transfer"]){arrivalEmailRecovery[kind]=null;renderArrivalEmailRecovery(kind);}
}

function rememberArrivalEmailRecovery(kind,identity,result,reference,scope){
  if(!isCurrentArrivalEmailScope(scope))return;
  const status=result.email?.status;
  if(!status)return;
  // Copy only immutable event identity. No photo, recipient or mutable form data belongs in a status request.
  const request=kind==="receive"
    ?{action:"receive_package",intake_package_id:identity.intake_package_id,origin_facility_id:identity.origin_facility_id,reconcile_notification:true}
    :{action:"destination_arrival",package_id:identity.package_id,facility_id:identity.facility_id,reconcile_notification:true};
  if(!["UNKNOWN","SENDING"].includes(status)){
    const prior=arrivalEmailRecovery[kind];
    if(prior&&JSON.stringify(prior.request)===JSON.stringify(request)){
      arrivalEmailRecovery[kind]={...prior,status,inFlight:false,message:"Recorded email status: "+status+". No status-check resend was attempted."};
      renderArrivalEmailRecovery(kind);
    }
    return;
  }
  const facilityId=identity.origin_facility_id||identity.facility_id;
  const facilityName=(workspace?.facilities||[]).find(item=>item.id===facilityId)?.name||facilityId;
  arrivalEmailRecovery[kind]={request:Object.freeze(request),status,reference:(reference||identity.intake_package_id||identity.package_id)+" at "+facilityName,
    ...scope,inFlight:false,
    message:"Email outcome is uncertain. Check its status before any resend."};
  renderArrivalEmailRecovery(kind);
}

async function checkArrivalEmailStatus(kind){
  const state=arrivalEmailRecovery[kind];
  if(!state||state.inFlight||!["UNKNOWN","SENDING"].includes(state.status))return;
  if(!isCurrentArrivalEmailScope(state)){clearArrivalEmailRecovery();return;}
  state.inFlight=true;
  state.message="Checking the saved email record. No resend will be attempted.";
  renderArrivalEmailRecovery(kind);
  try{
    const result=await api({...state.request});
    if(arrivalEmailRecovery[kind]!==state||!isCurrentArrivalEmailScope(state))return;
    const status=result.email?.status;
    if(status==="SENT"){
      state.status="SENT";
      state.message="Email provider acceptance confirmed; this does not guarantee inbox delivery."+
        (result.email?.provider_event?" Provider event: "+result.email.provider_event+".":"");
    }else if(["UNKNOWN","SENDING"].includes(status)||!status){
      state.status=status||"UNKNOWN";
      state.message="Still unresolved. Do not resend or create another intake for this notice. Ask an administrator to reconcile the provider record."+
        (result.email?.error?" "+result.email.error:"");
    }else{
      state.status=status;
      state.message="Recorded email status: "+status+". This check did not send an email. Review with an administrator before another attempt."+
        (result.email?.error?" "+result.email.error:"");
    }
  }catch(error){
    if(arrivalEmailRecovery[kind]!==state||!isCurrentArrivalEmailScope(state))return;
    state.message="Status could not be verified. No resend attempted. Ask an administrator to check the saved notice. "+(error.message||String(error));
  }finally{
    if(arrivalEmailRecovery[kind]===state){
      if(!isCurrentArrivalEmailScope(state))clearArrivalEmailRecovery();
      else{state.inFlight=false;renderArrivalEmailRecovery(kind);}
    }
  }
}

async function refreshSavedArrivalLists(scope){
  if(!scope?.companyId||!isCurrentArrivalEmailScope(scope))return null;
  const currentWorkspace=workspace;
  const generation=++arrivalListRefreshGeneration;
  try{
    const latest=await api({action:"workspace"});
    if(workspace!==currentWorkspace||generation!==arrivalListRefreshGeneration||!isCurrentArrivalEmailScope(scope))return null;
    if(latest.state!=="ACTIVE"||latest.company?.id!==scope.companyId||!Array.isArray(latest.packages)||!Array.isArray(latest.attention))return false;
    const selectedId=$("transferPackage").value;
    const previous=(workspace.packages||[]).find(p=>p.id===selectedId);
    workspace.packages=latest.packages;
    workspace.attention=latest.attention;
    $("packageCount").textContent=workspace.packages.length;
    $("attentionCount").textContent=workspace.attention.length;
    renderPackages($("packageSearch").value);
    renderAttention();
    // Refresh package choices only. Do not rerender or default either intake form or warehouse.
    const active=workspace.packages.filter(p=>!["DELIVERED","PICKED_UP"].includes(p.stage));
    const selected=active.find(p=>p.id===selectedId);
    $("transferPackage").innerHTML='<option value="">Select package</option>'+active.map(p=>
      '<option value="'+p.id+'">'+esc(p.customer_name||"Unknown customer")+' — '+esc(p.tracking_number||"No tracking")+' — '+esc(p.stage)+'</option>').join("");
    $("transferPackage").value=selected?selectedId:"";
    if(selectedId&&(!selected||previous?.customer_id!==selected.customer_id||previous?.tracking_number!==selected.tracking_number)){
      transferFieldEditGeneration++;
      resetTransferConfirmation();
    }
    renderTransferRecipient();
    return true;
  }catch{return false;}
}

function intakeReviewFormSignature(){
  return JSON.stringify(["receiveCustomer","receiveOrigin","receiveDestination","receiveTracking","receiveAddress","receiveCarrier","receiveSize","receiveWeight","receivePayment","receiveNewCustomerName","receiveNewCustomerEmail","receiveNewCustomerPhone","receiveNewCustomerAlias"]
    .map(id=>$(id)?.value||"").concat($("receiveLabelConfirmed")?.checked===true));
}

async function resumeSavedIntake(packageId){
  const saved=(workspace?.packages||[]).find(p=>p.id===packageId);
  if(saved?.origin_review_pending!==true||!saved.origin_facility_id){$("receiveResult").textContent="This package has no editable saved origin review.";return;}
  if(receiveInFlight||intakePhotoPending){$("receiveResult").textContent="Finish the current photo or save before opening a saved review.";return;}
  if(intakePhotoDataUrl&&!confirm("Replace the current unsaved intake view with this saved review?"))return;
  const scope=arrivalEmailRecoveryScope();
  const originalWorkspace=workspace;
  const edits=intakeFieldEditGeneration,signature=intakeReviewFormSignature();
  stopRecoveryOcr();
  const token=++intakeReadToken;
  if(intakeRecipientDisplay)intakeRecipientDisplay.read_token=token;
  intakePhotoPending=true;
  $("receiveResult").textContent="Loading the saved private label for review…";
  document.querySelector('[data-tab="receive"]').click();
  try{
    const result=await api({action:"review_saved_arrival",package_id:saved.id,origin_facility_id:saved.origin_facility_id});
    if(token!==intakeReadToken||workspace!==originalWorkspace||!isCurrentArrivalEmailScope(scope))return;
    if(edits!==intakeFieldEditGeneration||signature!==intakeReviewFormSignature()){
      $("receiveResult").textContent="Your newer intake edits were kept. Open the saved review again when ready.";return;
    }
    const s=result.snapshot;
    if(result.ok!==true||result.editable!==true||!s||s.intake_package_id!==saved.id||s.origin_facility_id!==saved.origin_facility_id||
      !s.customer_id||s.customer?.id!==s.customer_id||typeof s.customer.name!=="string"||
      s.origin_facility?.id!==s.origin_facility_id||typeof s.origin_facility.name!=="string"||
      (s.destination_facility_id&&(s.destination_facility?.id!==s.destination_facility_id||typeof s.destination_facility.name!=="string"))||
      (s.tracking_number!=null&&typeof s.tracking_number!=="string")||
      typeof s.photo_data_url!=="string"||s.photo_data_url.length>14*1024*1024||!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(s.photo_data_url))throw Error("The saved review could not be verified. No intake was replaced.");
    const customerIndex=(workspace.customers||[]).findIndex(c=>c.id===s.customer_id);
    if(customerIndex<0)workspace.customers.push(s.customer);
    else workspace.customers[customerIndex]={...workspace.customers[customerIndex],...s.customer};
    // A saved destination may be outside the worker's receiving-location list.
    // Use its server-authorized label without inventing a new location or changing route defaults.
    const addOption=(id,value,label)=>{
      const select=$(id);
      const existing=Array.from(select.options||[]).find(option=>option.value===value);
      if(existing)existing.textContent=label;
      else select.innerHTML+='<option value="'+esc(value)+'">'+esc(label)+'</option>';
      select.value=value;
    };
    addOption("receiveCustomer",s.customer_id,s.customer.name+(s.customer.email?" — "+s.customer.email:""));
    addOption("receiveOrigin",s.origin_facility_id,s.origin_facility.name);
    if(s.destination_facility_id)addOption("receiveDestination",s.destination_facility_id,s.destination_facility.name);
    else $("receiveDestination").value="";
    intakePackageId=s.intake_package_id;
    intakePhotoDataUrl=s.photo_data_url;
    intakeOcrText=String(s.ocr_raw_text||"");
    intakeOcrName=String(s.ocr_name||"");
    intakeOcrAddress=String(s.ocr_recipient_address||"");
    intakeRecipientDisplay=null;
    intakeTrackingReview={status:"SAVED_REVIEW",message:"Saved value — verify against the stored photo"};
    intakeVisionWarnings=[];
    intakeFieldEditGeneration++;
    resetLabelConfirmation();
    resetIntakeTiming(token,0);
    $("receiveTracking").value=s.tracking_number||"";
    $("receiveCarrier").value=String(s.carrier||"");
    $("receiveSize").value=s.size_class||"UNKNOWN";
    $("receivePayment").value=s.payment_status||"UNKNOWN";
    $("receiveWeight").value=s.weight_lb==null?"":String(s.weight_lb);
    for(const id of ["receiveNewCustomerName","receiveNewCustomerEmail","receiveNewCustomerPhone","receiveNewCustomerAlias"]){$(id).value="";}
    $("packagePhoto").value="";
    if($("packagePhotoGallery"))$("packagePhotoGallery").value="";
    $("packagePhotoPreview").innerHTML='<img src="'+s.photo_data_url+'" alt="Saved package label for review">';
    $("processingBox").classList.remove("hidden");
    $("processingText").textContent=s.customer.name;
    $("processingDetail").textContent="Saved intake restored — check the photo and details before confirming";
    $("receiveOriginWrap").classList.remove("hidden");
    $("receiveDestinationWrap").classList.remove("hidden");
    $("receiveRouteSummary").textContent="Saved receiving: "+s.origin_facility.name+(s.destination_facility_id?" → Next: "+s.destination_facility.name:"");
    $("receiveRouteSummary").classList.remove("hidden");
    hideInlineCustomer();
    renderLabelReadout();
    $("receiveResult").textContent="Saved review loaded with its original package ID. No email was sent. Confirm only after checking the photo, recipient and tracking.";
  }catch(error){
    if(token===intakeReadToken&&workspace===originalWorkspace&&isCurrentArrivalEmailScope(scope))$("receiveResult").textContent=error.message||String(error);
  }finally{
    if(token===intakeReadToken)intakePhotoPending=false;
  }
}

function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}

function normText(s=""){return String(s).toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim()}
function editDistance(a,b){a=normText(a);b=normText(b);const m=a.length,n=b.length,dp=Array.from({length:m+1},()=>Array(n+1).fill(0));for(let i=0;i<=m;i++)dp[i][0]=i;for(let j=0;j<=n;j++)dp[0][j]=j;for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return dp[m][n]}
function tokenSimilarity(a,b){a=normText(a);b=normText(b);if(!a||!b)return 0;if(a===b)return 1;if((a.length>=4&&b.includes(a))||(b.length>=4&&a.includes(b)))return .92;return 1-editDistance(a,b)/Math.max(a.length,b.length)}
function cleanRecipientCandidate(value){
  let v=String(value||"")
    .replace(/[\\|]+/g," ")
    .replace(/[^\p{L}\p{M}.' -]/gu," ")
    .replace(/\s+/g," ")
    .trim();

  v=v.replace(/^(customer|recipient|consignee)\s*[:\-]?\s*/i,"");
  if(!v)return "";

  const words=v.split(" ").filter(Boolean);
  if(words.length>5)return "";
  if(words.some(w=>w.length===1))return "";
  if(/^(?:return\s+(?:address|to)|tracking(?:\s+(?:number|code))?|package|order reference|partner order|in hand date|warehouse|roadie|fedex|usps|ups|amazon)$/i.test(v))return "";

  if(words.length===1 && words[0].length<6)return "";
  if(words.length>=2 && !words.some(w=>w.length>=4))return "";

  return words.map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(" ");
}

const destinationStreetRegex=/^\s*\d{1,6}\s+.*\b(?:ave|avenue|st|street|rd|road|blvd|boulevard|dr|drive|lane|ln|hwy|highway|way|ct|court|pl|place|circle|cir|terrace|ter)\b/i;
const destinationCityZipRegex=/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i;
const destinationPostalBoxRegex=/^(?:P\.?\s*O\.?\s+BOX|POST\s+OFFICE\s+BOX)\s+\d+\b/i;
const destinationUnitRegex=/^(?:UNIT|APT|APARTMENT|SUITE|STE|FLOOR|LEVEL|BUILDING|BLDG|#)\s*[-#]?\s*\S+/i;
const isDestinationAddress=line=>destinationStreetRegex.test(line)||destinationPostalBoxRegex.test(line);

function explicitDestinationEvidence(text){
  const lines=String(text||"").replace(/\r/g,"").split("\n").map(x=>x.trim()).filter(Boolean);
  const to=/^(?:(?:ship|deliver)\s*to|recipient|consignee|to)\b\s*[:\-]?\s*(.*)$/i;
  if(lines.filter(line=>to.test(line)).length===1)return true;
  return lines.filter(line=>/^(?:(?:your\s+)?electr[\W_]*[o0]nic\s+needs|yen)\s*[\\/|:\-]/i.test(line)).length===1;
}

function destinationBlock(text){
  const lines=String(text||"").replace(/\r/g,"").split("\n").map(x=>x.trim()).filter(Boolean);
  const to=/^(?:(?:ship|deliver)\s*to|recipient|consignee|to)\b\s*[:\-]?\s*(.*)$/i;
  const from=/^(?:return(?:\s+(?:address|to))?|ship\s*from|shipper|sender|from|remit\s*to|bill\s*to)\b/i;
  const starts=lines.map((line,index)=>to.test(line)?index:-1).filter(index=>index>=0);
  if(starts.length===1){
    const start=starts[0], block=[];
    const inline=lines[start].match(to)[1];
    if(inline&&!/^(?:[\s\/|:\-]|destination|recipient|address|consignee|deliver(?:y)?)*$/i.test(inline))block.push(inline);
    for(let i=start+1;i<lines.length;i++){
      if(from.test(lines[i])||/^(?:tracking|package\s+tracking|order\s+reference|partner\s+order|in\s+hand\s+date|1Z[A-Z0-9]{16}\b)/i.test(lines[i]))break;
      block.push(lines[i]);
    }
    if(block.filter(isDestinationAddress).length>1||block.filter(line=>destinationCityZipRegex.test(line)).length>1)return "";
    return block.join("\n");
  }
  // Never infer a destination from an unmarked label containing sender evidence.
  if(starts.length||lines.some(line=>from.test(line)))return "";
  const streetIndexes=lines.map((line,index)=>isDestinationAddress(line)?index:-1).filter(index=>index>=0);
  if(streetIndexes.length>1||lines.filter(line=>destinationCityZipRegex.test(line)).length>1)return "";
  // Retain the established YEN/customer alias when it is the sole identity block.
  const aliases=lines.filter(line=>/^(?:(?:your\s+)?electr[\W_]*[o0]nic\s+needs|yen)\s*[\\/|:\-]/i.test(line));
  if(aliases.length===1)return lines.slice(lines.indexOf(aliases[0])).join("\n");
  // A single unmarked name/address may be displayed as tentative evidence only.
  // It is never enough to auto-select, save or notify a customer.
  if(streetIndexes.length===1){
    const streetIndex=streetIndexes[0];
    const nameIndex=streetIndex-1;
    const cityIndex=lines.findIndex((line,index)=>index>streetIndex&&index<=streetIndex+3&&destinationCityZipRegex.test(line));
    if(nameIndex>=0&&cityIndex>streetIndex&&cleanRecipientCandidate(lines[nameIndex])
      && lines.slice(streetIndex+1,cityIndex).every(line=>destinationUnitRegex.test(line))){
      const end=destinationUnitRegex.test(lines[cityIndex+1]||"")?cityIndex+2:cityIndex+1;
      return lines.slice(nameIndex,end).join("\n");
    }
  }
  return "";
}

function destinationIdentity(text){
  const block=destinationBlock(text);
  const names=[];
  for(const line of block.split("\n")){
    if(isDestinationAddress(line)||destinationUnitRegex.test(line)||destinationCityZipRegex.test(line)||/^\d|tracking|order\s+reference/i.test(line))break;
    if(line)names.push(line);
  }
  return names.join("\n");
}

function recipientAnalysis(text){
  const raw=destinationBlock(text);
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

  const firstLine=lines[0]||"";
  const firstName=!isDestinationAddress(firstLine)&&!destinationCityZipRegex.test(firstLine)&&!destinationUnitRegex.test(firstLine)
    ?cleanRecipientCandidate(firstLine):"";
  if(firstName)return {name:firstName,confidence:.95,reason:explicitDestinationEvidence(text)?"explicit-destination-block":"tentative-unmarked-address-block"};

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
    const identity=destinationIdentity(text);
    if(!identity)return null;
    const result=window.ParcelSnapKnownMatcher.matchDirectory(workspace.customers,identity);
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

function validatedTracking(value,carrier=""){
  const code=String(value||"").trim();
  if(/^1Z[A-Z0-9]{16}$/i.test(code))return code;
  if(carrier==="FedEx"&&/^(?:\d{12}|\d{15}|\d{20}|\d{22})$/.test(code))return code;
  if(carrier==="USPS"&&/^(?:\d{20}|\d{22}|[A-Z]{2}\d{9}US)$/i.test(code))return code;
  if(carrier==="Amazon"&&/^TBA\d{12,16}$/i.test(code))return code;
  return "";
}

function guessTracking(text){
  return trackingAnalysis(text).value;
}

function trackingAnalysis(text,barcode=""){
  const raw=String(text||""),carrier=guessCarrier(raw),candidates=new Map();
  const add=(value,labelled=false,decodedBarcode=false)=>{
    const code=String(value||"").trim();
    // A successfully decoded, typed TBA symbol is independent of OCR carrier text.
    // This does not promote raw OCR fragments or unfamiliar routing identifiers.
    const known=Boolean(validatedTracking(code,carrier))||(decodedBarcode&&/^TBA\d{12,16}$/i.test(code));
    // Unfamiliar formats require a printed tracking label or structured barcode key.
    // Keep them visibly unverified; a street/carrier word is never a tracking number.
    const plausible=labelled&&/^(?=.{6,40}$)(?=.*\d)[A-Z0-9]+(?:-[A-Z0-9]+)*$/i.test(code);
    if(known||plausible)candidates.set(code.toUpperCase(),{value:code,known});
  };
  for(const hit of raw.matchAll(/\b1Z[A-Z0-9]{16}\b/gi))add(hit[0]);
  const lines=raw.replace(/\r/g,"").split("\n").map(line=>line.trim()).filter(Boolean);
  for(let i=0;i<lines.length;i++){
    const hit=lines[i].match(/^(?:PACKAGE\s+)?TRACKING(?:\s+(?:CODE|NUMBER|NO\.?|#))?\s*[:\-]?\s*(.*)$/i);
    if(hit)add(hit[1]||lines[i+1]||"",true);
  }
  for(const payload of (Array.isArray(barcode)?barcode:[barcode])){
    const typed=payload&&typeof payload==="object"&&payload.decoded===true&&
      /^(?:data_?matrix|qr_?code|code_?128|code_?39|ean_?13|ean_?8|upc_?a|upc_?e|itf|codabar)$/i.test(payload.format||"");
    const decoded=typeof payload==="string"?payload.trim():typed&&typeof payload.rawValue==="string"?payload.rawValue.trim():"";
    if(!decoded||decoded.length>200)continue;
    add(decoded,false,typed);
    try{
      const url=new URL(decoded);
      add(url.searchParams.get("tracking")||url.searchParams.get("tracking_number"),true);
    }catch{}
    try{const value=JSON.parse(decoded);if(typeof value.tracking==="string")add(value.tracking,true);}catch{}
  }
  if(candidates.size>1)return {value:"",status:"CONFLICT",message:"Conflicting tracking codes — check the photo",candidates:[...candidates.values()].map(item=>item.value)};
  if(!candidates.size)return {value:"",status:"MISSING",message:"Tracking not read — enter it from the photo",candidates:[]};
  const result=[...candidates.values()][0];
  return {...result,status:result.known?"FORMAT_VALID":"UNVERIFIED_FORMAT",
    message:result.known?"Check tracking against the photo":"Unfamiliar tracking format — verify every character",candidates:[result.value]};
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
  const lines=destinationBlock(text).split("\n").map(x=>x.trim()).filter(Boolean);
  const start=lines.findIndex(isDestinationAddress);

  if(start<0)return "";
  const collected=[];
  for(let i=start;i<Math.min(lines.length,start+4);i++){
    if(/order reference|partner order|in hand date|tracking code/i.test(lines[i]))break;
    collected.push(lines[i]);
    if(destinationCityZipRegex.test(lines[i])){
      if(destinationUnitRegex.test(lines[i+1]||""))collected.push(lines[i+1]);
      break;
    }
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
  const maxSample=320;
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
      let tl={x:sx,y:sy},tr={x:sx,y:sy},bl={x:sx,y:sy},br={x:sx,y:sy};
      stack.push(seed);
      seen[seed]=1;

      while(stack.length){
        const p=stack.pop();
        const y=Math.floor(p/w),x=p-y*w;
        count++;
        if(x+y<tl.x+tl.y)tl={x,y};
        if(x-y>tr.x-tr.y)tr={x,y};
        if(x-y<bl.x-bl.y)bl={x,y};
        if(x+y>br.x+br.y)br={x,y};
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
        if(!best||score>best.score)best={minX,maxX,minY,maxY,score,tl,tr,bl,br};
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
  return {x:rx,y:ry,w:rw,h:rh,corners:[best.tl,best.tr,best.br,best.bl].map(p=>({x:p.x/w*img.width,y:p.y/h*img.height}))};
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

function flattenOcrLines(blocks){
  const out=[];
  for(const block of (blocks||[])){
    for(const paragraph of (block?.paragraphs||[])){
      for(const line of (paragraph?.lines||[])){
        const text=String(line?.text||"").trim();
        const b=line?.bbox;
        if(!text||!b)continue;
        out.push({
          text,
          bbox:{
            x0:Number(b.x0||0),
            y0:Number(b.y0||0),
            x1:Number(b.x1||0),
            y1:Number(b.y1||0)
          }
        });
      }
    }
  }
  return out.sort((a,b)=>a.bbox.y0-b.bbox.y0);
}

function recipientFocusRectFromLines(lines,source){
  if(!Array.isArray(lines)||!lines.length)return null;

  const street=/^\s*\d{3,6}\s+.*\b(?:NW|NE|SW|SE)?\s*(?:AVE|AVENUE|ST|STREET|RD|ROAD|BLVD|DR|DRIVE|LANE|LN|HWY|HIGHWAY)\b/i;
  const cityZip=/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i;

  let senderEndY=-1;
  for(let i=0;i<lines.length;i++){
    if(/return\s+address|^\s*(?:ship\s*from|sender|from)\b/i.test(lines[i].text)){
      senderEndY=lines[i].bbox.y1;
      for(let j=i+1;j<Math.min(lines.length,i+6);j++){
        senderEndY=Math.max(senderEndY,lines[j].bbox.y1);
        if(cityZip.test(lines[j].text))break;
      }
      break;
    }
  }

  const candidates=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(!street.test(line.text))continue;
    if(senderEndY>=0&&line.bbox.y0<=senderEndY+4)continue;

    const next=lines[i+1]?.text||"";
    const hasCityAfter=cityZip.test(next);
    candidates.push({line,index:i,score:(hasCityAfter?3:1)+line.bbox.y0/source.height});
  }

  if(!candidates.length)return null;
  candidates.sort((a,b)=>b.score-a.score);
  const chosen=candidates[0].line;

  const lineH=Math.max(16,chosen.bbox.y1-chosen.bbox.y0);
  const top=Math.max(0,Math.round(chosen.bbox.y0-lineH*2.4));
  const bottom=Math.min(source.height,Math.round(chosen.bbox.y0+lineH*.2));

  if(bottom-top<20)return null;

  return {
    x:0,
    y:top,
    w:source.width,
    h:bottom-top
  };
}

function cropCanvasRect(source,rect){
  if(!rect)return null;
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(rect.w));
  canvas.height=Math.max(1,Math.round(rect.h));
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="#fff";
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(
    source,
    rect.x,rect.y,rect.w,rect.h,
    0,0,canvas.width,canvas.height
  );
  return canvas;
}


function straightenLabelCanvas(img,rect){
  if(!rect?.corners)return drawImageRegionCanvas(img,rect,1500);
  const [tl,tr,br,bl]=rect.corners;
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const width=(distance(tl,tr)+distance(bl,br))/2;
  const height=(distance(tl,bl)+distance(tr,br))/2;
  // Reject collapsed/irregular components; retain original crop as fallback.
  if(width<100||height<100||width/height<.35||width/height>3.2)return drawImageRegionCanvas(img,rect,1500);
  const src=drawImageRegionCanvas(img,rect,1500);
  const points=[tl,tr,br,bl].map(p=>({x:(p.x-rect.x)*src.width/rect.w,y:(p.y-rect.y)*src.height/rect.h}));
  const output=document.createElement("canvas");
  const scale=Math.min(2,1100/Math.max(width,height));
  output.width=Math.round(width*scale);output.height=Math.round(height*scale);
  const source=src.getContext("2d",{willReadFrequently:true}).getImageData(0,0,src.width,src.height).data;
  const ctx=output.getContext("2d");const result=ctx.createImageData(output.width,output.height);
  const [a,b,c,d]=points;
  for(let y=0;y<output.height;y++){
    const v=y/(output.height-1);
    for(let x=0;x<output.width;x++){
      const u=x/(output.width-1);
      const sx=(1-v)*((1-u)*a.x+u*b.x)+v*((1-u)*d.x+u*c.x);
      const sy=(1-v)*((1-u)*a.y+u*b.y)+v*((1-u)*d.y+u*c.y);
      const ix=Math.max(0,Math.min(src.width-2,Math.floor(sx))),iy=Math.max(0,Math.min(src.height-2,Math.floor(sy)));
      const fx=Math.max(0,Math.min(1,sx-ix)),fy=Math.max(0,Math.min(1,sy-iy));
      const offset=(y*output.width+x)*4;
      for(let k=0;k<3;k++){
        const i=(iy*src.width+ix)*4+k;
        result.data[offset+k]=(1-fy)*((1-fx)*source[i]+fx*source[i+4])+fy*((1-fx)*source[i+src.width*4]+fx*source[i+src.width*4+4]);
      }
      result.data[offset+3]=255;
    }
  }
  ctx.putImageData(result,0,0);return output;
}

async function preparePackageImages(file){
  const original=await readFileDataUrl(file);
  const img=await loadImage(original);
  const labelRect=detectBrightLabelRegion(img);

  // Keep a higher-resolution crop for recovery, but make the blocking read small.
  const rawOcrCanvas=fitForOcr(drawImageRegionCanvas(img,labelRect,2400),1100,1500);
  const quickBase=fitForOcr(straightenLabelCanvas(img,labelRect),0,900);
  const ocrCanvas=prepareFastOcrCanvas(quickBase);

  return {
    preview:drawImageRegion(img,null,1600,.82),
    ocrCanvas,
    rawOcrCanvas,
    // Barcode evidence needs the whole photo, independent of an uncertain OCR crop.
    barcodeCanvas:drawImageRegionCanvas(img,null,3200),
    vision:drawImageRegion(img,labelRect||null,1600,.90),
    label_crop_used:Boolean(labelRect),
    crop_width:ocrCanvas.width,
    crop_height:ocrCanvas.height,
    raw_crop_width:rawOcrCanvas.width,
    raw_crop_height:rawOcrCanvas.height
  };
}

async function compressImage(file){
  const original=await readFileDataUrl(file);
  return await resizeDataUrl(original,1600,.82);
}

async function prepareBarcodeImage(file){
  const original=await readFileDataUrl(file);
  return drawImageRegionCanvas(await loadImage(original),null,3200);
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
  try{
    const target=typeof source==="string" ? await loadImage(source) : source;
    // Native implementations vary by browser and OS. Never request a format
    // the device does not support, because one unsupported format can reject all.
    const native=async()=>{
      const Detector=window.BarcodeDetector;
      if(typeof Detector!=="function")return [];
      try{
        const wanted=["data_matrix","qr_code","code_128","code_39","ean_13","ean_8","upc_a","upc_e","itf","codabar"];
        let detector;
        if(typeof Detector.getSupportedFormats==="function"){
          const supported=await Detector.getSupportedFormats();
          const formats=wanted.filter(format=>supported.includes(format));
          if(!formats.length)return [];
          detector=new Detector({formats});
        }else detector=new Detector();
        const codes=await detector.detect(target);
        return (codes||[]).map(code=>({rawValue:code.rawValue,format:code.format,decoded:true}));
      }catch{return [];}
    };
    const boundedNative=typeof window.BarcodeDetector!=="function"?Promise.resolve([]):new Promise(resolve=>{
      const timer=setTimeout(()=>resolve([]),2500);
      native().then(codes=>{clearTimeout(timer);resolve(codes);},()=>{clearTimeout(timer);resolve([]);});
    });
    // Run the local fallback even when native returns an unrelated routing code:
    // that must not hide another supported tracking symbol or a disagreement.
    const local=Promise.resolve().then(()=>window.ParcelSnapBarcode?.decode(target)||[]).catch(()=>[]);
    const batches=await Promise.all([boundedNative,local]);
    const unique=new Map();
    for(const code of batches.flat()){
      const rawValue=typeof code?.rawValue==="string"?code.rawValue.trim():"";
      if(code?.decoded===true&&rawValue.length>=6&&rawValue.length<=200){
        unique.set(rawValue+"\n"+code.format,{rawValue,format:code.format,decoded:true});
      }
    }
    return [...unique.values()];
  }catch{return [];}
}

function showInlineCustomer(candidate=""){
  $("receiveNewCustomer").classList.remove("hidden");
  if(candidate&&!$("receiveNewCustomerName").value)$("receiveNewCustomerName").value=candidate;
}

function hideInlineCustomer(){
  $("receiveNewCustomer").classList.add("hidden");
}

function decideCustomer(text){
  const customers=workspace?.customers||[];
  const identity=destinationIdentity(text);
  if(!identity)return {customer:null,status:"NEEDS_REVIEW",candidate:null,score:0,margin:0,evidence:null};
  const tentative=!explicitDestinationEvidence(text);
  if(window.ParcelSnapKnownMatcher&&customers.length){
    const r=window.ParcelSnapKnownMatcher.matchDirectory(customers,identity);
    if(tentative){
      return {
        customer:null,
        status:"NEEDS_REVIEW",
        candidate:r.customer||r.candidate||null,
        score:r.score||0,
        margin:r.margin||0,
        evidence:r.evidence||null
      };
    }
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
    if(m?.customer)return tentative
      ?{customer:null,status:"NEEDS_REVIEW",candidate:m.customer,score:m.score||0,margin:0,evidence:null,legacy:true}
      :{...m,status:"MATCHED",candidate:m.customer,legacy:true};
  }

  return {customer:null,status:tentative?"NEEDS_REVIEW":"NO_MATCH",candidate:null,score:0,margin:0,evidence:null};
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
  return !receiveInFlight&&!$("receiveLabelConfirmed")?.checked&&!$("receiveCustomer").value
    && (!$("receiveNewCustomerName").value.trim() || normText($("receiveNewCustomerName").value)===normText(intakeOcrName))
    && !$("receiveNewCustomerEmail").value.trim();
}

function applyRecoveredCustomer(recovered,combined){
  if(!recovered||!recovered.customer||!explicitDestinationEvidence(combined)||!canBackgroundReplaceCustomer())return false;

  intakeOcrText=combined;
  resetLabelConfirmation();
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
  $("processingDetail").textContent=(
    $("receiveTracking").value
      ?"Customer matched in background · tracking captured"
      :"Customer matched in background"
  )+intakeTimingSummary();
  $("processingBox").classList.add("bg-matched");
  renderLabelReadout();
  autoReceiveMatchedPhoto({read_token:intakeReadToken,match:recovered},null).catch(err=>console.warn("Recovered intake failed",err));
  return true;
}

async function runDeepRecovery(source,token,initialText,options={}){
  const editGeneration=options.editGeneration??intakeFieldEditGeneration;
  const slot=parcelSnapOcrSlots.recovery;
  const raw=options.raw||source;
  const skew=typeof options.skew==="number"?options.skew:estimateSkewDegrees(source);
  const straight=deskewCanvas(source,skew);
  const rawStraight=deskewCanvas(raw,skew);
  const lineSpace={
    width:Number(options.line_source_width||source.width),
    height:Number(options.line_source_height||source.height)
  };
  const quickRect=recipientFocusRectFromLines(options.lines||[],lineSpace);
  const recipientRect=quickRect?{
    x:quickRect.x*rawStraight.width/lineSpace.width,
    y:quickRect.y*rawStraight.height/lineSpace.height,
    w:quickRect.w*rawStraight.width/lineSpace.width,
    h:quickRect.h*rawStraight.height/lineSpace.height
  }:null;
  const recipientFocus=cropCanvasRect(rawStraight,recipientRect);

  const passes=[
    ...(recipientFocus?[{psm:"7",build:()=>fitForOcr(recipientFocus,700,1200)}]:[]),
    {psm:"6",build:()=>adaptiveBinarizeCanvas(rawStraight)},
    {psm:"11",build:()=>straight},
    {psm:"4",build:()=>adaptiveBinarizeCanvas(fitForOcr(scaleCanvas(rawStraight,1.5),0,2200))},
    {psm:"3",build:()=>raw},
    {psm:"6",build:()=>rotateCanvas(straight,-6)},
    {psm:"6",build:()=>rotateCanvas(straight,6)}
  ];

  let combined=initialText||"";

  for(const pass of passes){
    if(token!==intakeReadToken||editGeneration!==intakeFieldEditGeneration||!canBackgroundReplaceCustomer())return null;

    await new Promise(resolve=>setTimeout(resolve,0));

    let text="";
    try{
      text=await ocrWithSlot(slot,pass.build(),pass.psm);
    }catch(err){
      if(token!==intakeReadToken||editGeneration!==intakeFieldEditGeneration)return null;
      throw err;
    }

    if(token!==intakeReadToken||editGeneration!==intakeFieldEditGeneration)return null;
    if(!text)continue;

    combined+="\n"+text;

    let recovered=decideCustomer(text);
    if(!recovered.customer)recovered=decideCustomer(combined);

    if(recovered.customer){
      recordBackgroundRecoveryTiming(token,Number(options.started_at_ms||0));
      applyRecoveredCustomer(recovered,combined);
      return recovered;
    }
  }

  if(token===intakeReadToken&&editGeneration===intakeFieldEditGeneration){
    intakeOcrText=combined;
    intakeOcrName=intakeOcrName||extractNameCandidate(combined);
    renderLabelReadout();
    recordBackgroundRecoveryTiming(token,Number(options.started_at_ms||0));
    if(canBackgroundReplaceCustomer()&&intakeTimingSummary()){
      $("processingDetail").textContent+=intakeTimingSummary();
    }
  }
  return null;
}

async function readPackagePhoto(source,options={}){
  const token=options.readToken??++intakeReadToken;
  const editGeneration=options.editGeneration??intakeFieldEditGeneration;
  if(token!==intakeReadToken)return {superseded:true,read_token:token,match:null};
  const processing=$("processingBox");
  if(editGeneration===intakeFieldEditGeneration){
    intakeRecipientDisplay=null;
    intakeTrackingReview=null;
    intakeVisionWarnings=[];
    resetLabelConfirmation();
    $("processingText").textContent="Reading package…";
    $("processingDetail").textContent="";
    processing.classList.remove("hidden","bg-matched");
  }

  stopRecoveryOcr();
  const started=options.startedAt||performance.now();
  resetIntakeTiming(token,started);

  const ocrSource=await toCanvas(source);
  const rawSource=options.raw?await toCanvas(options.raw):ocrSource;

  const barcodeSource=options.barcode?await toCanvas(options.barcode):rawSource;
  const barcodePromise=detectBarcode(barcodeSource);

  const skew=estimateSkewDegrees(ocrSource);
  const fastImage=deskewCanvas(ocrSource,skew);

  const firstRead=await fastOcrRecognizeDetailed(fastImage);
  const merged=firstRead.text;
  const layoutLines=flattenOcrLines(firstRead.blocks);

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

  const barcode=await barcodePromise;
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
  if(editGeneration!==intakeFieldEditGeneration){
    intakeOcrText=merged;
    intakeVisionWarnings=["Reading finished after your edits. Check the extracted text; your choices were preserved."];
    renderLabelReadout();
    return {superseded:true,read_token:token,edit_generation:editGeneration,match:null,reason:"manual-edit"};
  }
  const trackingResult=trackingAnalysis(merged,barcode);
  const tracking=trackingResult.value;
  intakeTrackingReview=trackingResult;

  intakeOcrText=merged;
  intakeOcrName=decision.customer?.name||extractNameCandidate(merged)||"";
  intakeOcrAddress=guessRecipientAddress(merged)||"";

  $("receiveTracking").value=tracking||"";
  $("receiveTracking").dataset.needsReview=String(trackingResult.status!=="FORMAT_VALID");

  const carrier=guessCarrier(merged);
  if(carrier&&!$("receiveCarrier").value)$("receiveCarrier").value=carrier;

  const elapsed=Math.max(0,(performance.now()-started)/1000).toFixed(1);
  if(intakeTiming.read_token===token){
    intakeTiming.first_result_seconds=Number(elapsed);
  }
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
    $("receiveNewCustomerName").value=intakeOcrName;

    const suggestion=decision.candidate&&["REVIEW","AMBIGUOUS","NEEDS_REVIEW"].includes(decision.status)
      ?"Possible: "+decision.candidate.name+" — please confirm · "
      :(intakeOcrName?"Possible recipient — verify against the photo · ":"");

    $("processingText").textContent=intakeOcrName||"Name not clear";
    $("processingDetail").textContent=suggestion+(tracking
      ?"Email not listed · tracking captured · "+elapsed+"s"
      :"Email not listed · "+elapsed+"s");

    if(customers.length){
      runDeepRecovery(ocrSource,token,merged,{
        editGeneration,
        raw:rawSource,
        skew,
        lines:layoutLines,
        line_source_width:fastImage.width,
        line_source_height:fastImage.height,
        started_at_ms:started
      })
        .catch(err=>console.warn("Background OCR recovery failed",err));
    }
  }

  renderLabelReadout();
  if(trackingResult.status!=="FORMAT_VALID")$("processingDetail").textContent+=" · "+trackingResult.message;
  if(Number(elapsed)>=1)$("processingDetail").textContent+=" · 1-second target not met";

  return {
    read_token:token,
    edit_generation:editGeneration,
    match:decision.customer?decision:null,
    status:decision.status,
    tracking,
    tracking_status:trackingResult.status,
    candidate:intakeOcrName,
    suggestion:decision.customer?"":(decision.candidate?.name||""),
    carrier,
    address:intakeOcrAddress,
    elapsed_seconds:Number(elapsed),
    skew_degrees:skew,
    recovery_pending:!decision.customer&&customers.length>0,
    layout_line_count:layoutLines.length,
    timing:{...intakeTiming}
  };
}


function renderLabelReadout(){
  const raw=$("labelRawText");
  if(raw)raw.textContent=intakeOcrText||"No readable text found";
  const fields=$("labelFields");
  if(!fields)return;
  const customer=(workspace?.customers||[]).find(c=>c.id===$("receiveCustomer").value);
  const contact=displayArrivalContact("receive",customer);
  const tentative=intakeRecipientDisplay;
  const displayName=customer?.name||(tentative?.read_token===intakeReadToken
    && !$("receiveCustomer").value
    && $("receiveNewCustomerName").value.trim()===tentative.name
      ?tentative.name:intakeOcrName);
  fields.textContent=["Name: "+(displayName||"Name not clear"),
    "Address: "+(intakeOcrAddress||"Not read"),
    "Tracking: "+($("receiveTracking").value||"Not read")+
      (intakeTrackingReview&&intakeTrackingReview.status!=="FORMAT_VALID"?" — "+intakeTrackingReview.message:""),
    arrivalEmailDescription(contact),
    ...intakeVisionWarnings.map(warning=>"Review: "+warning)].join("\n");
  $("labelReadout").classList.remove("hidden");
  const addressInput=$("receiveAddress");
  if(addressInput)addressInput.value=(intakeOcrAddress||"").replace(/\s*[\r\n]+\s*/g,", ");
  if(confirmedArrivalReviews.receive)reviewedArrivalConfirmation("receive");
}

async function autoReceiveMatchedPhoto(local,vision){
  if(local?.read_token!==intakeReadToken||receiveInFlight)return;
  renderLabelReadout();
  $("receiveResult").textContent="Review the photo, recipient and tracking, then choose Receive Package. No automatic email was sent.";
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

async function api(body,expectedUserId=null){
  const {data:{session}}=await sb.auth.getSession();
  if(!session||expectedUserId!==null&&session.user?.id!==expectedUserId)throw new Error("Please sign in again.");
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
  if(signOutState==="PENDING"){
    $("authMessage").textContent="Sign-out is still pending. Please wait before signing in.";
    return;
  }
  if(signOutState==="FAILED"&&authMode!=="signin"){
    $("authMessage").textContent="Finish signing out, or choose Sign in to use your existing account.";
    return;
  }
  if(authActionInFlight)return;
  authActionInFlight=true;
  $("authButton").disabled=true;
  const email=$("email").value.trim();
  const password=$("password").value;
  $("authMessage").textContent="";
  try{
    if(authMode==="signin"){
      const {error}=await sb.auth.signInWithPassword({email,password});
      if(error)throw error;
      signOutState="IDLE";
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
    authActionInFlight=false;
    await boot();
  }catch(e){
    $("authMessage").textContent=e.message||String(e);
  }finally{
    authActionInFlight=false;
    $("authButton").disabled=signOutState==="PENDING";
  }
};

$("signOut").onclick=async()=>{
  if(signOutState==="PENDING")return;
  if(authActionInFlight){
    $("authMessage").textContent="Authentication is still pending. Please wait before signing out.";
    return;
  }
  signOutState="PENDING";
  workspaceLoadGeneration++;
  workspace=null;
  showOnly("loadingState");
  $("signOut").disabled=true;
  $("authButton").disabled=true;
  $("loadingState").innerHTML="<h2>Signing out…</h2><p>Your workspace stays locked while sign-out completes.</p>";
  const pendingNotice=setTimeout(()=>{
    if(signOutState!=="PENDING")return;
    $("loadingState").innerHTML="<h2>Sign-out is still pending</h2><p>The authentication request has not completed. This page keeps your workspace locked. Please wait; no second sign-out request has been sent.</p>";
    $("authMessage").textContent="Sign-out is still pending. The authentication request has not completed. Please wait before signing in.";
  },10000);
  try{
    const result=await sb.auth.signOut();
    if(result?.error!==null)throw new Error("Sign-out did not complete.");
    location.reload();
  }catch{
    signOutState="FAILED";
    $("loadingState").innerHTML="<h2>Sign-out could not finish</h2><p>This page keeps your workspace locked. Retry signing out when you are ready.</p><button id=\"retrySignOut\" type=\"button\" class=\"ghost wide\">Retry sign out</button>";
    $("retrySignOut").onclick=()=>$("signOut").onclick();
    $("authMessage").innerHTML="Sign-out could not finish. Retry signing out, or sign in to your existing account.<button id=\"retrySignOutAuth\" type=\"button\" class=\"ghost wide\">Retry sign out</button>";
    $("retrySignOutAuth").onclick=()=>$("signOut").onclick();
  }finally{
    clearTimeout(pendingNotice);
    if(signOutState==="FAILED"){$("signOut").disabled=false;$("authButton").disabled=false;}
  }
};

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
  if(signOutState!=="IDLE")return;
  const generation=++workspaceLoadGeneration;
  showOnly("loadingState");
  $("loadingState").innerHTML="<h2>Loading workspace…</h2>";
  try{
    const {data:{session:startedSession}}=await sb.auth.getSession();
    if(generation!==workspaceLoadGeneration)return;
    if(!startedSession?.user?.id)throw new Error("Please sign in again.");
    const previousCompany=workspace?.company?.id||null;
    const nextWorkspace=await api({action:"workspace"},startedSession.user.id);
    if(generation!==workspaceLoadGeneration)return;
    const {data:{session:currentSession}}=await sb.auth.getSession();
    if(generation!==workspaceLoadGeneration)return;
    if(!currentSession||currentSession.user?.id!==startedSession.user.id)throw new Error("Please sign in again.");
    workspace=nextWorkspace;
    if(previousCompany!==(workspace?.company?.id||null))clearArrivalEmailRecovery();
    if(workspace.state==="NO_COMPANY"){
      showOnly("onboardingState");
      if(workspace.onboarding?.company_name)$("onboardingCompany").value=workspace.onboarding.company_name;
      return;
    }
    if(workspace.state==="BUSINESS_SETUP_PREPAY"){
      businessSetupPrepay=true;
      businessSetupPreviewMode=false;
      prepareBusinessSetup(workspace);
      showOnly("businessSetupState");
      return;
    }
    if(workspace.state==="PAYMENT_REQUIRED"){
      businessSetupPrepay=false;
      showOnly("billingState");
      $("companyTitle").textContent=workspace.company?.name||workspace.company_name||"Parcel Snap";
      $("companyMeta").textContent=workspace.company?.role?"Role: "+workspace.company.role:"";
      $("billingStatus").textContent="Business setup saved · payment required to activate";
      $("payLink").href=workspace.payment_link;
      return;
    }
    if(workspace.state==="BUSINESS_SETUP_REQUIRED"){
      businessSetupPrepay=false;
      prepareBusinessSetup(workspace);
      showOnly("businessSetupState");
      return;
    }
    if(workspace.state==="ACTIVE"){
      businessSetupPrepay=false;
      renderWorkspace();
      showOnly("activeWorkspace");
      return;
    }
    throw new Error("Unknown workspace state.");
  }catch(e){
    if(generation!==workspaceLoadGeneration)return;
    workspace=null;
    $("loadingState").innerHTML="<h2>Workspace unavailable</h2><p>"+esc(e.message||String(e))+"</p><button id=\"retryWorkspace\" type=\"button\" class=\"ghost wide\">Retry workspace</button>";
    const retry=$("retryWorkspace");
    retry.onclick=async()=>{
      if(retry.disabled)return;
      retry.disabled=true;
      await loadWorkspace();
    };
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
  $("saveBusinessSetup").textContent=businessSetupPrepay
    ?"Save Business Setup & Continue to Payment"
    :"Build My Parcel Snap Workspace";
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
    }else if(businessSetupPrepay){
      const result=await api({
        action:"save_prepaid_business_profile",
        profile,
        locations:businessSetupLocations
      });
      $("businessSetupMessage").textContent="Business setup saved. Continue to payment to activate your tailored workspace.";
      $("companyTitle").textContent=result.company_name||profile.primary_business_name||"Parcel Snap";
      $("companyMeta").textContent="Business setup complete";
      $("billingStatus").textContent="Business setup saved · payment required to activate";
      $("payLink").href=result.payment_link;
      showOnly("billingState");
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
  businessSetupPrepay=false;
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
  $("packageList").innerHTML=rows.length?rows.map(p=>"<div class='item'><div class='itemTop'><div><strong>"+esc(p.customer_name||"Unmatched customer")+"</strong><br><small>"+esc(p.tracking_number||"No tracking number")+"</small></div><span class='status'>"+esc(p.stage)+"</span></div><div class='meta'><div><small>Payment</small><strong>"+esc(p.payment_status)+"</strong></div><div><small>Location</small><strong>"+esc(p.location_code||"-")+"</strong></div><div><small>Updated</small><strong>"+new Date(p.updated_at).toLocaleDateString()+"</strong></div></div>"+(p.origin_review_pending===true?"<button type='button' data-review-intake='"+esc(p.id)+"'>Resume saved review</button><small>Saved notice has not been sent. Fresh confirmation is required.</small>":"")+"</div>").join(""):"<div class='empty'>No packages found.</div>";
}
$("packageList").onclick=e=>{
  const button=e.target.closest?.("button[data-review-intake]");
  if(button)return resumeSavedIntake(button.dataset.reviewIntake);
};
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
  const typeOrder={ORIGIN:1,TRANSIT:2,DESTINATION:3};
  return [...items].sort((a,b)=>
    (typeOrder[a.facility_type]||50)-(typeOrder[b.facility_type]||50)||
    String(a.name||"").localeCompare(String(b.name||""))
  );
}

function renderReceiveControls(){
  const customers=workspace?.customers||[];
  const assignedFacilities=facilitySort((workspace?.facilities||[]).filter(f=>f.active!==false));
  const routeDestinations=facilitySort(
    (workspace?.route_destinations||assignedFacilities)
      .filter(f=>f.active!==false)
  );

  const currentCustomer=$("receiveCustomer").value;
  const currentOrigin=$("receiveOrigin").value;
  const currentDestination=$("receiveDestination").value;

  $("receiveCustomer").innerHTML='<option value="">New / unmatched customer</option>'+
    customers.map(c=>'<option value="'+c.id+'">'+esc(c.name)+(c.email?" — "+esc(c.email):"")+'</option>').join("");
  if(customers.some(c=>c.id===currentCustomer))$("receiveCustomer").value=currentCustomer;

  let origins=assignedFacilities.filter(f=>["ORIGIN","TRANSIT"].includes(f.facility_type));
  if(!origins.length)origins=assignedFacilities;

  let destinations=routeDestinations.filter(f=>["DESTINATION","TRANSIT"].includes(f.facility_type));
  if(!destinations.length)destinations=routeDestinations.filter(f=>!origins.some(o=>o.id===f.id));

  $("receiveOrigin").innerHTML=origins.map(f=>'<option value="'+f.id+'">'+esc(f.name)+'</option>').join("")||
    '<option value="">No receiving warehouse configured</option>';

  $("receiveDestination").innerHTML='<option value="">No next warehouse selected</option>'+
    destinations.map(f=>'<option value="'+f.id+'">'+esc(f.name)+'</option>').join("");

  if(origins.length){
    if(origins.some(f=>f.id===currentOrigin))$("receiveOrigin").value=currentOrigin;
    else $("receiveOrigin").value=origins[0].id;
  }

  if(destinations.length){
    if(destinations.some(f=>f.id===currentDestination))$("receiveDestination").value=currentDestination;
    else if(destinations.length===1)$("receiveDestination").value=destinations[0].id;
  }

  const originAuto=origins.length===1;
  const destinationAuto=destinations.length===1;

  $("receiveOriginWrap").classList.toggle("hidden",originAuto);
  $("receiveDestinationWrap").classList.toggle("hidden",destinationAuto);

  const originName=origins.find(f=>f.id===$("receiveOrigin").value)?.name||"";
  const destinationName=destinations.find(f=>f.id===$("receiveDestination").value)?.name||"";

  if(originAuto||destinationAuto){
    const parts=[];
    if(originName)parts.push("Receiving: "+originName);
    if(destinationName)parts.push("Next: "+destinationName);
    $("receiveRouteSummary").textContent=parts.join(" → ");
    $("receiveRouteSummary").classList.remove("hidden");
  }else{
    $("receiveRouteSummary").classList.add("hidden");
    $("receiveRouteSummary").textContent="";
  }

  if(!$("receiveCustomer").value)showInlineCustomer(intakeOcrName);
  else hideInlineCustomer();
  // A directory rerender changes the email shown in the selector; require new review.
  if(intakePhotoDataUrl)renderLabelReadout();else displayArrivalContact("receive",customers.find(c=>c.id===$("receiveCustomer").value));
}

$("receiveCustomer").onchange=()=>{
  markIntakeEdit();
  const customer=(workspace?.customers||[]).find(c=>c.id===$("receiveCustomer").value);
  if(customer){
    intakeRecipientDisplay=null;
    hideInlineCustomer();
    $("processingText").textContent=customer.name;
    $("processingDetail").textContent="Customer selected — verify against the photo";
  }else{
    showInlineCustomer(intakeOcrName);
    const name=$("receiveNewCustomerName").value.trim();
    intakeRecipientDisplay={name,read_token:intakeReadToken,source:"manual"};
    $("processingText").textContent=name||"Name not clear";
    $("processingDetail").textContent="Review customer before saving";
  }
  renderLabelReadout();
};

$("receiveNewCustomerName").oninput=()=>{
  markIntakeEdit();
  const name=$("receiveNewCustomerName").value.trim();
  intakeRecipientDisplay={name,read_token:intakeReadToken,source:"manual"};
  $("processingText").textContent=name||"Name not clear";
  $("processingDetail").textContent="Manually entered recipient — verify against the photo";
  renderLabelReadout();
};

$("receiveTracking").oninput=()=>{
  markIntakeEdit();
  intakeTrackingReview={status:"MANUAL",message:"Manually entered — verify against the photo"};
  renderLabelReadout();
};
$("receiveAddress").oninput=()=>{
  markIntakeEdit();
  intakeOcrAddress=$("receiveAddress").value;
  renderLabelReadout();
};
$("receiveCarrier").oninput=markIntakeEdit;
for(const id of ["receiveNewCustomerEmail","receiveNewCustomerPhone","receiveNewCustomerAlias"]){
  if($(id))$(id).oninput=markIntakeEdit;
}
for(const id of ["receiveOrigin","receiveDestination","receiveSize","receivePayment"]){
  $(id).onchange=markIntakeEdit;
}
$("receiveWeight").oninput=markIntakeEdit;
$("receiveLabelConfirmed").onchange=()=>{intakeFieldEditGeneration++;captureArrivalConfirmation("receive");};

$("packagePhoto").onchange=async e=>{
  const file=e.target.files?.[0];
  if(!file||receiveInFlight)return;
  clearInactivePhotoSource("packagePhoto","packagePhotoGallery",e.target);
  const token=++intakeReadToken;
  const editGeneration=intakeFieldEditGeneration;
  intakePackageId=crypto.randomUUID();
  intakePhotoDataUrl=null;
  $("packagePhotoPreview").innerHTML="";
  intakePhotoPending=true;
  intakeOcrText="";intakeOcrName="";intakeOcrAddress="";
  intakeRecipientDisplay=null;intakeTrackingReview=null;intakeVisionWarnings=[];
  for(const id of ["receiveCustomer","receiveTracking","receiveCarrier","receiveAddress","receiveNewCustomerName","receiveNewCustomerEmail","receiveNewCustomerPhone","receiveNewCustomerAlias"]){$(id).value="";}
  resetLabelConfirmation();
  $("receiveResult").textContent="";
  $("receiveNewCustomerEmail").value="";
  $("receiveNewCustomerPhone").value="";
  try{
    const [uploadImage,ocrImage,barcodeImage]=await Promise.all([
      compressImage(file),
      prepareOcrImage(file),
      prepareBarcodeImage(file)
    ]);
    if(token!==intakeReadToken)return;
    intakePhotoDataUrl=uploadImage;
    $("packagePhotoPreview").innerHTML='<img src="'+intakePhotoDataUrl+'" alt="Package photo">';
    const result=await readPackagePhoto(ocrImage,{barcode:barcodeImage,readToken:token,editGeneration});
    if(token!==intakeReadToken||result?.superseded)return;
    intakeOcrAddress=result.address||"";
  }catch(err){
    if(token!==intakeReadToken)return;
    console.error(err);
    $("processingBox").classList.remove("hidden");
    if(editGeneration===intakeFieldEditGeneration){
      $("processingText").textContent="New / unmatched customer";
      showInlineCustomer(intakeOcrName);
    }
    $("processingDetail").textContent="Enter customer name and email";
    if(!intakePhotoDataUrl)$("processingDetail").textContent="Could not open this image. Choose a JPG, PNG or WebP photo, or take another photo.";
  }finally{
    if(token===intakeReadToken)intakePhotoPending=false;
  }
};
bindPhotoSources("packagePhoto","packagePhotoGallery",()=>receiveInFlight);

async function createReceiveCustomer(){
  const token=intakeReadToken,editGeneration=intakeFieldEditGeneration;
  const name=$("receiveNewCustomerName").value.trim();
  const email=$("receiveNewCustomerEmail").value.trim();
  const phone=$("receiveNewCustomerPhone").value.trim();
  const labelAlias=$("receiveNewCustomerAlias")?.value.trim()||"";

  if(!name)throw new Error("Enter the customer name.");
  // A readable name is still saved when no customer email is listed.

  const aliases=[];
  if(labelAlias&&normText(labelAlias)!==normText(name)){
    aliases.push({alias:labelAlias,alias_type:"LABEL"});
  }

  const result=await api({
    action:"create_customer",
    name,
    email,
    phone,
    customer_type:"PERSON",
    aliases
  });

  const customer=result.customer;
  workspace.customers=workspace.customers||[];
  workspace.customers.push(customer);
  if(token===intakeReadToken&&editGeneration===intakeFieldEditGeneration){
    resetLabelConfirmation();
    renderReceiveControls();
    $("receiveCustomer").value=customer.id;
    hideInlineCustomer();
    renderLabelReadout();
  }
  return customer.id;
}

$("saveReceiveCustomer").onclick=async()=>{
  const token=intakeReadToken,editGeneration=intakeFieldEditGeneration;
  const name=$("receiveNewCustomerName").value.trim();
  const labelAlias=$("receiveNewCustomerAlias")?.value.trim();
  try{
    const customerId=await createReceiveCustomer();
    if(token!==intakeReadToken||editGeneration!==intakeFieldEditGeneration)return;
    resetLabelConfirmation();
    $("receiveCustomer").value=customerId;
    $("processingText").textContent=name||"Customer saved";
    $("processingDetail").textContent=labelAlias
      ?"Customer + label name saved for future automatic matching"
      :"Email saved for future package notices";
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

async function receivePackage(){
  if(receiveInFlight)return;
  const recoveryScope=arrivalEmailRecoveryScope();
  if(intakePhotoPending){alert("Wait for this photo to finish reading before receiving it.");return;}
  receiveInFlight=true;
  let customer_id=$("receiveCustomer").value;
  const origin_facility_id=$("receiveOrigin").value;

  if(!intakePhotoDataUrl){receiveInFlight=false;alert("Take or choose a package photo first.");return}
  if(!origin_facility_id){receiveInFlight=false;alert("Choose the receiving warehouse.");return}
  // Stop late OCR/vision from changing the identity while this reviewed snapshot is saved.
  stopRecoveryOcr();
  intakeReadToken++;
  if(intakeRecipientDisplay)intakeRecipientDisplay.read_token=intakeReadToken;

  // Snapshot the reviewed fields before any customer-creation or save request.
  const confirmedContact=reviewedArrivalConfirmation("receive");
  const reviewed={
    label_confirmed:Boolean(confirmedContact),
    confirmed_customer_contact_version:confirmedContact?.contact_version||null,
    destination_facility_id:$("receiveDestination").value||null,
    size_class:$("receiveSize").value,
    weight_lb:$("receiveWeight").value||null,
    payment_status:$("receivePayment").value,
    tracking_number:$("receiveTracking").value.trim()||null,
    carrier:$("receiveCarrier").value.trim()||null,
    photo_data_url:intakePhotoDataUrl,
    ocr_name:intakeOcrName||null,
    ocr_raw_text:intakeOcrText||null,
    ocr_recipient_address:intakeOcrAddress.trim()||null
  };

  $("receivePackageButton").disabled=true;
  $("packagePhoto").disabled=true;
  if($("packagePhotoGallery"))$("packagePhotoGallery").disabled=true;
  $("receiveResult").textContent="Saving package…";

  try{
    if(!customer_id){
      customer_id=await createReceiveCustomer();
    }

    const request={
      action:"receive_package",
      intake_package_id:intakePackageId||(intakePackageId=crypto.randomUUID()),
      customer_id,
      label_confirmed:reviewed.label_confirmed,
      confirmed_customer_id:reviewed.label_confirmed?customer_id:null,
      confirmed_customer_contact_version:reviewed.confirmed_customer_contact_version,
      origin_facility_id,
      destination_facility_id:reviewed.destination_facility_id,
      tracking_number:reviewed.tracking_number,
      carrier:reviewed.carrier,
      size_class:reviewed.size_class,
      weight_lb:reviewed.weight_lb,
      payment_status:reviewed.payment_status,
      ocr_name:reviewed.ocr_name,
      ocr_tracking:reviewed.tracking_number,
      ocr_raw_text:reviewed.ocr_raw_text,
      ocr_recipient_address:reviewed.ocr_recipient_address,
      photo_data_url:reviewed.photo_data_url
    };
    const r=await api(request);
    rememberArrivalEmailRecovery("receive",request,r,reviewed.tracking_number,recoveryScope);

    const emailStatus=r.email?.status||"SKIPPED";
    $("receiveResult").textContent=
      "Package received · "+(r.photo_saved?"photo saved":"photo needs review")+" · "+(emailStatus==="EMAIL_NOT_LISTED"?"Email not listed":"email "+emailStatus)+
      (r.assigned_location_id?" · location assigned":"")+
      intakeTimingSummary()+(r.email?.error?" · "+r.email.error:"");

    if(!r.photo_saved||["FAILED","UNKNOWN","SENDING","REVIEW_REQUIRED","EMAIL_NOT_LISTED","NOT_CONFIGURED"].includes(emailStatus)){
      $("receiveResult").textContent+=["UNKNOWN","SENDING"].includes(emailStatus)
        ?" · Delivery is uncertain. Do not retry until its status is checked."
        :" · Photo and fields kept for review; retry uses the same package.";
      if(r.photo_saved&&await refreshSavedArrivalLists(recoveryScope)===false)$("receiveResult").textContent+=" · Package list could not refresh; the saved result and review fields are retained.";
      return;
    }

    intakePhotoDataUrl=null;
    intakeOcrText="";
    intakeOcrName="";
    intakeRecipientDisplay=null;
    intakeTrackingReview=null;
    intakeVisionWarnings=[];
    resetLabelConfirmation();
    intakeOcrAddress="";
    $("packagePhoto").value="";
    if($("packagePhotoGallery"))$("packagePhotoGallery").value="";
    $("packagePhotoPreview").innerHTML="";
    $("processingBox").classList.add("hidden");
    $("labelReadout").classList.add("hidden");
    $("labelFields").textContent="";
    $("labelRawText").textContent="";
    $("receiveTracking").value="";
    $("receiveAddress").value="";
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
    $("packagePhoto").disabled=false;
    if($("packagePhotoGallery"))$("packagePhotoGallery").disabled=false;
    receiveInFlight=false;
  }
}
$("receivePackageButton").onclick=receivePackage;
$("receiveCheckEmailStatus").onclick=()=>checkArrivalEmailStatus("receive");


function renderTransferControls(){
  const facilities=facilitySort((workspace?.facilities||[]).filter(f=>f.active!==false));
  const packages=(workspace?.packages||[]).filter(p=>!["DELIVERED","PICKED_UP"].includes(p.stage));

  const currentFacility=$("transferFacility")?.value||"";
  const currentPackage=$("transferPackage")?.value||"";

  if($("transferFacility")){
    const choose=facilities.length>1?'<option value="">Choose arriving location</option>':"";
    $("transferFacility").innerHTML=choose+
      facilities.map(f=>'<option value="'+f.id+'">'+esc(f.name)+'</option>').join("")||
      '<option value="">No location configured</option>';

    if(facilities.some(f=>f.id===currentFacility)){
      $("transferFacility").value=currentFacility;
    }else if(facilities.length===1){
      $("transferFacility").value=facilities[0].id;
    }else{
      $("transferFacility").value="";
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
  renderTransferRecipient();
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
    return candidates;
  }

  if(customerId){
    candidates=active.filter(p=>String(p.customer_id||"")===String(customerId));
    if(candidates.length)return candidates;
  }

  return [];
}

async function analyzeTransferImage(dataUrl){
  const started=performance.now();
  const barcodePromise=detectBarcode(dataUrl);

  let merged=await fastOcrRecognize(dataUrl);
  const barcode=await barcodePromise;
  let trackingEvidence=trackingAnalysis(merged,barcode);
  let tracking=trackingEvidence.value;

  let m=decideCustomer(merged);

  if(!tracking&&m.status!=="MATCHED"){
    const enhanced=await enhanceForReading(dataUrl);
    const recovery=await fastOcrRecognize(enhanced);
    if(recovery)merged+="\n"+recovery;
    trackingEvidence=trackingAnalysis(merged,barcode);
    tracking=trackingEvidence.value;
    m=decideCustomer(merged);
  }

  return {
    tracking,
    tracking_status:trackingEvidence.status,
    text:merged,
    customer:m.customer||null,
    match:m,
    elapsed_seconds:Number(((performance.now()-started)/1000).toFixed(1))
  };
}

$("transferPhoto").onchange=async e=>{
  const file=e.target.files?.[0];
  if(!file||transferInFlight)return;
  clearInactivePhotoSource("transferPhoto","transferPhotoGallery",e.target);
  const generation=++transferPhotoGeneration;
  const editGeneration=transferFieldEditGeneration;
  transferPhotoPending=true;
  transferPhotoDataUrl=null;
  $("transferPhotoPreview").innerHTML="";
  resetTransferConfirmation();
  $("transferPackage").value="";
  renderTransferRecipient();

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
    if(generation!==transferPhotoGeneration)return;

    transferPhotoDataUrl=uploadImage;
    $("transferPhotoPreview").innerHTML='<img src="'+uploadImage+'" alt="Arrival package photo">';

    const result=await analyzeTransferImage(ocrImage);
    if(generation!==transferPhotoGeneration)return;
    if(editGeneration!==transferFieldEditGeneration){
      $("transferProcessingDetail").textContent="Reading finished after your edits. Your package selection was preserved; verify the photo before sending.";
      return;
    }
    const candidates=chooseTransferCandidates(result.tracking,result.customer?.id);

    $("transferPackage").innerHTML='<option value="">Select package</option>'+candidates.map(p=>{
      const ref=p.tracking_number||"No tracking";
      const who=p.customer_name||"Unknown customer";
      return '<option value="'+p.id+'">'+esc(who)+' — '+esc(ref)+' — '+esc(p.stage)+'</option>';
    }).join("");

    const strongEvidence=result.tracking_status==="FORMAT_VALID"||Boolean(result.customer);
    if(candidates.length===1&&strongEvidence)$("transferPackage").value=candidates[0].id;
    renderTransferRecipient();

    if(candidates.length===1){
      $("transferProcessingText").textContent=candidates[0].customer_name||"Package matched";
      $("transferProcessingDetail").textContent=strongEvidence
        ?"Possible package found — verify photo, tracking and customer before sending"
        :"Unverified tracking candidate — select and verify the package manually";
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
    if(generation!==transferPhotoGeneration)return;
    console.error(err);
    $("transferProcessingText").textContent="Could not identify package";
    $("transferProcessingDetail").textContent="Choose the package manually";
    renderTransferControls();
    if(!transferPhotoDataUrl)$("transferProcessingDetail").textContent="Could not open this image. Choose a JPG, PNG or WebP photo, or take another photo.";
  }finally{
    if(generation===transferPhotoGeneration)transferPhotoPending=false;
  }
};
bindPhotoSources("transferPhoto","transferPhotoGallery",()=>transferInFlight);

for(const id of ["transferPackage","transferFacility"]){
  $(id).onchange=()=>{
    transferFieldEditGeneration++;
    resetTransferConfirmation();
    const selected=(workspace?.packages||[]).find(item=>item.id===$("transferPackage").value);
    $("transferProcessingText").textContent=selected?.customer_name||"Choose the package";
    renderTransferRecipient();
  };
}
$("transferNote").oninput=()=>{transferFieldEditGeneration++;resetTransferConfirmation();};
$("transferLabelConfirmed").onchange=()=>{transferFieldEditGeneration++;captureArrivalConfirmation("transfer");};

$("saveTransfer").onclick=async()=>{
  if(transferInFlight)return;
  const recoveryScope=arrivalEmailRecoveryScope();
  if(transferPhotoPending){alert("Wait for this arrival photo to finish reading before saving it.");return;}
  const package_id=$("transferPackage").value;
  const facility_id=$("transferFacility").value;
  const selected=(workspace?.packages||[]).find(item=>item.id===package_id);

  if(!package_id){alert("Choose the package.");return}
  if(!facility_id){alert("Choose the arriving warehouse.");return}
  if(!transferPhotoDataUrl){alert("Take or choose an arrival photo first.");return}
  if(!selected){alert("Choose an existing package from this workspace.");return}
  const confirmedContact=reviewedArrivalConfirmation("transfer");
  const confirmed=Boolean(confirmedContact);
  const photo=transferPhotoDataUrl;
  const note=$("transferNote").value.trim()||null;
  transferInFlight=true;
  transferPhotoGeneration++;

  $("saveTransfer").disabled=true;
  $("transferResult").textContent="Saving arrival…";

  try{
    const request={
      action:"destination_arrival",
      package_id,
      facility_id,
      label_confirmed:confirmed,
      confirmed_customer_id:confirmed?selected.customer_id:null,
      confirmed_customer_contact_version:confirmedContact?.contact_version||null,
      confirmed_package_review_version:confirmedContact?.package_review_version||null,
      note,
      photo_data_url:photo
    };
    const r=await api(request);
    rememberArrivalEmailRecovery("transfer",request,r,selected.tracking_number,recoveryScope);

    const emailStatus=r.email?.status||"SKIPPED";
    $("transferResult").textContent=
      "Arrival saved · "+(r.photo_saved?"photo saved":"photo needs review")+" · email "+emailStatus+
      (r.assigned_location_id?" · location assigned":"")+(r.email?.error?" · "+r.email.error:"");
    if(!r.photo_saved||["FAILED","UNKNOWN","SENDING","REVIEW_REQUIRED","EMAIL_NOT_LISTED","NOT_CONFIGURED"].includes(emailStatus)){
      $("transferResult").textContent+=["UNKNOWN","SENDING"].includes(emailStatus)
        ?" · Delivery is uncertain. Do not retry until its status is checked."
        :" · Arrival photo and fields kept for review.";
      if(r.photo_saved&&await refreshSavedArrivalLists(recoveryScope)===false)$("transferResult").textContent+=" · Package list could not refresh; the saved result and review fields are retained.";
      return;
    }

    transferPhotoDataUrl=null;
    resetTransferConfirmation();
    $("transferPhoto").value="";
    if($("transferPhotoGallery"))$("transferPhotoGallery").value="";
    $("transferPhotoPreview").innerHTML="";
    $("transferProcessing").classList.add("hidden");
    $("transferNote").value="";

    await loadWorkspace();
    document.querySelector('[data-tab="transfer"]').click();
  }catch(e){
    $("transferResult").textContent=e.message||String(e);
  }finally{
    transferInFlight=false;
    $("saveTransfer").disabled=false;
  }
};

$("transferCheckEmailStatus").onclick=()=>checkArrivalEmailStatus("transfer");

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

sb.auth.onAuthStateChange((_event,session)=>{if(!session){
  clearArrivalEmailRecovery();
  $("authView").classList.remove("hidden");
  $("appView").classList.add("hidden");
  if(signOutState==="PENDING"){
    $("authMessage").textContent="Sign-out is still pending. Please wait before signing in.";
    $("authButton").disabled=true;
  }
}});
boot();
