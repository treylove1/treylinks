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
