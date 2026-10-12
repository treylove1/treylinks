import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {handle,AUTH_URL} from '../dist/worker.mjs';
const root=new URL('../dist/public/',import.meta.url);
const source=name=>readFileSync(new URL(name,root),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function harness({authenticated=true,authorized=true}={}){
  const nodes=new Map(),wire=[],authCalls=[],sdkCalls=[],ocrCalls=[],alerts=[];
  let session=authenticated?{access_token:'fixture.header.signature'}:null;
  const node=id=>{if(!nodes.has(id)){const classes=new Set();nodes.set(id,{id,value:'',textContent:'',innerHTML:'',checked:false,disabled:false,dataset:{},files:[],
    classList:{add(...xs){xs.forEach(x=>classes.add(x));},remove(...xs){xs.forEach(x=>classes.delete(x));},toggle(x,force){if(force===false)classes.delete(x);else if(force===true||!classes.has(x))classes.add(x);else classes.delete(x);},contains:x=>classes.has(x)},
    setAttribute(){},removeAttribute(){},querySelectorAll:()=>[],click(){this.onclick?.();}});}return nodes.get(id);};
  const fakeWorker={setParameters:async()=>{},recognize:async()=>({data:{text:'',blocks:[]}}),terminate:async()=>{}};
  const base={console:{warn(){},error(){},log(){}},performance,Response,Request,Headers,TextEncoder,TextDecoder,AbortSignal,URL:class extends URL{static createObjectURL(){return 'blob:fictional';}static revokeObjectURL(){}},
    setTimeout:()=>0,clearTimeout(){},requestAnimationFrame:fn=>fn(),crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000000'},
    location:{origin:'https://fictional-preview.example.invalid',reload(){}},navigator:{},alert:text=>alerts.push(text),
    localStorage:{getItem:()=>null,setItem(){throw Error('Persistence forbidden');},removeItem(){}},
    document:{getElementById:node,querySelector:()=>({click(){}}),querySelectorAll:()=>[],addEventListener(){}},
    Tesseract:{createWorker:async(...args)=>{ocrCalls.push(args);return fakeWorker;}},
    supabase:{createClient:(url,key,options)=>{sdkCalls.push({url,key,options});return {auth:{
      getSession:async()=>({data:{session}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
      signInWithPassword:async()=>{session={access_token:'fixture.header.signature'};return {data:{session},error:null};},
      signUp:async()=>{throw Error('Signup must not reach SDK');},signOut:async options=>{sdkCalls.push(options);session=null;return {error:null};}
    }};}},
    async fetch(url,options={}){
      wire.push({url:String(url),body:options.body,headers:options.headers});
      if(String(url).startsWith('https://fictional-preview.example.invalid/')){
        return handle(new Request(String(url),{...options,headers:{...options.headers,Origin:'https://fictional-preview.example.invalid','Sec-Fetch-Site':'same-origin'}}),async(authUrl,authOptions)=>{
          authCalls.push({url:authUrl,body:authOptions.body});assert.equal(authUrl,AUTH_URL);
          return authorized?Response.json({state:'ACTIVE',company:{role:'OWNER'}}):Response.json({error:'invalid JWT'},{status:401});
        },{limit:async()=>({success:true})});
      }
      // No real I/O. External auth transport is observed only in the dedicated boundary test.
      return Response.json({mock:true});
    }
  };
  const ctx=vm.createContext(base);ctx.window=ctx;
  for(const name of ['preview-policy.js','preview-bootstrap.js','known-customer-matcher.js','app.js','vision-result.js','vision-client.js'])vm.runInContext(source(name),ctx,{filename:name});
  return {ctx,node,wire,authCalls,sdkCalls,ocrCalls,alerts,run:code=>vm.runInContext(code,ctx),async ready(){const deadline=Date.now()+3000;do{await settle();if(!session||vm.runInContext('workspace',ctx)!==null||node('loadingState').innerHTML)return;await new Promise(r=>setTimeout(r,1));}while(Date.now()<deadline);throw Error('App boot did not reach workspace/auth-denial terminal state');}};
}

test('full copied app stays behind read-only auth; mock-authorized boot renders only fictional workspace',async()=>{
  const h=harness();await h.ready();assert.equal(h.run('workspace.company.name'),'FICTIONAL Parcel Snap Preview');
  assert.equal(h.node('companyTitle').textContent,'FICTIONAL Parcel Snap Preview');assert.equal(h.node('customerCount').textContent,1);assert.equal(h.node('packageCount').textContent,1);
  assert(h.authCalls.length>0);assert.equal(h.sdkCalls[0].options.auth.persistSession,false);assert.equal(h.sdkCalls[0].options.auth.autoRefreshToken,false);
  assert.equal(h.sdkCalls[0].options.auth.detectSessionInUrl,false);
});
test('no session makes zero portal/auth calls; fake session rejected by Worker never gets workspace',async()=>{
  const loggedOut=harness({authenticated:false});await loggedOut.ready();assert.equal(loggedOut.wire.length,0);assert.equal(loggedOut.run('workspace'),null);
  const rejected=harness({authorized:false});await rejected.ready();assert.equal(rejected.run('workspace'),null);assert.match(rejected.node('loadingState').innerHTML,/PREVIEW_AUTH_DENIED/);
});
test('signup remains disabled through real app event even if hidden button or mode is invoked directly',async()=>{
  const h=harness({authenticated:false});await h.ready();h.node('email').value='fictional@example.invalid';h.node('password').value='fixture-password';h.node('signupCompany').value='Test';
  h.run('setMode("signup")');await h.node('authButton').onclick();assert.match(h.node('authMessage').textContent,/PREVIEW_SIGNUP_DISABLED/);assert.equal(h.wire.length,0);
});
test('production portal, hosted vision, Supabase data/signup, arbitrary URLs, and alternate network APIs fail locally',async()=>{
  const h=harness();await h.ready();const before=h.wire.length;
  for(const url of ['https://evjoitqnogmpedrulepv.supabase.co/functions/v1/parcel-snap-portal','https://evjoitqnogmpedrulepv.supabase.co/functions/v1/parcel-snap-vision','https://evjoitqnogmpedrulepv.supabase.co/rest/v1/customers','https://evjoitqnogmpedrulepv.supabase.co/auth/v1/signup','https://evil.example.invalid']){
    h.ctx.badURL=url;await assert.rejects(h.run('fetch(badURL,{method:"POST",body:"PRIVATE"})'),/PREVIEW_NETWORK_BLOCKED/);
  }
  for(const name of ['XMLHttpRequest','WebSocket','EventSource'])assert.throws(()=>h.run('new '+name+'("https://evil.example.invalid")'),/PREVIEW_NETWORK_BLOCKED/);
  assert.equal(h.run('navigator.sendBeacon("https://evil.example.invalid","PRIVATE")'),false);assert.equal(h.wire.length,before);
});
test('hosted /scan is hard-disabled client-locally without forwarding the photo',async()=>{
  const h=harness();await h.ready();const before=h.wire.length;
  const r=await h.run('fetch(location.origin+"/scan",{method:"POST",body:JSON.stringify({image_data_url:"PRIVATE_PHOTO"})})');
  assert.equal(r.status,403);assert.equal((await r.json()).error,'PREVIEW_INFERENCE_TEST_NOT_APPROVED');assert.equal(h.wire.length,before);
});
test('actual photo onchange and OCR functions run with mocked image/OCR primitives; no hosted image upload occurs',async()=>{
  const h=harness();await h.ready();const before=h.wire.length;
  h.run(`toCanvas=async x=>x;estimateSkewDegrees=()=>0;deskewCanvas=x=>x;flattenOcrLines=()=>[];
    fastOcrRecognizeDetailed=async()=>({text:'',blocks:[]});detectBarcode=async()=>'';runDeepRecovery=async()=>null;
    preparePackageImages=async()=>({preview:'data:image/jpeg;base64,FICTIONAL',vision:'data:image/jpeg;base64,FICTIONAL',ocrCanvas:{width:800,height:500},rawOcrCanvas:{width:800,height:500}});`);
  await h.node('packagePhoto').onchange({target:{files:[{name:'synthetic-label.jpg'}]}});await h.ready();
  assert.equal(h.run('intakePhotoDataUrl'),'data:image/jpeg;base64,FICTIONAL');assert.equal(h.run('intakePhotoPending'),false);
  assert.equal(h.wire.length,before);assert.equal(h.node('receiveCustomer').value,'');assert.match(h.node('processingText').textContent,/Name not clear/);
});
test('real receive handler sends only allowlisted fixture tokens and retains photo for honest simulated failure state',async()=>{
  const h=harness();await h.ready();h.node('receiveCustomer').value='fixture-customer-jordan';h.node('receiveOrigin').value='fixture-origin';h.node('receiveDestination').value='fixture-destination';h.node('receiveLabelConfirmed').checked=true;h.node('receiveTracking').value='PRIVATE_TRACKING';
  h.run(`intakePhotoDataUrl='data:image/jpeg;base64,PRIVATE_PHOTO';intakeOcrName='PRIVATE_NAME';intakeOcrText='PRIVATE_OCR';intakeOcrAddress='PRIVATE_ADDRESS';`);
  await h.run('receivePackage()');
  const sent=JSON.parse(h.wire.at(-1).body);assert.deepEqual(sent,{action:'receive_package',fixture_customer:'fixture-customer-jordan',fixture_facility:'fixture-origin',confirmed:true});
  assert(!JSON.stringify(h.wire).includes('PRIVATE_'));assert.equal(h.run('ParcelSnapPreview.receipts().length'),1);assert(!h.run('JSON.stringify(ParcelSnapPreview.receipts())').includes('PRIVATE_'));
  assert.equal(h.run('intakePhotoDataUrl'),'data:image/jpeg;base64,PRIVATE_PHOTO');assert.match(h.node('receiveResult').textContent,/SIMULATED_DISABLED/);assert.match(h.node('receiveResult').textContent,/no photo saved, no customer notification sent/);assert.equal(h.node('receivePackageButton').disabled,false);
});
test('real arrival handler is a nonpersistent fixture capture with no photo/note upload or notification',async()=>{
  const h=harness();await h.ready();h.node('transferPackage').value='fixture-package-jordan';h.node('transferFacility').value='fixture-destination';h.node('transferLabelConfirmed').checked=true;h.node('transferNote').value='PRIVATE_NOTE';h.run(`transferPhotoDataUrl='data:image/jpeg;base64,PRIVATE_ARRIVAL';`);
  await h.node('saveTransfer').onclick();assert.deepEqual(JSON.parse(h.wire.at(-1).body),{action:'destination_arrival',fixture_package:'fixture-package-jordan',fixture_facility:'fixture-destination',confirmed:true});assert(!JSON.stringify(h.wire).includes('PRIVATE_'));assert.match(h.node('transferResult').textContent,/SIMULATED_DISABLED/);assert(h.run('transferPhotoDataUrl'));
});
test('customer creation accepts only named fictional identity; real contact values never leave the tab',async()=>{
  const h=harness();await h.ready();const before=h.wire.length;
  await assert.rejects(h.run(`api({action:'create_customer',name:'Private Real Name',email:'real@customer.test',phone:'555',customer_type:'PERSON',aliases:[]})`),/PREVIEW_FIXTURE_ONLY/);assert.equal(h.wire.length,before);
  const created=await h.run(`api({action:'create_customer',name:'Alex Example',email:'alex@example.invalid',phone:'',customer_type:'PERSON',aliases:[]})`);assert.equal(created.customer.id,'fixture-customer-alex');assert.deepEqual(JSON.parse(h.wire.at(-1).body),{action:'create_customer',fixture_customer:'fixture-customer-alex'});
  await h.run('loadWorkspace()');assert.equal(h.run('workspace.customers.length'),2);
  const fresh=harness();await fresh.ready();assert.equal(fresh.run('workspace.customers.length'),1);
});
test('management, aliases, invitations and billing actions remain blocked at transport regardless of UI',async()=>{
  const h=harness();await h.ready();const before=h.wire.length;
  for(const action of ['create_staff_invite','claim_staff_invite','onboard','save_business_profile','create_facility','add_customer_alias','send_notification']){h.ctx.action=action;await assert.rejects(h.run('api({action})'),/PREVIEW_ACTION_NOT_ALLOWED/);}
  assert.equal(h.wire.length,before);assert.equal(h.node('signUpMode').disabled,true);assert.equal(h.node('createStaffInviteButton').disabled,true);
});
test('Tesseract call sites use original engine with explicit paths and disabled cache',async()=>{
  const h=harness();await h.ready();await h.run('getParcelSnapOcrWorker()');assert.equal(h.ocrCalls.length,1);
  const [language,oem,options]=h.ocrCalls[0];assert.equal(language,'eng');assert.equal(oem,1);assert.equal(options.cacheMethod,'none');assert.equal(options.workerPath,'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js');
});
test('existing-user sign-in/logout are narrowly routed while refresh, signup and arbitrary auth queries are rejected',async()=>{
  const h=harness({authenticated:false});await h.ready();
  await h.run(`fetch('https://evjoitqnogmpedrulepv.supabase.co/auth/v1/token?grant_type=password',{method:'POST',body:'{}'})`);assert.equal(h.wire.length,1);
  await assert.rejects(h.run(`fetch('https://evjoitqnogmpedrulepv.supabase.co/auth/v1/token?grant_type=refresh_token',{method:'POST',body:'{}'})`),/PREVIEW_NETWORK_BLOCKED/);
  await h.run('sb.auth.signOut()');assert.equal(h.sdkCalls.at(-1).scope,'local');
});

test('direct join-mode handler cannot persist real invitation text or read stale storage',async()=>{
  const h=harness({authenticated:false});await h.ready();h.node('staffInviteCode').value='PRIVATE_INVITATION';h.node('email').value='private@example.invalid';h.node('password').value='private-password';
  h.run('setMode("join")');await h.node('authButton').onclick();assert.match(h.node('authMessage').textContent,/PREVIEW_PERSISTENT_STORAGE_DISABLED/);assert.equal(h.wire.length,0);
  assert.equal(h.run('localStorage.getItem("parcel-snap-pending-invite")'),null);assert.equal(h.run('sessionStorage.getItem("anything")'),null);
  assert.throws(()=>h.run('sessionStorage.setItem("private","PRIVATE")'),/PREVIEW_PERSISTENT_STORAGE_DISABLED/);
});
