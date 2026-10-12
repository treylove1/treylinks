// Pure contract and read-only catalog check. No credentials, provider calls or writes.
import schemaContract from './arrival-schema-contract.json' with {type:'json'};
export const ARRIVAL_CONTRACT='parcel-snap-arrival-review-v1';
export const ARRIVAL_DEPLOYMENT='parcel-snap-arrival-review-20261012-v1';
// This private candidate cannot activate paid/unverified delivery with an env flag.
// Changing this requires separately approved billing verification + release review.
export const FREE_ONLY_RELEASE_VERIFIED=false;
export const SCHEMA_PROBE_SQL=`select c.relrowsecurity as rls,
 obj_description(c.oid,'pg_class') as marker,
 (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  or has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
  or has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
  or has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  or has_any_column_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
  or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where acl.grantee<>c.relowner)
  or exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) acl
    where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and acl.grantee<>c.relowner)) as public_access,
 (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) order by a.attname)
  from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns,
 (select jsonb_agg(jsonb_build_object('name',k.conname,'type',k.contype,'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid)) order by k.conname)
  from pg_constraint k where k.conrelid=c.oid and k.contype<>'n') as constraints
 from pg_class c where c.oid=to_regclass('parcel_snap.arrival_notices') and c.relkind='r'`;
const normalizedConstraints=rows=>(rows||[]).map(r=>({name:r.name,type:r.type,validated:r.validated,definition:String(r.definition).replace(/\s+/g,' ').trim()}));
const normalizedColumns=rows=>(rows||[]).map(r=>({name:r.name,type:r.type,not_null:r.not_null}));
export async function arrivalSchemaReady(queryOne){
 try{
  const row=await queryOne(SCHEMA_PROBE_SQL);
  return Boolean(row&&row.rls===true&&row.public_access===false&&row.marker===schemaContract.marker&&
   JSON.stringify(normalizedColumns(row.columns))===JSON.stringify(normalizedColumns(schemaContract.columns))&&
   JSON.stringify(normalizedConstraints(row.constraints))===JSON.stringify(normalizedConstraints(schemaContract.constraints)));
 }catch{return false;}
}
export async function arrivalCapabilities({queryOne,companyId,userId,role,writesFlag,freeOnlyVerified=FREE_ONLY_RELEASE_VERIFIED}){
 const schemaReady=await arrivalSchemaReady(queryOne);
 const scoped=typeof companyId==='string'&&companyId.length>0&&typeof userId==='string'&&userId.length>0;
 const enabled=scoped&&['OWNER','MANAGER','STAFF'].includes(role)&&schemaReady&&writesFlag==='true'&&freeOnlyVerified===true;
 return {contract:ARRIVAL_CONTRACT,mode:enabled?'ENABLED':'PAUSED',company_id:companyId,actor_id:userId,
  deployment_id:ARRIVAL_DEPLOYMENT,confirmation:'customer-contact-revision-v1',idempotency:'durable-arrival-ledger-v1',
  photo:'private-sha256-attachment-v1',reconcile:'provider-get-no-resend-v1',workspace:'read-only-snapshot-v1',schema_ready:schemaReady};
}
function reject(message,status){throw Object.assign(new Error(message),{status});}
export function assertArrivalRequest(body,capability,kind){
 if(!capability||body.arrival_contract!==ARRIVAL_CONTRACT||body.arrival_deployment_id!==capability.deployment_id)
  reject('This arrival form is outdated. Reload the reviewed workspace before saving.',409);
 if(capability.contract!==ARRIVAL_CONTRACT||capability.schema_ready!==true)
  reject('Arrival safety verification is unavailable. No arrival saved.',503);
 // Reconciliation retains its existing provider-GET-only path. It can persist an
 // already accepted outcome; this is not a globally read-only database operation.
 if(body.reconcile_notification===true)return;
 if(capability.mode!=='ENABLED')reject('Package arrivals are temporarily paused for verification.',503);
 if(body.label_confirmed!==true||typeof body.confirmed_customer_id!=='string'||!body.confirmed_customer_id||
  (kind==='origin'&&body.confirmed_customer_id!==body.customer_id)||
  typeof body.confirmed_customer_contact_version!=='string'||!body.confirmed_customer_contact_version||
  (kind==='destination'&&(typeof body.confirmed_package_review_version!=='string'||!body.confirmed_package_review_version)))
  reject('Review and confirm the displayed customer, tracking and photo before saving.',409);
}
