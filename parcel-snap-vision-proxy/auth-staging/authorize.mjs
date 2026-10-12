// This module only reads authorization metadata; it never loads customers/packages.
export async function authorizeScan(sql,userId){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId||''))return null;
 return sql.begin('read only',async tx=>{
  const rows=await tx.unsafe(`select m.role,s.status as subscription_status,s.current_period_end,
   p.onboarding_complete,
   exists(select 1 from parcel_snap.member_facility_access a
    join parcel_snap.facilities f on f.id=a.facility_id and f.company_id=a.company_id
    where a.user_id=m.user_id and a.company_id=m.company_id and a.active=true
    and a.permission='OPERATE' and f.active=true) as can_operate
   from parcel_snap.company_memberships m
   join parcel_snap.companies c on c.id=m.company_id
   left join parcel_snap.company_subscriptions s on s.company_id=m.company_id
   left join parcel_snap.company_profiles p on p.company_id=m.company_id
   where m.user_id=$1::uuid and m.active=true order by m.created_at asc limit 1`,[userId]);
  const m=rows[0];
  if(!m||!['ACTIVE','TRIALING'].includes(m.subscription_status))return null;
  if(m.current_period_end&&!(new Date(m.current_period_end).getTime()>Date.now()))return null;
  if(!['OWNER','MANAGER','STAFF','WAREHOUSE'].includes(m.role))return null;
  if(['OWNER','MANAGER'].includes(m.role)&&m.onboarding_complete!==true)return null;
  if(['STAFF','WAREHOUSE'].includes(m.role)&&m.can_operate!==true)return null;
  return {state:'ACTIVE',company:{role:m.role}};
 });
}
