const fs=require('fs'),assert=require('assert');
const source=fs.readFileSync(__dirname+'/../backend/portal.ts','utf8');
let block=source.slice(source.indexOf('    if (action === "receive_package")'),source.indexOf('    if (action === "destination_arrival")')).replace('let emailResult: {status:string;provider_id:string|null;error:string|null}','let emailResult');
const names=['action','role','body','req','companyId','userId','email','canWrite','json','queryOne','canOperateFacility','crypto','sql','uploadPhoto','sendArrivalEmail'];
const run=new Function(...names,'return (async()=>{'+block+'})()');
async function test(emailValue,duplicate){
 let sends=0,inserted=false,args=null;
 const query=async(q,p)=>{
  if(q.includes('select id,name,email'))return {id:'customer',name:'Example Recipient',email:emailValue};
  if(q.includes('select id,name,city'))return {id:'origin',city:'Miami'};
  if(q.includes('select id,customer_id,stage,source_photo_url'))return duplicate?{id:'same',customer_id:'customer',stage:'ORIGIN_RECEIVED',source_photo_url:'photo'}:null;
  if(q.includes('select status,provider_message_id'))return {status:'SENT'};
  if(q.includes('insert into parcel_snap.packages')){inserted=true;assert.equal(p.length,15);assert(q.includes('$15::uuid'));return {id:'saved',stage:'ORIGIN_RECEIVED'};}
  if(q.includes('needs_customer_notifications'))return {needs_customer_notifications:true,notification_channels:['EMAIL']};
  return {};
 };
 const body={customer_id:'customer',origin_facility_id:'origin',intake_package_id:'11111111-1111-4111-8111-111111111111',photo_data_url:'test',ocr_raw_text:'Example Recipient\nTracking 123456789012'};
 const r=await run('receive_package','OWNER',body,{},'company','owner','owner@example.test',()=>true,(req,data,status)=>({data,status}),query,async()=>true,{randomUUID:()=>body.intake_package_id},{unsafe:async()=>[]},async()=> 'private-photo',async a=>{sends++;args=a;return {status:'SENT',provider_id:'test',error:null}});
 return {r,sends,inserted,args};
}
(async()=>{
 let x=await test('',false);assert.equal(x.r.data.email.status,'EMAIL_NOT_LISTED');assert.equal(x.sends,0);
 x=await test('recipient@example.test',false);assert.equal(x.sends,1);assert(x.args.extractedText.includes('Example Recipient'));
 x=await test('recipient@example.test',true);assert.equal(x.sends,0);assert.equal(x.inserted,false);assert.equal(x.r.data.duplicate,true);
 console.log('Backend mocked-flow tests passed: missing email, extracted text in mail, duplicate intake suppression. No real email sent.');
})().catch(e=>{console.error(e);process.exitCode=1});
