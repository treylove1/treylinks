// No credentials, timers, or automatic sends at module load. Every effect is injected.
// The database adapter below is the durable lock/claim boundary, not an in-process mutex.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PHOTO=10*1024*1024;
export function fail(message,status=400){throw Object.assign(new Error(message),{status});}
export async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
// PostgreSQL xmin changes on every customer-row update, even when updated_at
// is not maintained. Never hash the hidden email: that would expose a guessing
// oracle to roles that cannot see it. This scoped revision is not authorization.
export async function customerContactVersion(companyId,customer){
 if(typeof customer.contact_revision!=='string'||!customer.contact_revision)fail('Customer contact review is unavailable. Reload the customer details.',503);
 return sha256(new TextEncoder().encode(JSON.stringify(['parcel-snap-contact-v2',companyId,customer.id,customer.contact_revision])));
}
async function assertReviewedContact(body,companyId,customer){
 if(confirmation(body,customer.id)&&body.confirmed_customer_contact_version!==await customerContactVersion(companyId,customer))fail('Customer contact changed or was not reviewed. Reload the customer details and confirm again.',409);
}
// These identity fields are already shown in the package picker. Stage/location
// are intentionally excluded because preparing an arrival changes them itself.
export async function packageReviewVersion(companyId,p){return sha256(new TextEncoder().encode(JSON.stringify(['parcel-snap-package-review-v1',companyId,p.id,p.customer_id,String(p.tracking_number||'')])));}
async function assertReviewedPackage(c,p){
 if(c.kind==='destination'&&c.body.label_confirmed===true&&(!confirmation(c.body,p.customer_id)||c.body.confirmed_package_review_version!==await packageReviewVersion(c.companyId,p)))fail('Package details changed or were not reviewed. Reload the package details and confirm again.',409);
}
function b64(bytes){let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);}
function mimeOf(bytes){
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return 'image/png';
 if(String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP')return 'image/webp';
 return '';
}
export async function validatePhoto(dataUrl){
 if(typeof dataUrl!=='string'||dataUrl.length>Math.ceil(MAX_PHOTO*4/3)+100)fail('Photo is missing or exceeds 10 MiB.');
 const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
 if(!match)fail('A JPEG, PNG, or WebP package photo is required.');
 let bytes;try{bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));}catch{fail('Invalid photo encoding.');}
 if(!bytes.length||bytes.length>MAX_PHOTO||mimeOf(bytes)!==match[1])fail('Photo content does not match its image type.');
 return {bytes,mime:match[1],digest:await sha256(bytes),ext:match[1]==='image/jpeg'?'jpg':match[1].split('/')[1]};
}
export function notificationResult(status,error=null,extra={}){return {status,error,provider_id:null,retryable:false,...extra};}
function confirmation(body,customerId){return body.label_confirmed===true&&body.confirmed_customer_id===customerId;}
function same(a,b){return String(a??'')===String(b??'');}
const META_KEYS=['carrier','size_class','weight_lb','payment_status','ocr_name','ocr_raw_text','ocr_recipient_address'];
function packageMetadata(body,p={}){
 const result={};
 for(const key of META_KEYS){
  let value=Object.prototype.hasOwnProperty.call(body,key)?body[key]:p[key];
  if(key==='weight_lb'){
   value=value==null||value===''?null:Number(value);
   if(value!==null&&(!Number.isFinite(value)||value<0))fail('Package weight must be a nonnegative number.');
  }else if(key==='size_class'||key==='payment_status'){
   value=value||'UNKNOWN';
   const allowed=key==='size_class'?['UNKNOWN','SMALL','MEDIUM','LARGE','OVERSIZE']:['UNKNOWN','UNPAID','PARTIAL','PAID','WAIVED'];
   if(!allowed.includes(value))fail('Invalid package '+key+'.');
  }else{
   if(value!=null&&typeof value!=='string')fail('Package text fields must be text.');
   value=value||null;
   if(value&&value.length>(key==='ocr_raw_text'?20000:key==='ocr_recipient_address'?2000:200))fail('Package text field is too long.');
  }
  result[key]=value;
 }
 return result;
}
function metadataChanged(p,next){const old=packageMetadata({},p);return META_KEYS.some(key=>old[key]!==next[key]);}
function arrivalNote(body){if(body.note!=null&&(typeof body.note!=='string'||body.note.length>2000))fail('Arrival note must be text of at most 2000 characters.');return body.note||'Package arrival and private label photo saved';}
function emailEnabled(profile){return profile?.needs_customer_notifications===true&&Array.isArray(profile?.notification_channels)&&profile.notification_channels.includes('EMAIL');}

