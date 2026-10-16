(function (scope) {
  'use strict';
  // Authenticated read-only installation. Writes require a separate reviewed release.
  const BUILD = Object.freeze({id:'ps-high-volume-auto-20261016-01',writesEnabled:false,portalTransportEnabled:true,arrivalDeploymentId:'parcel-snap-arrival-review-20261012-v1'});
  const CONTRACT = Object.freeze({contract:'parcel-snap-arrival-review-v1',workspace:'read-only-snapshot-v1',
    confirmation:'customer-contact-revision-v1',idempotency:'durable-arrival-ledger-v1',
    photo:'private-sha256-attachment-v1',reconcile:'provider-get-no-resend-v1'});
  const ARRIVAL_ACTIONS = Object.freeze(['receive_package','destination_arrival']);
  const READ_ONLY_ACTIONS=Object.freeze(['arrival_capabilities','workspace_readonly']);
  const AUTO_MATCH_POLICY=Object.freeze({minScore:.97,minMargin:.08,reasons:Object.freeze(['exact-line','compact-exact'])});
  let lastAutoDirectoryDecision=null;
  const automaticAttempts=new Set();

  function assertPrivateAction(action){
    if(!BUILD.writesEnabled&&!READ_ONLY_ACTIONS.includes(action))throw new Error('Installation paused: changes, uploads and sends are disabled until billing and photo verification pass.');
  }
  function assertPortalTransport(){
    if(!BUILD.portalTransportEnabled)throw new Error('Installation paused: live portal access is disabled until a compatible read-only backend is separately verified and approved.');
  }
  function readCapabilityStatus(capability,{companyId=null,actorId}={}){
    if(typeof actorId!=='string'||!actorId.trim()||!capability||typeof capability!=='object'||Array.isArray(capability)||Object.entries(CONTRACT).some(([key,value])=>capability[key]!==value)||
      typeof capability.company_id!=='string'||!capability.company_id.trim()||capability.actor_id!==actorId||
      (companyId&&capability.company_id!==companyId)||capability.deployment_id!==BUILD.arrivalDeploymentId||
      !['PAUSED','ENABLED'].includes(capability.mode)||typeof capability.schema_ready!=='boolean')
      return {ready:false,reason:'A compatible scoped read-only backend capability is required.'};
    return {ready:true,reason:''};
  }
  function capabilityStatus(capability, {companyId,actorId} = {}) {
    if(!companyId||!actorId)return {ready:false,reason:'Sign in and open your company workspace first.'};
    if(!capability)return {ready:false,reason:'System connection is still being checked. Saving and sending remain blocked.'};
    if(typeof capability!=='object'||Array.isArray(capability)||Object.entries(CONTRACT).some(([key,value])=>capability[key]!==value))
      return {ready:false,reason:'The server does not support the reviewed arrival contract. Saving and sending are blocked.'};
    if(capability.company_id!==companyId||capability.actor_id!==actorId)
      return {ready:false,reason:'The arrival capability belongs to another workspace or account.'};
    if(capability.deployment_id!==BUILD.arrivalDeploymentId)
      return {ready:false,reason:'The arrival server release could not be verified.'};
    if(capability.schema_ready!==true)return {ready:false,reason:'The arrival safety schema is not verified. Saving and sending are blocked.'};
    if(capability.mode!=='ENABLED')return {ready:false,reason:'Arrival writes are paused on the server.'};
    return {ready:true,reason:''};
  }
  function arrivalGate(capability,identity) {
    const result=capabilityStatus(capability,identity);
    if(!result.ready)return result;
    return BUILD.writesEnabled?result:{ready:false,reason:'Installation paused: package saving, photo uploads and arrival emails are disabled.'};
  }
  function assertArrivalAction(action,capability,identity) {
    if(!ARRIVAL_ACTIONS.includes(action))return;
    const gate=arrivalGate(capability,identity);
    if(!gate.ready)throw new Error(gate.reason);
  }
  function scopedCustomers(workspace) {
    if(!workspace?.company?.id||!['OWNER','MANAGER','STAFF'].includes(workspace.company.role))return [];
    return (workspace.customers||[]).filter(c=>c&&typeof c.id==='string'&&
      (!c.company_id||c.company_id===workspace.company.id)&&c.status!=='INACTIVE');
  }
  function safeContact(customer,role) {
    const visible=['OWNER','MANAGER'].includes(role)&&customer?.contact_email_visible===true;
    return {id:customer?.id||null,name:String(customer?.name||''),email:visible?String(customer?.email||''):'',
      emailVisible:visible,contactVersion:typeof customer?.contact_version==='string'?customer.contact_version:null};
  }
  function validateProposalBinding(proposal,observation) {
    const p=proposal?.observation;
    return proposal?.schema==='parcel-snap-label-proposals-v1'&&proposal.reviewOnly===true&&
      !!p&&p.id===observation?.id&&p.photoId===observation.photoId&&
      p.photoSha256===observation.photoSha256&&p.rawResultSha256===observation.rawResultSha256;
  }
  function directoryProposals(workspace,block,matcher) {
    lastAutoDirectoryDecision=null;
    if(!block||!['DESTINATION','UNASSIGNED'].includes(block.role)||!block.name?.value||typeof matcher!=='function')return [];
    const customers=scopedCustomers(workspace);
    // Only this block's literal name is offered to the directory matcher. Return
    // addresses, tracking and other readings cannot become customer evidence.
    const result=matcher(customers,block.name.value);
    const best=result?.ranked?.[0]||null;
    const second=result?.ranked?.[1]||null;
    const score=Number(result?.score||best?.score||0),margin=Number(result?.margin??(best?.score||0)-(second?.score||0));
    const reason=String(result?.evidence?.reason||best?.evidence?.reason||'');
    const autoSafe=Boolean(result?.status==='MATCHED'&&result?.customer?.id&&best?.customer?.id===result.customer.id&&
      score>=AUTO_MATCH_POLICY.minScore&&(!second||margin>=AUTO_MATCH_POLICY.minMargin)&&AUTO_MATCH_POLICY.reasons.includes(reason));
    if(autoSafe){
      lastAutoDirectoryDecision=Object.freeze({autoSafe:true,customerId:result.customer.id,score,margin,reason,literalName:block.name.value,blockId:block.id});
    }
    return (result?.ranked||[]).slice(0,5).filter(item=>customers.some(c=>c.id===item.customer?.id)).map(item=>({
      customerId:item.customer.id,registered:safeContact(item.customer,workspace.company.role),
      literalName:block.name.value,blockId:block.id,requiresConfirmation:true,
      reason:String(item.evidence?.reason||'directory-suggestion'),score:Number(item.score||0),
      source:structuredClone(block.name.sources||[])
    }));
  }
  function autoDirectoryDecision(){return lastAutoDirectoryDecision?{...lastAutoDirectoryDecision}:null;}

  function parsePrintedCarrier(text){
    const match=String(text||'').match(/\b(UPS|FEDEX|USPS|DHL|AMAZON|ROADIE|CANADA\s+POST|ROYAL\s+MAIL)\b/i);
    if(!match)return '';
    return match[1].replace(/\s+/g,' ').toUpperCase().replace('FEDEX','FedEx').replace('AMAZON','Amazon').replace('ROADIE','Roadie').replace('CANADA POST','Canada Post').replace('ROYAL MAIL','Royal Mail');
  }
  function parsePrintedWeightLb(text){
    const lines=String(text||'').replace(/\r/g,'').split('\n').map(line=>line.trim()).filter(Boolean);
    for(const line of lines){
      const match=line.match(/\b(?:(?:ACTUAL|BILLABLE|PACKAGE|SHIP(?:PING)?)\s+)?(?:WEIGHT|WT)\b[^0-9]{0,14}(\d{1,4}(?:\.\d{1,2})?)\s*(LB|LBS|POUND|POUNDS|OZ|OUNCE|OUNCES|KG|KGS|KILOGRAM|KILOGRAMS)\b/i);
      if(!match)continue;
      const value=Number(match[1]);if(!Number.isFinite(value)||value<=0)return null;
      const unit=match[2].toUpperCase();
      const lb=unit.startsWith('OZ')||unit.startsWith('OUNCE')?value/16:unit.startsWith('KG')||unit.startsWith('KILOGRAM')?value*2.2046226218:value;
      if(!(lb>0&&lb<5000))return null;
      return Number(lb.toFixed(2));
    }
    return null;
  }
  function setInputValue(id,value,eventName='input'){
    const input=document.getElementById(id);if(!input||value===null||value===undefined||value==='')return false;
    input.value=String(value);input.dispatchEvent(new Event(eventName,{bubbles:true}));return true;
  }
  function setAutoStatus(message){const node=document.getElementById('receiveResult');if(node)node.textContent=message;}

  async function highVolumeAfterRead(){
    if(typeof document==='undefined')return;
    const status=document.getElementById('localPhotoStatus')?.textContent||'';
    if(/failed|canceled|could not/i.test(status))return;

    const recipientButtons=[...document.querySelectorAll('#localLabelBlocks [data-label-block]')];
    if(recipientButtons.length!==1){setAutoStatus('OCR finished, but the recipient block is not unique. Review this package before any email is sent.');return;}
    recipientButtons[0].click();

    const trackingButtons=[...document.querySelectorAll('#localLabelBlocks [data-use-tracking]')];
    if(trackingButtons.length===1)trackingButtons[0].click();

    const raw=document.getElementById('labelRawText')?.textContent||'';
    const carrier=parsePrintedCarrier(raw),weightLb=parsePrintedWeightLb(raw);
    if(carrier&&!document.getElementById('receiveCarrier')?.value)setInputValue('receiveCarrier',carrier);
    if(weightLb!==null&&!document.getElementById('receiveWeight')?.value)setInputValue('receiveWeight',weightLb);

    const decision=autoDirectoryDecision();
    if(!decision?.autoSafe){setAutoStatus('OCR filled the printed fields, but the saved customer match is not exact enough for automatic email. Review this package.');return;}
    if(typeof scope.chooseLocalDirectoryCustomer!=='function'){setAutoStatus('Exact customer match found, but automatic customer selection is unavailable. Review this package.');return;}
    scope.chooseLocalDirectoryCustomer(decision.customerId);

    const tracking=document.getElementById('receiveTracking')?.value?.trim()||'';
    const name=document.getElementById('receiveLabelName')?.value?.trim()||'';
    const address=document.getElementById('receiveAddress')?.value?.trim()||'';
    const customerId=document.getElementById('receiveCustomer')?.value||'';
    if(!tracking||!name||!address||customerId!==decision.customerId){
      setAutoStatus('Customer matched, but recipient/address/tracking is incomplete. Review this package before any email is sent.');return;
    }

    const frame=document.getElementById('localReaderFrame')?.src||'';
    const signature=[frame,tracking,customerId].join('|');
    if(automaticAttempts.has(signature))return;

    const confirmation=document.getElementById('receiveLabelConfirmed');
    if(confirmation){confirmation.checked=true;confirmation.dispatchEvent(new Event('change',{bubbles:true}));}

    const save=document.getElementById('receivePackageButton');
    if(BUILD.writesEnabled===true&&save&&!save.disabled&&typeof scope.receivePackage==='function'){
      automaticAttempts.add(signature);
      setAutoStatus('Exact customer matched. Saving package and sending the stored arrival email automatically…');
      await scope.receivePackage();
      return;
    }
    setAutoStatus('Exact customer matched and fields are ready. Automatic save/email is still held by the commercial release gate.');
  }

  function warmWhenWorkspaceOpens(){
    const workspace=document.getElementById('activeWorkspace');if(!workspace)return;
    let requested=false;
    const warm=()=>{
      if(requested||workspace.classList.contains('hidden')||typeof scope.getLocalIntakeReader!=='function')return;
      requested=true;
      Promise.resolve(scope.getLocalIntakeReader()).then(reader=>reader?.warm?.()).catch(()=>{requested=false;});
    };
    new MutationObserver(warm).observe(workspace,{attributes:true,attributeFilter:['class']});
    warm();
  }

  // Worker UX: selecting a camera/gallery photo immediately starts the existing
  // local reader. A completed, unique, exact directory match is prepared for
  // automatic receive/email; ambiguous evidence always stops for review.
  function installWorkerAutoFlow(){
    if(typeof document==='undefined')return;
    const camera=document.getElementById('packagePhoto');
    const gallery=document.getElementById('packagePhotoGallery');
    const read=document.getElementById('readLocalLabel');
    const readiness=document.getElementById('checkArrivalCapability');
    if(readiness){readiness.hidden=true;readiness.setAttribute('aria-hidden','true');readiness.tabIndex=-1;}
    if(!read||(!camera&&!gallery))return;

    const originalRead=read.onclick||scope.readLocalLabel;
    if(typeof originalRead==='function'){
      const wrappedRead=async event=>{const result=await originalRead.call(read,event);await highVolumeAfterRead();return result;};
      read.onclick=wrappedRead;scope.readLocalLabel=wrappedRead;
    }
    read.textContent='Retry label read';
    read.title='Automatic reading starts after you take or choose a photo. Use this only to retry.';

    let selectionGeneration=0;
    const scheduleAutoRead=event=>{
      if(!event?.target?.files?.[0])return;
      lastAutoDirectoryDecision=null;
      const generation=++selectionGeneration;
      const started=typeof performance!=='undefined'?performance.now():Date.now();
      const poll=()=>{
        if(generation!==selectionGeneration)return;
        if(!read.disabled){
          const status=document.getElementById('localPhotoStatus');
          if(status)status.textContent='Photo ready. Reading label automatically…';
          read.click();return;
        }
        const now=typeof performance!=='undefined'?performance.now():Date.now();
        if(now-started<30000)setTimeout(poll,40);
        else setAutoStatus('Photo opened, but OCR did not become ready. Use Retry label read.');
      };
      setTimeout(poll,0);
    };
    camera?.addEventListener('change',scheduleAutoRead);
    gallery?.addEventListener('change',scheduleAutoRead);
    warmWhenWorkspaceOpens();
  }

  scope.ParcelSnapIntakeReview=Object.freeze({BUILD,CONTRACT,ARRIVAL_ACTIONS,READ_ONLY_ACTIONS,AUTO_MATCH_POLICY,assertPrivateAction,assertPortalTransport,readCapabilityStatus,capabilityStatus,arrivalGate,assertArrivalAction,
    scopedCustomers,safeContact,validateProposalBinding,directoryProposals,autoDirectoryDecision,parsePrintedCarrier,parsePrintedWeightLb,highVolumeAfterRead});

  if(typeof document!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installWorkerAutoFlow,{once:true});
    else if(typeof queueMicrotask==='function')queueMicrotask(installWorkerAutoFlow);
    else setTimeout(installWorkerAutoFlow,0);
  }
})(typeof window!=='undefined'?window:globalThis);
