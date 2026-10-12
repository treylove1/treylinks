/* Transport-only safety layer. App photo, OCR, recognition and review handlers are not replaced. */
(() => {
  'use strict';
  const policy=globalThis.ParcelSnapPreviewPolicy;
  if(!policy)throw Error('Preview policy missing; refusing to initialize.');
  const origin=location.origin;
  const nativeFetch=globalThis.fetch.bind(globalThis);
  const AUTH_ORIGIN='https://evjoitqnogmpedrulepv.supabase.co';
  const PUBLIC_KEY='sb_publishable_wv2cDeErfEorwoGCLl9rMA_yo01I01X';
  const OCR_WORKER='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js';
  // No stale invitations or new app/session data may enter persistent browser storage.
  // If a browser refuses this safety boundary, initialization fails closed before app creation.
  const noStorage=Object.freeze({length:0,getItem:()=>null,key:()=>null,removeItem(){},clear(){},
    setItem(){throw Error('PREVIEW_PERSISTENT_STORAGE_DISABLED');}});
  for(const name of ['localStorage','sessionStorage'])Object.defineProperty(globalThis,name,{value:noStorage,writable:false,configurable:false});
  const captures=[]; // Fixed operation/fixture identifiers only. Never photos, OCR, email, password, or tokens.
  const simulatedCustomers=new Map(),simulatedPackages=new Map();
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  const error=message=>{throw Error(message);};
  const keysAllowed=(body,keys)=>Object.keys(body).every(key=>keys.includes(key));
  const customerById=id=>policy.customers.find(c=>c.id===id);
  function fixtureBody(body){
    if(!body||typeof body!=='object'||Array.isArray(body))error('PREVIEW_ACTION_NOT_ALLOWED');
    if(body.action==='workspace'&&Object.keys(body).length===1)return {action:'workspace'};
    if(body.action==='create_customer'){
      if(!keysAllowed(body,['action','name','email','phone','customer_type','aliases']))error('PREVIEW_ACTION_NOT_ALLOWED');
      const c=policy.customers.find(c=>c.name===body.name);
      if(!c || (body.email&&body.email!==c.email) || body.phone || !['PERSON',undefined].includes(body.customer_type))error('PREVIEW_FIXTURE_ONLY: use Jordan Sample or Alex Example and their example.invalid email.');
      if(body.aliases && (!Array.isArray(body.aliases)||body.aliases.some(a=>!c.aliases.some(x=>x.alias===a.alias&&x.alias_type===a.alias_type))))error('PREVIEW_FIXTURE_ONLY');
      return {action:body.action,fixture_customer:c.id};
    }
    if(body.action==='receive_package'){
      if(!keysAllowed(body,['action','intake_package_id','customer_id','label_confirmed','confirmed_customer_id','origin_facility_id','destination_facility_id','tracking_number','carrier','size_class','weight_lb','payment_status','ocr_name','ocr_tracking','ocr_raw_text','ocr_recipient_address','photo_data_url']))error('PREVIEW_ACTION_NOT_ALLOWED');
      if(!customerById(body.customer_id)||body.origin_facility_id!=='fixture-origin'||![null,undefined,'','fixture-destination'].includes(body.destination_facility_id)||typeof body.label_confirmed!=='boolean'||(body.label_confirmed&&body.confirmed_customer_id!==body.customer_id))error('PREVIEW_FIXTURE_ONLY');
      return {action:body.action,fixture_customer:body.customer_id,fixture_facility:'fixture-origin',confirmed:body.label_confirmed};
    }
    if(body.action==='destination_arrival'){
      if(!keysAllowed(body,['action','package_id','facility_id','label_confirmed','confirmed_customer_id','note','photo_data_url']))error('PREVIEW_ACTION_NOT_ALLOWED');
      const c=policy.customers.find(c=>policy.parcel(c).id===body.package_id);
      if(!c||body.facility_id!=='fixture-destination'||typeof body.label_confirmed!=='boolean'||(body.label_confirmed&&body.confirmed_customer_id!==c.id))error('PREVIEW_FIXTURE_ONLY');
      return {action:body.action,fixture_package:body.package_id,fixture_facility:body.facility_id,confirmed:body.label_confirmed};
    }
    error('PREVIEW_ACTION_NOT_ALLOWED: signup, invitations, billing, management and notifications are disabled.');
  }
  function updateStatus(action){
    const el=document.getElementById('previewCaptureStatus');
    if(el)el.textContent='SIMULATED '+action.replaceAll('_',' ')+'. Nothing saved remotely. No notifications sent.';
  }
  async function safeFetch(input,init={}){
    const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,origin);
    const method=String(init.method||(typeof input==='object'&&input.method)||'GET').toUpperCase();
    if(url.username||url.password||url.hash)error('PREVIEW_NETWORK_BLOCKED');
    if(url.origin===origin&&url.pathname==='/scan'){
      // Do not read/clone/log the body. No image leaves the browser for hosted inference.
      updateStatus('inference_test_not_approved');
      return json({error:'PREVIEW_INFERENCE_TEST_NOT_APPROVED',preview:true},403);
    }
    if(url.origin===origin&&url.pathname==='/portal'&&!url.search&&method==='POST'){
      const raw=init.body??(input instanceof Request?await input.text():null);
      if(typeof raw!=='string')error('PREVIEW_INVALID_BODY');
      let body;try{body=JSON.parse(raw);}catch{error('PREVIEW_INVALID_BODY');}
      const safe=fixtureBody(body);
      const incoming=new Headers(init.headers||(input instanceof Request?input.headers:undefined));
      const response=await nativeFetch(origin+'/portal',{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',
        headers:{'Content-Type':'application/json','Authorization':incoming.get('Authorization')||''},body:JSON.stringify(safe)});
      const data=await response.json();
      if(!response.ok)return json(data,response.status);
      if(safe.action==='workspace'){
        if(data?.state!=='ACTIVE'||data?.preview?.fictional!==true)error('PREVIEW_UNEXPECTED_RESPONSE');
        for(const c of simulatedCustomers.values())if(!data.customers.some(x=>x.id===c.id))data.customers.push(policy.clone(c));
        for(const p of simulatedPackages.values()){const index=data.packages.findIndex(x=>x.id===p.id);if(index<0)data.packages.push(policy.clone(p));else data.packages[index]=policy.clone(p);}
      }else{
        if(data?.simulated!==true||data?.notifications_sent!==0||data?.persisted!==false)error('PREVIEW_UNEXPECTED_RESPONSE');
        captures.push(Object.freeze({...safe}));
        if(captures.length>100)captures.shift();
        if(data.customer)simulatedCustomers.set(data.customer.id,policy.clone(data.customer));
        if(data.package)simulatedPackages.set(data.package.id,policy.clone(data.package));
        updateStatus(safe.action);
      }
      return json(data,response.status);
    }
    // The only external account endpoints are existing-user password sign-in and local-session logout.
    if(url.origin===AUTH_ORIGIN&&method==='POST'&&(
      (url.pathname==='/auth/v1/token'&&url.search==='?grant_type=password')||
      (url.pathname==='/auth/v1/logout'&&url.search==='?scope=local')
    ))return nativeFetch(input,{...init,redirect:'error',credentials:'omit'});
    // Tesseract's main-thread worker bootstrap downloads this reviewed script URL only.
    if(url.href===OCR_WORKER&&method==='GET')return nativeFetch(input,{...init,redirect:'error',credentials:'omit'});
    error('PREVIEW_NETWORK_BLOCKED');
  }
  Object.defineProperty(globalThis,'fetch',{value:safeFetch,writable:false,configurable:false});
  const denied=()=>error('PREVIEW_NETWORK_BLOCKED');
  for(const name of ['XMLHttpRequest','WebSocket','EventSource'])Object.defineProperty(globalThis,name,{value:class{constructor(){denied();}},writable:false,configurable:false});
  if(globalThis.navigator){try{Object.defineProperty(navigator,'sendBeacon',{value:()=>false});}catch{/* CSP remains the independent boundary. */}}
  function createClient(url,key){
    if(url!==AUTH_ORIGIN||key!==PUBLIC_KEY)error('PREVIEW_AUTH_CONFIG_MISMATCH');
    const real=supabase.createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:safeFetch}});
    const reset=()=>{captures.length=0;simulatedCustomers.clear();simulatedPackages.clear();};
    real.auth.onAuthStateChange((_event,session)=>{if(!session)reset();});
    return {auth:{
      signInWithPassword:args=>real.auth.signInWithPassword(args),
      signUp:async()=>({data:{session:null},error:new Error('PREVIEW_SIGNUP_DISABLED')}),
      getSession:()=>real.auth.getSession(),onAuthStateChange:callback=>real.auth.onAuthStateChange(callback),
      signOut:async()=>{reset();return real.auth.signOut({scope:'local'});}
    }};
  }
  // Preserve Tesseract implementation and call sites, pin the transport paths and disable language cache writes.
  if(globalThis.Tesseract){
    const original=Tesseract.createWorker.bind(Tesseract);
    Tesseract.createWorker=(language,oem,options={},config)=>{
      if(language!=='eng')error('PREVIEW_OCR_LANGUAGE_NOT_ALLOWED');
      return original(language,oem,{...options,workerPath:OCR_WORKER,corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
        langPath:'https://tessdata.projectnaptha.com/4.0.0',cacheMethod:'none'},config);
    };
  }
  const disabled=['signUpMode','joinStaffMode','saveOnboarding','saveBusinessSetup','testBusinessSetup','createStaffInviteButton','addFacilityButton','addAliasButton','payLink','recheckAccess'];
  for(const id of disabled){const el=document.getElementById(id);if(el){el.disabled=true;el.setAttribute('aria-disabled','true');el.removeAttribute('href');}}
  document.addEventListener('submit',event=>event.preventDefault(),true);
  document.addEventListener('click',event=>{const el=event.target.closest?.('a,button');if(el&&(disabled.includes(el.id)||el.tagName==='A')){event.preventDefault();event.stopImmediatePropagation();}},true);
  Object.defineProperty(globalThis,'ParcelSnapPreview',{value:Object.freeze({createClient,receipts:()=>policy.clone(captures)}),writable:false,configurable:false});
})();