export function buildArrivalPayload(context){
 const place=String(context.facility.city||context.facility.name||'warehouse');
 const address=['address_line1','address_line2','city','region','postal_code','country'].map(k=>context.facility[k]).filter(Boolean).join(', ');
 return {from:'Parcel Snap <notifications@yourelectronicneeds.org>',to:[context.customer.email],
  subject:'Parcel Snap: Your package arrived in '+place,
  text:'Hello '+context.customer.name+',\n\nYour package has arrived at our '+place+' warehouse and has been logged in Parcel Snap.\n'+
   (address?'Warehouse: '+address+'\n':'')+'Tracking: '+(context.tracking||'Not recorded; please check the attached label')+'\n\n'+
   'The package label photo is attached.\n\n'+context.companyName+'\nPowered by Parcel Snap'};
}

async function ensurePrivatePhoto(storage,path,photo){
 // Deterministic, immutable content-addressed key. A retry may find an earlier upload.
 // A storage error is never assumed to mean "already exists": always verify the bytes.
 const result=await storage.upload(path,photo.bytes,{contentType:photo.mime,upsert:false});
 const downloaded=await storage.download(path);
 if(downloaded.error||!downloaded.data)fail(result.error?'Photo upload failed. Retry the same intake.':'Saved photo could not be verified.',503);
 const bytes=new Uint8Array(await downloaded.data.arrayBuffer());
 if(mimeOf(bytes)!==photo.mime||await sha256(bytes)!==photo.digest)fail('Saved photo integrity check failed.',409);
 return bytes;
}

async function attachmentFor(notice,context,storage,repo){
 if(!await repo.verifyPhoto(notice,context))fail('Saved photo or recipient ownership changed. No email sent.',409);
 if(!same(notice.company_id,context.companyId)||!same(notice.package_id,context.packageId)||
  !same(notice.customer_id,context.customer.id)||!same(notice.facility_id,context.facility.id)||
  notice.event_type!==context.eventType||notice.photo_sha256!==context.photo.digest||
  notice.photo_mime!==context.photo.mime||notice.photo_path!==context.photoPath)fail('Notification/photo ownership mismatch.',409);
 const downloaded=await storage.download(notice.photo_path);
 if(downloaded.error||!downloaded.data)fail('Saved label photo is unavailable. No email sent.',503);
 const bytes=new Uint8Array(await downloaded.data.arrayBuffer());
 if(bytes.length>MAX_PHOTO||mimeOf(bytes)!==notice.photo_mime||await sha256(bytes)!==notice.photo_sha256)fail('Saved label photo failed integrity check. No email sent.',409);
 return {filename:'parcel-label.'+context.photo.ext,content:b64(bytes),content_type:notice.photo_mime};
}

export async function reconcileNotice(notice,deps){
 // Read-only provider lookup; never POST again to resolve an uncertain attempt.
 if(!notice.provider_message_id)return notificationResult('UNKNOWN','Email outcome is uncertain. Inspect the provider record before any resend.');
 const key=await deps.secret('resend_api_key');
 if(!key)return notificationResult('UNKNOWN','Email status cannot be checked: email service is not configured.');
 let response,data;try{response=await deps.fetch('https://api.resend.com/emails/'+encodeURIComponent(notice.provider_message_id),{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});data=await response.json();}catch{return notificationResult('UNKNOWN','Provider status lookup failed. No resend attempted.');}
 const payload=notice.payload;
 if(!response.ok||data.id!==notice.provider_message_id||JSON.stringify(data.to)!==JSON.stringify(payload.to)||data.subject!==payload.subject||data.text!==payload.text||data.from!==payload.from||(data.cc||[]).length||(data.bcc||[]).length)return notificationResult('UNKNOWN','Provider record could not be matched to this exact notification.');
 await deps.repo.finish(notice,'SENT',data.id,null,data.last_event||null);
 return notificationResult('SENT',null,{provider_id:data.id,provider_event:data.last_event||null,reconciled:true});
}

