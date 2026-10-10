// Existing receive handler executed in a small isolated DOM/API model.
import './isolated-network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createDB,harness,I,id} from './arrival-safety-harness.mjs';
const sources=[['current app',new URL('../app.js',import.meta.url)]];
for(const [label,path] of sources)test(label+' current receive UI retains data/ID on generic duplicate conflict',async t=>{
 const db=await createDB();t.after(()=>db.close());const h=await harness(db);await h.run();const nodes=new Map(),requests=[];const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false,classList:{add(){},remove(){}}});return nodes.get(id);};
 for(const [key,value] of Object.entries({receiveCustomer:I.customer,receiveOrigin:I.us,receiveDestination:I.nassau,receiveSize:'SMALL',receivePayment:'UNPAID',receiveTracking:h.input.body.tracking_number,receiveCarrier:'UPS',receiveAddress:h.input.body.ocr_recipient_address,receiveWeight:'2.50'}))$(key).value=value;
 const ctx=vm.createContext({$,console,crypto,receiveInFlight:false,intakePhotoPending:false,intakePhotoDataUrl:h.input.body.photo_data_url,intakePackageId:id(55),intakeReadToken:1,intakeRecipientDisplay:null,intakeOcrName:'Jordan Sample',intakeOcrText:'Synthetic reviewed label',intakeOcrAddress:h.input.body.ocr_recipient_address,arrivalEmailRecoveryScope:()=>({}),stopRecoveryOcr:()=>{},reviewedArrivalConfirmation:()=>({contact_version:h.input.body.confirmed_customer_contact_version}),alert:()=>{throw Error('Unexpected alert');},api:async body=>{requests.push(structuredClone(body));h.input.body=body;return h.run();},rememberArrivalEmailRecovery:()=>{throw Error('Conflict must not become a saved-success result');},createReceiveCustomer:()=>{throw Error('No new customer expected');}});
 const app=fs.readFileSync(path,'utf8'),start=app.indexOf('async function receivePackage(){'),end=app.indexOf('$("receivePackageButton").onclick=receivePackage;',start);assert(start>=0&&end>start);vm.runInContext(app.slice(start,end),ctx);const beforePhoto=ctx.intakePhotoDataUrl;await vm.runInContext('receivePackage()',ctx);assert.equal(ctx.intakePhotoDataUrl,beforePhoto);assert.equal(ctx.intakePackageId,id(55));assert.equal($('receiveTracking').value,'0012345678901234567890');assert.match($('receiveResult').textContent,/already linked|tracking identity/);assert.equal($('receivePackageButton').disabled,false);assert.equal(ctx.receiveInFlight,false);assert.equal(h.posts().length,1);assert.equal(requests.length,1);assert(!$('receiveResult').textContent.includes('jordan@example.invalid'));
});
