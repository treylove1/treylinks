(function (scope) {
  'use strict';
  // Authenticated read-only installation. Writes require a separate reviewed release.
  const BUILD = Object.freeze({id:'ps-readonly-review-20261012-04',writesEnabled:false,portalTransportEnabled:true,arrivalDeploymentId:'parcel-snap-arrival-review-20261012-v1'});
  const CONTRACT = Object.freeze({contract:'parcel-snap-arrival-review-v1',workspace:'read-only-snapshot-v1',
    confirmation:'customer-contact-revision-v1',idempotency:'durable-arrival-ledger-v1',
    photo:'private-sha256-attachment-v1',reconcile:'provider-get-no-resend-v1'});
  const ARRIVAL_ACTIONS = Object.freeze(['receive_package','destination_arrival']);
  const READ_ONLY_ACTIONS=Object.freeze(['arrival_capabilities','workspace_readonly']);
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
    if(!block||!['DESTINATION','UNASSIGNED'].includes(block.role)||!block.name?.value||typeof matcher!=='function')return [];
    const customers=scopedCustomers(workspace);
    // Only this block's literal name is offered to the directory matcher. Return
    // addresses, tracking and other readings cannot become customer evidence.
    const result=matcher(customers,block.name.value);
    return (result?.ranked||[]).slice(0,5).filter(item=>customers.some(c=>c.id===item.customer?.id)).map(item=>({
      customerId:item.customer.id,registered:safeContact(item.customer,workspace.company.role),
      literalName:block.name.value,blockId:block.id,requiresConfirmation:true,
      reason:String(item.evidence?.reason||'directory-suggestion'),
      source:structuredClone(block.name.sources||[])
    }));
  }

  // Worker UX: selecting a camera/gallery photo should immediately start the
  // existing local reader. The normal employee should not need a separate
  // "Read label" or "Check backend readiness" step. The manual read control is
  // retained only as a retry fallback, and package save/email gates are unchanged.
  function installWorkerAutoFlow(){
    if(typeof document==='undefined')return;
    const camera=document.getElementById('packagePhoto');
    const gallery=document.getElementById('packagePhotoGallery');
    const read=document.getElementById('readLocalLabel');
    const readiness=document.getElementById('checkArrivalCapability');
    if(readiness){
      readiness.hidden=true;
      readiness.setAttribute('aria-hidden','true');
      readiness.tabIndex=-1;
    }
    if(read){
      read.textContent='Retry label read';
      read.title='Automatic reading starts after you take or choose a photo. Use this only to retry.';
    }
    if(!read||(!camera&&!gallery))return;
    let selectionGeneration=0;
    const scheduleAutoRead=event=>{
      if(!event?.target?.files?.[0])return;
      const generation=++selectionGeneration;
      const started=typeof performance!=='undefined'?performance.now():Date.now();
      const poll=()=>{
        if(generation!==selectionGeneration)return;
        if(!read.disabled){
          const status=document.getElementById('localPhotoStatus');
          if(status)status.textContent='Photo ready. Reading label automatically…';
          read.click();
          return;
        }
        const now=typeof performance!=='undefined'?performance.now():Date.now();
        if(now-started<30000)setTimeout(poll,40);
      };
      setTimeout(poll,0);
    };
    camera?.addEventListener('change',scheduleAutoRead);
    gallery?.addEventListener('change',scheduleAutoRead);
  }

  scope.ParcelSnapIntakeReview=Object.freeze({BUILD,CONTRACT,ARRIVAL_ACTIONS,READ_ONLY_ACTIONS,assertPrivateAction,assertPortalTransport,readCapabilityStatus,capabilityStatus,arrivalGate,assertArrivalAction,
    scopedCustomers,safeContact,validateProposalBinding,directoryProposals});

  if(typeof document!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installWorkerAutoFlow,{once:true});
    else if(typeof queueMicrotask==='function')queueMicrotask(installWorkerAutoFlow);
    else setTimeout(installWorkerAutoFlow,0);
  }
})(typeof window!=='undefined'?window:globalThis);