export async function sendNotice(notice,context,deps){
 if(notice.status==='SENT')return notificationResult('SENT',null,{provider_id:notice.provider_message_id,duplicate:true});
 if(notice.status==='PENDING'&&Number(notice.attempt_count)>0)return notificationResult('UNKNOWN','This saved notification already records an email attempt. Check its status before any resend.');
 if(['SENDING','UNKNOWN'].includes(notice.status))return context.body.reconcile_notification===true?reconcileNotice(notice,deps):notificationResult('UNKNOWN','Email may already have been accepted. Check its status before resending.');
 if(!confirmation(context.body,context.customer.id))return notificationResult('REVIEW_REQUIRED','Confirm the photo, label details, and customer before sending.');
 await assertReviewedContact(context.body,context.companyId,context.customer);
 if(!emailEnabled(context.profile))return notificationResult('DISABLED');
 if(!context.customer.email)return notificationResult('EMAIL_NOT_LISTED');
 if(notice.payload.to[0]!==context.customer.email) return notificationResult('REVIEW_REQUIRED','Customer email changed after intake. Review the saved notification before sending.');
 const key=await deps.secret('resend_api_key');
 if(!key)return notificationResult('FAILED','Email service is not configured.',{retryable:true});
 let attachment;try{attachment=await attachmentFor(notice,context,deps.storage,deps.repo);}catch(error){return notificationResult('FAILED',error.message,{retryable:error.status===503});}
 const claim=await deps.repo.claim(notice,context.userId,context.customer.contact_revision,context.tracking);
 if(!claim)return notificationResult('UNKNOWN','The saved notification, customer contact, or sending preferences changed before this request could claim it. Check status and review before sending again.');
 let providerId=null;
 try{
  const response=await deps.fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'arrival/'+claim.id},body:JSON.stringify({...claim.payload,attachments:[attachment]})});
  const data=await response.json().catch(()=>null);
  if(response.ok&&typeof data?.id==='string'&&data.id){
   providerId=data.id;
   await deps.repo.finish(claim,'SENT',providerId,null,null);
   return notificationResult('SENT',null,{provider_id:providerId});
  }
  // A documented rejection can be explicitly retried with identical content.
  // 409, 5xx, transport errors, or a success without an ID remain uncertain.
  const rejected=[400,401,403,404,422,429].includes(response.status);
  const status=rejected?'FAILED':'UNKNOWN';
  const message=rejected?'Email provider rejected the request ('+response.status+').':'Email provider outcome is uncertain; check before resending.';
  await deps.repo.finish(claim,status,null,message,null);
  return notificationResult(status,message,{retryable:rejected});
 }catch{
  try{await deps.repo.finish(claim,'UNKNOWN',providerId,'Email outcome or status persistence is uncertain.',null);}catch{/* Durable SENDING claim remains a no-resend barrier. */}
  return notificationResult('UNKNOWN','Email outcome is uncertain. No automatic resend will occur.',{provider_id:providerId});
 }
}

export async function processArrival(input,deps){
 const {body,companyId,userId,kind}=input;
 const packageId=kind==='origin'?String(body.intake_package_id||'').toLowerCase():String(body.package_id||'').toLowerCase();
 const facilityId=String(kind==='origin'?body.origin_facility_id||'':body.facility_id||'').toLowerCase();
 if(!UUID.test(packageId)||!UUID.test(facilityId))fail('Valid package and warehouse identifiers are required.');
 const eventType=kind==='origin'?'ORIGIN_ARRIVAL':'FACILITY_ARRIVAL_'+facilityId;
 if(body.reconcile_notification===true){
  // A status check must never become a new intake. Use the immutable saved notice,
  // even when the contact email changed or the client no longer holds its photo.
  if(!await deps.canOperate(userId,companyId,input.role,facilityId))fail('You are not assigned to this warehouse.',403);
  const saved=await deps.repo.lookupForReconcile({companyId,packageId,facilityId,eventType});
  if(!saved)fail('Saved arrival notification not found.',404);
  const n=saved.notice;
  const email=n.status==='SENT'?notificationResult('SENT',null,{provider_id:n.provider_message_id,duplicate:true}):
   ['UNKNOWN','SENDING'].includes(n.status)?await reconcileNotice(n,deps):notificationResult(n.status==='PENDING'?(Number(n.attempt_count)===0?'REVIEW_REQUIRED':'UNKNOWN'):n.status,n.error_message);
  return {ok:true,package_id:packageId,stage:saved.stage,photo_saved:Boolean(n.photo_id),duplicate:true,email};
 }
 if(kind==='origin')packageMetadata(body);
 else arrivalNote(body);
 const photo=await validatePhoto(body.photo_data_url);
 // Preflight and schema check happen before any storage or database writes.
 const context=await deps.repo.context({...input,packageId,facilityId});
 if(!context.customer||!same(context.customer.company_id,companyId)||!context.facility||!same(context.facility.company_id,companyId))fail('Customer or warehouse not found in this company.',404);
 if(!await deps.canOperate(userId,companyId,input.role,facilityId))fail('You are not assigned to this warehouse.',403);
 await assertReviewedContact(body,companyId,context.customer);
 await assertReviewedPackage({...input,customer:context.customer},context.package);
 const eventDigest=(await sha256(new TextEncoder().encode(eventType))).slice(0,24);
 Object.assign(context,input,{packageId,facilityId,eventType,photo,photoPath:companyId+'/'+packageId+'/'+eventDigest+'-'+photo.digest+'.'+photo.ext});
 context.tracking=kind==='origin'?String(body.tracking_number||''):String(context.package.tracking_number||'');
 if((body.tracking_number!=null&&typeof body.tracking_number!=='string')||context.tracking.length>100)fail('Tracking must be text of at most 100 characters.');
 context.fingerprint=await sha256(new TextEncoder().encode(JSON.stringify([companyId,packageId,context.customer.id,facilityId,eventType,photo.digest,context.tracking,kind==='origin'?body.destination_facility_id||null:null,context.customer.email||''])));
 context.payload=buildArrivalPayload(context);
 // Existing events are checked before uploading to avoid accepting different photos on retry.
 await deps.repo.checkExisting(context);
 await deps.assertPrivateStorage();
 await ensurePrivatePhoto(deps.storage,context.photoPath,photo);
 const prepared=await deps.repo.prepare(context);
 const email=await sendNotice(prepared.notice,context,deps);
 return {ok:true,package_id:packageId,stage:prepared.stage,photo_saved:true,duplicate:prepared.duplicate,assigned_location_id:prepared.locationId||null,email};
}

