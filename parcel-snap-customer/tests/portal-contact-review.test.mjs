import './isolated-network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {customerContactVersion,packageReviewVersion} from '../backend/arrival-workflow.mjs';

// Extract only pure request functions. Never import portal's live boot/config.
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../backend/portal.ts',import.meta.url),'utf8'));
const companyId='00000001-1111-4111-8111-111111111111';
const customer={id:'00000002-1111-4111-8111-111111111111',name:'Synthetic Recipient',email:'recipient@example.test',phone:'fictional',contact_revision:'123'};
const workspaceSource=source.slice(source.indexOf('async function workspace('),source.indexOf('function normalizeBusinessSetup('));
for(const role of ['OWNER','MANAGER','STAFF'])test(role+' workspace exposes only scoped review token with baseline contact visibility',async()=>{
 const visible=role!=='STAFF',queries=[];
 const queryMany=async q=>{queries.push(q);return q.includes('from parcel_snap.customers c')?[{...customer,...(visible?{}:{email:null,phone:null})}]:[];};
 const run=new Function('allowedFacilityIds','isAdmin','queryMany','markPendingOriginReviews','customerContactVersion',workspaceSource+';return workspace;')(async()=>['facility'],r=>['OWNER','MANAGER'].includes(r),queryMany,async()=>{},customerContactVersion);
 const result=await run(companyId,'fictional-user',role),row=result.customers[0];
 assert.equal(row.contact_email_visible,visible);assert.equal(row.email,visible?customer.email:null);assert.equal(row.phone,visible?customer.phone:null);
 assert.equal(row.contact_version,await customerContactVersion(companyId,customer));assert(!('contact_revision' in row));
 const customerQuery=queries.find(q=>q.includes('from parcel_snap.customers c'));assert.match(customerQuery,/xmin::text as contact_revision/);if(!visible)assert.match(customerQuery,/null::text as email,null::text as phone/);
});
test('created customer response includes reviewed version and exposes no raw revision',async()=>{
 const start=source.indexOf('    if (action === "create_customer")'),end=source.indexOf('    if (action === "add_customer_alias")',start);
 const run=new Function('action','role','body','req','companyId','canWrite','json','queryOne','sql','customerContactVersion','return (async()=>{'+source.slice(start,end)+'})();');
 const result=await run('create_customer','STAFF',{name:customer.name,email:customer.email}, {},companyId,()=>true,(_req,data)=>data,async()=>({...customer}),{unsafe:async()=>[]},customerContactVersion);
 assert.equal(result.customer.email,customer.email);assert.equal(result.customer.contact_email_visible,true);assert.equal(result.customer.contact_version,await customerContactVersion(companyId,customer));assert(!('contact_revision' in result.customer));
});
test('contact token fails closed without a server row revision',async()=>{
 await assert.rejects(()=>customerContactVersion(companyId,{id:customer.id,email:customer.email}),e=>e.status===503);
});
test('package workspace enrichment includes reviewed displayed identity for existing role scopes',async()=>{
 const start=source.indexOf('async function markPendingOriginReviews('),end=source.indexOf('async function workspace(',start);
 const run=new Function('canWrite','arrivalRepository','isAdmin','packageReviewVersion',source.slice(start,end)+';return markPendingOriginReviews;')(()=>true,{pendingOriginReviews:async()=>[]},()=>false,packageReviewVersion);
 const p={id:'00000003-1111-4111-8111-111111111111',customer_id:customer.id,tracking_number:'000REVIEWED',stage:'ORIGIN_RECEIVED'};
 const rows=[{...p}];await run(rows,companyId,'STAFF',['origin']);assert.equal(rows[0].review_version,await packageReviewVersion(companyId,p));assert.equal(rows[0].origin_review_pending,false);
 assert.notEqual(rows[0].review_version,await packageReviewVersion(companyId,{...p,tracking_number:'UNSEEN'}));assert.notEqual(rows[0].review_version,await packageReviewVersion(companyId,{...p,customer_id:'other-customer'}));
});
