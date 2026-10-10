// Portal routing smoke test. Complete arrival behavior lives in arrival-workflow.test.mjs.
const fs=require('fs'),assert=require('assert');
const source=fs.readFileSync(__dirname+'/../backend/portal.ts','utf8');
const start=source.indexOf('    if (action === "receive_package" || action === "destination_arrival")');
assert(start>=0,'both arrival routes must use one safety workflow');
const block=source.slice(start,source.indexOf('    const data = await workspace(companyId',start));
const run=new Function('action','role','body','req','companyId','userId','email','canWrite','json','saveArrival','Deno','return (async()=>{'+block+'})()');
(async()=>{
 let calls=[];
 const save=async(...args)=>{calls.push(args);return {ok:true,photo_saved:true,email:{status:'SENT'}}};
 const invoke=(action,role)=>run(action,role,{label_confirmed:true},{},'company','user','owner@example.test',r=>['OWNER','MANAGER','STAFF'].includes(r),(req,data,status=200)=>({data,status}),save,{env:{get:()=> 'true'}});
 assert.equal((await invoke('receive_package','OWNER')).data.email.status,'SENT');assert.equal(calls[0][5],'origin');
 assert.equal((await invoke('destination_arrival','STAFF')).data.photo_saved,true);assert.equal(calls[1][5],'destination');
 assert.equal((await invoke('receive_package','VIEWER')).status,403);assert.equal(calls.length,2);
 assert(source.includes('admin.storage.getBucket(PHOTO_BUCKET)'));assert(source.includes('data.public !== false'));
 assert(!source.includes('async function sendArrivalEmail'));
 const paused=await run('receive_package','OWNER',{}, {},'company','user','owner@example.test',()=>true,(req,data,status)=>({data,status}),save,{env:{get:()=>undefined}});assert.equal(paused.status,503);assert.equal(calls.length,2);
 console.log('Backend portal routing smoke passed: shared safe workflow, origin/destination, read-only role denied, runtime private-bucket guard. No real email sent.');
})().catch(e=>{console.error(e);process.exitCode=1});