function reviewEligible(saved){return saved&&saved.notice.status==='PENDING'&&Number(saved.notice.attempt_count)===0&&['ORIGIN_RECEIVED','MIAMI_RECEIVED','NEEDS_REVIEW'].includes(saved.package.stage)&&saved.package.current_facility_id===saved.package.origin_facility_id;}
export async function reviewSavedArrival(input,deps){
 if(!['OWNER','MANAGER','STAFF'].includes(input.role))fail('You do not have permission to review saved arrivals.',403);
 const packageId=String(input.body.package_id||'').toLowerCase(),facilityId=String(input.body.origin_facility_id||'').toLowerCase();
 if(!UUID.test(packageId)||!UUID.test(facilityId))fail('Valid saved package and origin warehouse identifiers are required.');
 if(!await deps.canOperate(input.userId,input.companyId,input.role,facilityId))fail('You are not assigned to this warehouse.',403);
 const saved=await deps.repo.lookupForReview({companyId:input.companyId,packageId,facilityId,eventType:'ORIGIN_ARRIVAL'});
 if(!saved)fail('Saved origin review not found in this company.',404);
 if(!reviewEligible(saved))fail('This saved arrival is no longer an editable origin review. Check its email status instead.',409);
 const n=saved.notice,p=saved.package;
 const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[n.photo_mime];
 if(!ext)fail('Saved photo type is invalid.',409);
 await deps.assertPrivateStorage();
 const context={companyId:input.companyId,packageId,customer:saved.customer,facility:saved.origin,facilityId,eventType:'ORIGIN_ARRIVAL',kind:'origin',tracking:String(p.tracking_number||''),fingerprint:n.fingerprint,photoPath:n.photo_path,photo:{digest:n.photo_sha256,mime:n.photo_mime,ext}};
 const attachment=await attachmentFor(n,context,deps.storage,deps.repo);
 if(!await deps.repo.reviewUnchanged(saved))fail('This saved arrival changed during review. Reload it before continuing.',409);
 return {ok:true,editable:true,snapshot:{intake_package_id:packageId,customer_id:p.customer_id,customer:{id:saved.customer.id,name:saved.customer.name,email:['OWNER','MANAGER'].includes(input.role)?saved.customer.email:null,contact_version:await customerContactVersion(input.companyId,saved.customer),contact_email_visible:['OWNER','MANAGER'].includes(input.role)},origin_facility_id:p.origin_facility_id,origin_facility:{id:saved.origin.id,name:saved.origin.name},destination_facility_id:p.destination_facility_id||null,destination_facility:saved.destination?{id:saved.destination.id,name:saved.destination.name}:null,tracking_number:p.tracking_number,carrier:p.carrier,size_class:p.size_class,weight_lb:p.weight_lb,payment_status:p.payment_status,ocr_name:p.ocr_name,ocr_raw_text:p.ocr_raw_text,ocr_recipient_address:p.ocr_recipient_address,photo_data_url:'data:'+n.photo_mime+';base64,'+attachment.content}};
}

