import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeScan} from './auth-staging/authorize.mjs';
const uid='00000000-0000-4000-8000-000000000001';
const active={role:'OWNER',subscription_status:'ACTIVE',onboarding_complete:true,can_operate:false};
function database(row){return {begin:async(mode,fn)=>{assert.equal(mode,'read only');return fn({unsafe:async(query,params)=>{
 assert.match(query,/^select /i);assert.doesNotMatch(query,/\b(insert|update|delete|upsert|call|materializeBusinessSetup|customers|packages|notifications)\b/i);
 assert.deepEqual(params,[uid]);assert.match(query,/m.user_id=\$1::uuid and m.active=true/);return row?[row]:[];
 }});}};}
test('authorization runs exclusively in a read-only transaction and returns no tenant/customer data',async()=>assert.deepEqual(await authorizeScan(database(active),uid),{state:'ACTIVE',company:{role:'OWNER'}}));
test('missing membership, expired entitlement, setup incomplete and wrong roles are denied without mutation',async()=>{
 for(const row of [null,{...active,subscription_status:'INACTIVE'},{...active,current_period_end:'2000-01-01'},{...active,onboarding_complete:false},{...active,role:'CUSTOMER'},{...active,role:'STAFF',can_operate:false}])assert.equal(await authorizeScan(database(row),uid),null);
});
test('warehouse staff need existing active same-company OPERATE assignment',async()=>assert.deepEqual(await authorizeScan(database({...active,role:'STAFF',can_operate:true}),uid),{state:'ACTIVE',company:{role:'STAFF'}}));
test('unverified or missing identity never queries the database',async()=>assert.equal(await authorizeScan({begin:()=>assert.fail('must not query')},''),null));
test('OWNER and MANAGER preserve ACTIVE or TRIALING entitlement and completed setup requirements',async()=>{
 for(const role of ['OWNER','MANAGER'])for(const subscription_status of ['ACTIVE','TRIALING']){
  const row={...active,role,subscription_status,current_period_end:'2999-01-01'};
  assert.deepEqual(await authorizeScan(database(row),uid),{state:'ACTIVE',company:{role}});
  for(const onboarding_complete of [false,null,undefined,'true'])assert.equal(await authorizeScan(database({...row,onboarding_complete}),uid),null);
 }
});
test('STAFF and WAREHOUSE require boolean true OPERATE authorization even with valid entitlement',async()=>{
 for(const role of ['STAFF','WAREHOUSE']){
  assert.deepEqual(await authorizeScan(database({...active,role,can_operate:true}),uid),{state:'ACTIVE',company:{role}});
  for(const can_operate of [false,null,undefined,'true'])assert.equal(await authorizeScan(database({...active,role,can_operate}),uid),null);
 }
});
test('unknown roles, canceled subscriptions and invalid or expired entitlement dates are rejected',async()=>{
 for(const role of ['CUSTOMER','DRIVER','VIEWER','ADMIN','owner'])assert.equal(await authorizeScan(database({...active,role}),uid),null);
 for(const subscription_status of ['INACTIVE','CANCELED','PAST_DUE',null])assert.equal(await authorizeScan(database({...active,subscription_status}),uid),null);
 for(const current_period_end of ['invalid-date','2000-01-01'])assert.equal(await authorizeScan(database({...active,current_period_end}),uid),null);
});
test('the facility query is same-user, same-company, active facility and OPERATE scoped',async()=>{
 const sql={begin:async(mode,fn)=>{assert.equal(mode,'read only');return fn({unsafe:async query=>{
  for(const pattern of [/f\.company_id=a\.company_id/,/a\.user_id=m\.user_id/,/a\.company_id=m\.company_id/,/a\.active=true/,/a\.permission='OPERATE'/,/f\.active=true/,/order by m\.created_at asc limit 1/])assert.match(query,pattern);
  return [{...active,role:'WAREHOUSE',can_operate:true}];
 }});}};
 assert.equal((await authorizeScan(sql,uid)).company.role,'WAREHOUSE');
});
