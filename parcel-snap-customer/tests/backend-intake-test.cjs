// Public-safe routing smoke. Real behavior is covered by isolated arrival suites.
// Every dependency is injected; the live portal bootstrap is never imported.
const fs=require('fs'),assert=require('assert');
const source=fs.readFileSync(__dirname+'/../backend/portal.ts','utf8');
const start=source.indexOf('    if (action === "receive_package" || action === "destination_arrival")');
const end=source.indexOf('    return json(req, await workspaceSnapshot',start);
assert(start>=0&&end>start,'both arrival routes must use one safety workflow');
const block=source.slice(start,end);
const run=new Function('action','role','body','req','companyId','userId','email','canWrite','json','saveArrival','Deno','arrivalCapabilities','queryOne','assertArrivalRequest','return (async()=>{'+block+'})()');
(async()=>{
 const {assertArrivalRequest,arrivalCapabilities,ARRIVAL_CONTRACT,ARRIVAL_DEPLOYMENT}=await import('../backend/arrival-capabilities.mjs');
 const expected=JSON.parse(fs.readFileSync(__dirname+'/../backend/arrival-schema-contract.json','utf8'));
 const validBody={arrival_contract:ARRIVAL_CONTRACT,arrival_deployment_id:ARRIVAL_DEPLOYMENT,customer_id:'fictional-customer',label_confirmed:true,confirmed_customer_id:'fictional-customer',confirmed_customer_contact_version:'fictional-contact-version',confirmed_package_review_version:'fictional-package-version'};
 const enabled=async()=>({contract:ARRIVAL_CONTRACT,deployment_id:ARRIVAL_DEPLOYMENT,mode:'ENABLED',schema_ready:true});
 const queryOne=async()=>({rls:true,public_access:false,marker:expected.marker,columns:expected.columns,constraints:expected.constraints});
 let calls=[];
 const save=async(...args)=>{calls.push(args);return {ok:true,photo_saved:true,email:{status:'SENT'}}};
 const invoke=(action,role,body=validBody,capabilities=enabled,flag='true')=>run(action,role,body,{},'fictional-company','fictional-user','owner@example.invalid',r=>['OWNER','MANAGER','STAFF'].includes(r),(req,data,status=200)=>({data,status}),save,{env:{get:()=>flag}},capabilities,queryOne,assertArrivalRequest);
 assert.equal((await invoke('receive_package','OWNER')).data.email.status,'SENT');assert.equal(calls[0][5],'origin');
 assert.equal((await invoke('destination_arrival','STAFF')).data.photo_saved,true);assert.equal(calls[1][5],'destination');
 assert.equal((await invoke('receive_package','VIEWER')).status,403);assert.equal(calls.length,2);
 await assert.rejects(()=>invoke('receive_package','OWNER',{}),e=>e.status===409);
 await assert.rejects(()=>invoke('receive_package','OWNER',{...validBody,confirmed_customer_id:'different-customer'}),e=>e.status===409);
 await assert.rejects(()=>invoke('receive_package','OWNER',{...validBody,confirmed_customer_contact_version:''}),e=>e.status===409);
 await assert.rejects(()=>invoke('receive_package','OWNER',validBody,arrivalCapabilities),e=>e.status===503);
 const paused=await invoke('receive_package','OWNER',validBody,enabled,'false');assert.equal(paused.status,503);
 assert.equal(calls.length,2,'rejected/paused paths never enter saveArrival');
 assert(source.includes('admin.storage.getBucket(PHOTO_BUCKET)'));assert(source.includes('data.public !== false'));
 assert(!source.includes('async function sendArrivalEmail'));
 const readonlyStart=source.indexOf('    if (action === "workspace_readonly")'),readonlyEnd=source.indexOf('    if (action === "workspace"',readonlyStart);
 assert(readonlyStart>0&&readonlyEnd>readonlyStart);
 const readonly=source.slice(readonlyStart,readonlyEnd);assert(!readonly.includes('materializeBusinessSetup'));
 const readRun=new Function('action','req','workspaceSnapshot','companyId','userId','role','membership','json','return (async()=>{'+readonly+'})()');
 let reads=0;const snapshot=await readRun('workspace_readonly',{},async()=>{reads++;return {state:'ACTIVE',profile:{onboarding_complete:false}};},'fictional-company','fictional-user','OWNER',{},(_req,data)=>data);
 assert.equal(reads,1);assert.equal(snapshot.profile.onboarding_complete,false);
 console.log('Backend portal routing smoke passed: versioned review, mismatched-customer rejection, default hard-pause, read-only workspace routing and private-bucket guard. No real email sent.');
})().catch(e=>{console.error(e);process.exitCode=1});