export function createArrivalRepository(sql){
 const one=async(q,p=[],db=sql)=>(await db.unsafe(q,p))[0]||null;
 const findNotice=(c,db=sql,lock=false)=>one('select * from parcel_snap.arrival_notices where company_id=$1::uuid and package_id=$2::uuid and event_type=$3'+(lock?' for update':''),[c.companyId,c.packageId,c.eventType],db);
 const mutable=notice=>notice?.status==='PENDING'&&Number(notice.attempt_count)===0;
 const checkNotice=(notice,c)=>{if(notice&&notice.fingerprint!==c.fingerprint&&!mutable(notice))fail('This arrival already exists with different label details. Do not create another intake to retry it.',409);};
 async function checkPackage(c,db=sql,canEdit=false){
  const p=await one('select * from parcel_snap.packages where id=$1::uuid',[c.packageId],db);
  if(p&&!same(p.company_id,c.companyId))fail('Package not found in this company.',404);
  if(p&&(!same(p.origin_facility_id,c.facilityId)&&c.kind==='origin'||(!canEdit&&(!same(p.customer_id,c.customer.id)||(c.kind==='origin'&&(!same(p.tracking_number,c.tracking)||!same(p.destination_facility_id,c.body.destination_facility_id)))))))fail('Saved package differs from this intake. Review it before retrying.',409);
  return p;
 }
 return {
  async pendingOriginReviews(companyId,packageIds){
   const schema=await one("select to_regclass('parcel_snap.arrival_notices') is not null as ready");
   if(!schema?.ready||!packageIds.length)return [];
   return sql.unsafe("select n.package_id,n.facility_id from parcel_snap.arrival_notices n join parcel_snap.packages p on p.id=n.package_id and p.company_id=n.company_id and p.customer_id=n.customer_id where n.company_id=$1::uuid and n.package_id=any($2::uuid[]) and n.event_type='ORIGIN_ARRIVAL' and n.status='PENDING' and n.attempt_count=0 and p.origin_facility_id=n.facility_id and p.current_facility_id=p.origin_facility_id and p.stage in ('ORIGIN_RECEIVED','MIAMI_RECEIVED','NEEDS_REVIEW')",[companyId,packageIds]);
  },
  async lookupForReview(c){
   const schema=await one("select to_regclass('parcel_snap.arrival_notices') is not null as ready");
   if(!schema?.ready)fail('Arrival safety schema is not installed.',503);
   const notice=await findNotice(c);
   const p=await one('select p.*,p.xmin::text as review_revision from parcel_snap.packages p where p.id=$1::uuid and p.company_id=$2::uuid',[c.packageId,c.companyId]);
   if(!notice||!p||!same(notice.facility_id,c.facilityId)||!same(p.origin_facility_id,c.facilityId)||!same(notice.customer_id,p.customer_id))return null;
   const customer=await one('select id,company_id,name,email,xmin::text as contact_revision from parcel_snap.customers where id=$1::uuid and company_id=$2::uuid',[p.customer_id,c.companyId]);
   const origin=await one('select id,company_id,name from parcel_snap.facilities where id=$1::uuid and company_id=$2::uuid and active=true',[c.facilityId,c.companyId]);
   const destination=p.destination_facility_id?await one('select id,company_id,name from parcel_snap.facilities where id=$1::uuid and company_id=$2::uuid',[p.destination_facility_id,c.companyId]):null;
   if(!customer||!origin||p.destination_facility_id&&!destination)return null;
   return {notice,package:p,customer,origin,destination};
  },
  async reviewUnchanged(saved){
   const n=saved.notice,p=saved.package;
   return Boolean(await one("select n.id from parcel_snap.arrival_notices n join parcel_snap.packages p on p.id=n.package_id and p.company_id=n.company_id and p.customer_id=n.customer_id join parcel_snap.customers cu on cu.id=n.customer_id and cu.company_id=n.company_id where n.id=$1::uuid and n.company_id=$2::uuid and n.status='PENDING' and n.attempt_count=0 and n.fingerprint=$3 and n.photo_id=$4::uuid and p.xmin::text=$5 and cu.xmin::text=$6 and p.origin_facility_id=n.facility_id and p.current_facility_id=p.origin_facility_id and p.stage in ('ORIGIN_RECEIVED','MIAMI_RECEIVED','NEEDS_REVIEW')",[n.id,n.company_id,n.fingerprint,n.photo_id,p.review_revision,saved.customer.contact_revision]));
  },
  async lookupForReconcile(c){
   const notice=await findNotice(c);
   const p=await one('select * from parcel_snap.packages where id=$1::uuid',[c.packageId]);
   if(!notice||!p||!same(p.company_id,c.companyId)||!same(notice.facility_id,c.facilityId))return null;
   return {notice,stage:p.stage};
  },
  async context(c){
   const schema=await one("select to_regclass('parcel_snap.arrival_notices') is not null as ready");
   if(!schema?.ready)fail('Arrival safety schema is not installed. No intake or email was attempted.',503);
   const p=await one('select * from parcel_snap.packages where id=$1::uuid',[c.packageId]);
   if(p&&!same(p.company_id,c.companyId))fail('Package not found.',404);
   if(c.kind!=='origin'&&!p)fail('Package not found.',404);
   const customerId=c.kind==='origin'?String(c.body.customer_id||''):String(p.customer_id||'');
   if(!UUID.test(customerId))fail('A saved customer is required.');
   const customer=await one('select id,company_id,name,email,xmin::text as contact_revision from parcel_snap.customers where id=$1::uuid and company_id=$2::uuid',[customerId,c.companyId]);
   const facility=await one('select * from parcel_snap.facilities where id=$1::uuid and company_id=$2::uuid and active=true',[c.facilityId,c.companyId]);
   if(c.kind==='origin'&&c.body.destination_facility_id){
    if(!UUID.test(c.body.destination_facility_id)||!await one('select id from parcel_snap.facilities where id=$1::uuid and company_id=$2::uuid and active=true',[c.body.destination_facility_id,c.companyId]))fail('Destination warehouse not found in this company.',404);
   }
   const profile=await one('select needs_customer_notifications,notification_channels from parcel_snap.company_profiles where company_id=$1::uuid',[c.companyId]);
   const company=await one('select name from parcel_snap.companies where id=$1::uuid',[c.companyId]);
   return {customer,facility,profile,package:p,companyName:String(company?.name||'Parcel Snap')};
  },
  async checkExisting(c){const notice=await findNotice(c);checkNotice(notice,c);await checkPackage(c,sql,mutable(notice));},
  async prepare(c){
   return sql.begin(async tx=>{
    // All callers/processes serialize each package's DB changes on the same durable DB lock.
    await tx.unsafe('select pg_advisory_xact_lock(hashtextextended($1,0))',[c.companyId+'/'+c.packageId]);
    let notice=await findNotice(c,tx,true);checkNotice(notice,c);
    let p=await checkPackage(c,tx,mutable(notice));
    await assertReviewedPackage(c,p);
    const duplicate=Boolean(p&&notice);
    if(c.kind==='origin'&&mutable(notice)&&!reviewEligible({notice,package:p}))fail('This package has moved beyond origin review. No edits were saved.',409);
    // Recheck customer/facility tenancy inside the transaction before linking the photo.
    const owner=await one('select id,email,xmin::text as contact_revision from parcel_snap.customers where id=$1::uuid and company_id=$2::uuid',[c.customer.id,c.companyId],tx);
    const facility=await one('select id from parcel_snap.facilities where id=$1::uuid and company_id=$2::uuid and active=true',[c.facilityId,c.companyId],tx);
    if(!owner||!facility||!same(owner.email,c.customer.email))fail('Customer or warehouse changed. Review this intake again.',409);
    await assertReviewedContact(c.body,c.companyId,owner);
    if(c.kind==='origin'&&notice){
     const metadata=packageMetadata(c.body,p);
     if(metadataChanged(p,metadata)){
      if(!mutable(notice))fail('Saved package details are frozen after an email attempt. No edits were saved.',409);
      p=await one('update parcel_snap.packages set carrier=$1,size_class=$2,weight_lb=$3,payment_status=$4,ocr_name=$5,ocr_raw_text=$6,ocr_recipient_address=$7,updated_at=now() where id=$8::uuid and company_id=$9::uuid returning *',[metadata.carrier,metadata.size_class,metadata.weight_lb,metadata.payment_status,metadata.ocr_name,metadata.ocr_raw_text,metadata.ocr_recipient_address,c.packageId,c.companyId],tx);
     }
    }
    if(c.kind==='destination'&&notice&&Object.prototype.hasOwnProperty.call(c.body,'note')){
     const savedNote=await one("select note from parcel_snap.package_events where package_id=$1::uuid and event_type='DESTINATION_RECEIVED' and site in ($2,$3) order by created_at desc,id desc limit 1",[c.packageId,String(c.facility.city||c.facility.name),String(c.facility.name)],tx);
     if(!savedNote||savedNote.note!==arrivalNote(c.body))fail('This arrival note is already saved. Retry without changing it.',409);
    }
    if(notice&&notice.fingerprint===c.fingerprint)return {notice,duplicate:true,stage:p.stage,locationId:p.current_location_id};
    if(notice){
     if(c.kind==='origin')await tx.unsafe('update parcel_snap.packages set customer_id=$1::uuid,tracking_number=$2,ocr_tracking=$2,destination_facility_id=$3::uuid,updated_at=now() where id=$4::uuid and company_id=$5::uuid',[c.customer.id,c.tracking||null,c.body.destination_facility_id||null,c.packageId,c.companyId]);
     const photo=await one('insert into parcel_snap.package_photos(company_id,package_id,facility_id,kind,storage_path,mime_type) values ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6) returning id',[c.companyId,c.packageId,c.facilityId,c.kind==='origin'?'ARRIVAL':'DESTINATION',c.photoPath,c.photo.mime],tx);
     if(c.kind==='origin')await tx.unsafe('update parcel_snap.packages set source_photo_url=$1 where id=$2::uuid and company_id=$3::uuid',[c.photoPath,c.packageId,c.companyId]);
     notice=await one('update parcel_snap.arrival_notices set customer_id=$2::uuid,photo_id=$3::uuid,photo_path=$4,photo_mime=$5,photo_sha256=$6,fingerprint=$7,payload=$8::jsonb,updated_at=now() where id=$1::uuid and status=\'PENDING\' and attempt_count=0 returning *',[notice.id,c.customer.id,photo.id,c.photoPath,c.photo.mime,c.photo.digest,c.fingerprint,JSON.stringify(c.payload)],tx);
     if(!notice)fail('This notification has already been claimed. Review before changing it.',409);
     return {notice,duplicate:true,stage:p.stage,locationId:p.current_location_id};
    }
    const legacy=await one("select status,provider_message_id from parcel_snap.notifications where package_id=$1::uuid and event_type=$2 order by sent_at desc nulls last limit 1",[c.packageId,c.eventType],tx);
    const legacyDestination=c.kind==='destination'?await one("select exists(select 1 from parcel_snap.package_photos where company_id=$1::uuid and package_id=$2::uuid and facility_id=$3::uuid and kind='DESTINATION') or exists(select 1 from parcel_snap.package_events where package_id=$2::uuid and event_type='DESTINATION_RECEIVED' and site in ($4,$5)) as seen",[c.companyId,c.packageId,c.facilityId,String(c.facility.city||c.facility.name),String(c.facility.name)],tx):null;
    const legacyUncertain=Boolean(legacy||legacyDestination?.seen||(c.kind==='origin'&&p)||(c.kind==='destination'&&p?.stage==='DESTINATION_RECEIVED'&&same(p.current_facility_id,c.facilityId)));
    if(!p){
     const metadata=packageMetadata(c.body);
     p=await one("insert into parcel_snap.packages(id,company_id,customer_id,tracking_number,carrier,size_class,weight_lb,payment_status,stage,origin_facility_id,destination_facility_id,current_facility_id,origin_received_at,last_arrived_at,ocr_name,ocr_tracking,ocr_raw_text,ocr_recipient_address,updated_at) values ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,'ORIGIN_RECEIVED',$9::uuid,$10::uuid,$9::uuid,now(),now(),$11,$4,$12,$13,now()) returning *",[c.packageId,c.companyId,c.customer.id,c.tracking||null,metadata.carrier,metadata.size_class,metadata.weight_lb,metadata.payment_status,c.facilityId,c.body.destination_facility_id||null,metadata.ocr_name,metadata.ocr_raw_text,metadata.ocr_recipient_address],tx);
    }
    const photo=await one('insert into parcel_snap.package_photos(company_id,package_id,facility_id,kind,storage_path,mime_type) values ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6) returning id',[c.companyId,c.packageId,c.facilityId,c.kind==='origin'?'ARRIVAL':'DESTINATION',c.photoPath,c.photo.mime],tx);
    if(c.kind==='origin')await tx.unsafe('update parcel_snap.packages set source_photo_url=$1 where id=$2::uuid and company_id=$3::uuid',[c.photoPath,c.packageId,c.companyId]);
    else {await tx.unsafe("update parcel_snap.packages set destination_facility_id=$1::uuid,current_facility_id=$1::uuid,stage='DESTINATION_RECEIVED',last_arrived_at=now(),updated_at=now() where id=$2::uuid and company_id=$3::uuid",[c.facilityId,c.packageId,c.companyId]);p.stage='DESTINATION_RECEIVED';}
    await tx.unsafe('insert into parcel_snap.package_events(package_id,event_type,site,note,actor_label) values ($1::uuid,$2,$3,$4,$5)',[c.packageId,c.kind==='origin'?'ORIGIN_RECEIVED':'DESTINATION_RECEIVED',String(c.facility.city||c.facility.name),arrivalNote(c.body),c.actor||'PORTAL_USER']);
    await one('select parcel_snap.assign_suggested_location($1::uuid,$2) as location_id',[c.packageId,c.actor||'PORTAL_USER'],tx);
    const legacyAccepted=legacy&&['SENT','DELIVERED','BOUNCED'].includes(legacy.status);
    notice=await one("insert into parcel_snap.arrival_notices(company_id,package_id,customer_id,facility_id,event_type,photo_id,photo_path,photo_mime,photo_sha256,fingerprint,payload,status,provider_message_id,error_message) values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7,$8,$9,$10,$11::jsonb,$12,$13,$14) returning *",[c.companyId,c.packageId,c.customer.id,c.facilityId,c.eventType,photo.id,c.photoPath,c.photo.mime,c.photo.digest,c.fingerprint,JSON.stringify(c.payload),legacyAccepted?'SENT':legacyUncertain?'UNKNOWN':'PENDING',legacy?.provider_message_id||null,legacyUncertain?'Legacy intake requires provider reconciliation before a new send.':null],tx);
    // Location assignment can also advance DESTINATION_RECEIVED to WAREHOUSED.
    // Read the committed-to-be row in this same transaction rather than the stale insert/update snapshot.
    const finalPackage=await one('select stage,current_location_id from parcel_snap.packages where id=$1::uuid and company_id=$2::uuid',[c.packageId,c.companyId],tx);
    if(!finalPackage)fail('Saved package could not be verified.',409);
    return {notice,duplicate,stage:finalPackage.stage,locationId:finalPackage.current_location_id};
   });
  },
  async verifyPhoto(notice,c){
   const found=await one('select n.id from parcel_snap.arrival_notices n join parcel_snap.package_photos ph on ph.id=n.photo_id and ph.company_id=n.company_id and ph.package_id=n.package_id and ph.facility_id=n.facility_id join parcel_snap.packages p on p.id=n.package_id and p.company_id=n.company_id and p.customer_id=n.customer_id join parcel_snap.customers cu on cu.id=n.customer_id and cu.company_id=n.company_id where n.id=$1::uuid and n.company_id=$2::uuid and n.package_id=$3::uuid and n.customer_id=$4::uuid and n.facility_id=$5::uuid and n.event_type=$6 and n.fingerprint=$7 and ph.storage_path=n.photo_path and ph.mime_type=n.photo_mime and ph.kind=$8 and cu.email is not distinct from $9 and cu.xmin::text=$10 and coalesce(p.tracking_number,\'\')=$11',[notice.id,c.companyId,c.packageId,c.customer.id,c.facilityId,c.eventType,c.fingerprint,c.kind==='origin'?'ARRIVAL':'DESTINATION',c.customer.email,c.customer.contact_revision,c.tracking]);
   return Boolean(found);
  },
  async claim(notice,userId,contactRevision,tracking){
   if(typeof contactRevision!=='string'||!contactRevision||typeof tracking!=='string')return null;
   const token=crypto.randomUUID();
   // The atomic claim is the authorization point. Subsequent contact changes
   // cannot redirect this attempt: only this returned frozen payload is sent.
   return one("update parcel_snap.arrival_notices set status='SENDING',claim_token=$2::uuid,confirmed_by=$3::uuid,confirmed_at=now(),started_at=now(),attempt_count=attempt_count+1,updated_at=now() where id=$1::uuid and fingerprint=$4 and status in ('PENDING','FAILED') and (status<>'PENDING' or attempt_count=0) and exists(select 1 from parcel_snap.company_profiles cp where cp.company_id=arrival_notices.company_id and cp.needs_customer_notifications=true and 'EMAIL'=any(cp.notification_channels)) and exists(select 1 from parcel_snap.customers cu where cu.id=arrival_notices.customer_id and cu.company_id=arrival_notices.company_id and cu.email=(arrival_notices.payload->'to'->>0) and cu.xmin::text=$5) and exists(select 1 from parcel_snap.packages p where p.id=arrival_notices.package_id and p.company_id=arrival_notices.company_id and p.customer_id=arrival_notices.customer_id and coalesce(p.tracking_number,'')=$6) returning *",[notice.id,token,userId,notice.fingerprint,contactRevision,tracking]);
  },
  async finish(notice,status,providerId,error,event){
   const row=await one('update parcel_snap.arrival_notices set status=$2,provider_message_id=coalesce($3,provider_message_id),error_message=$4,provider_event=$5,updated_at=now() where id=$1::uuid and claim_token is not distinct from $6::uuid returning id',[notice.id,status,providerId,error,event,notice.claim_token||null]);
   if(!row)throw new Error('Notification claim changed; no status overwrite allowed.');
  }
 };
}
