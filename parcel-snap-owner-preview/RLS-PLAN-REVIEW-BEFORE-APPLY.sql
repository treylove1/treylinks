-- Parcel Snap tenant security plan
-- REVIEW BEFORE APPLYING.
-- Goal: every signed-in user can only access their own courier/company rows.
-- Platform-owner support access should remain server-side only, never broad browser access.

create table if not exists parcel_snap.company_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references parcel_snap.companies(id) on delete cascade,
  role text not null default 'STAFF' check (role in ('OWNER','MANAGER','STAFF','DRIVER','VIEWER')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(user_id,company_id)
);

create index if not exists company_memberships_company_idx
  on parcel_snap.company_memberships(company_id,user_id);

alter table parcel_snap.company_memberships enable row level security;
alter table parcel_snap.companies enable row level security;
alter table parcel_snap.customers enable row level security;
alter table parcel_snap.warehouse_locations enable row level security;
alter table parcel_snap.packages enable row level security;
alter table parcel_snap.package_events enable row level security;
alter table parcel_snap.notifications enable row level security;

create or replace function parcel_snap.user_in_company(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = parcel_snap, public
as $$
  select exists (
    select 1
    from parcel_snap.company_memberships m
    where m.user_id = auth.uid()
      and m.company_id = target_company
      and m.active = true
  );
$$;

revoke all on function parcel_snap.user_in_company(uuid) from public, anon;
grant execute on function parcel_snap.user_in_company(uuid) to authenticated;

create policy memberships_self_read
on parcel_snap.company_memberships
for select to authenticated
using (user_id = auth.uid());

create policy companies_member_read
on parcel_snap.companies
for select to authenticated
using (parcel_snap.user_in_company(id));

create policy customers_company_access
on parcel_snap.customers
for all to authenticated
using (parcel_snap.user_in_company(company_id))
with check (parcel_snap.user_in_company(company_id));

create policy warehouse_locations_company_access
on parcel_snap.warehouse_locations
for all to authenticated
using (parcel_snap.user_in_company(company_id))
with check (parcel_snap.user_in_company(company_id));

create policy packages_company_access
on parcel_snap.packages
for all to authenticated
using (parcel_snap.user_in_company(company_id))
with check (parcel_snap.user_in_company(company_id));

create policy package_events_company_access
on parcel_snap.package_events
for all to authenticated
using (
  exists (
    select 1
    from parcel_snap.packages p
    where p.id = package_events.package_id
      and parcel_snap.user_in_company(p.company_id)
  )
)
with check (
  exists (
    select 1
    from parcel_snap.packages p
    where p.id = package_events.package_id
      and parcel_snap.user_in_company(p.company_id)
  )
);

create policy notifications_company_access
on parcel_snap.notifications
for all to authenticated
using (
  exists (
    select 1
    from parcel_snap.packages p
    where p.id = notifications.package_id
      and parcel_snap.user_in_company(p.company_id)
  )
)
with check (
  exists (
    select 1
    from parcel_snap.packages p
    where p.id = notifications.package_id
      and parcel_snap.user_in_company(p.company_id)
  )
);

-- Explicit grants are still required because access was previously revoked.
grant usage on schema parcel_snap to authenticated;
grant select on parcel_snap.companies to authenticated;
grant select,insert,update,delete on parcel_snap.customers to authenticated;
grant select,insert,update,delete on parcel_snap.warehouse_locations to authenticated;
grant select,insert,update,delete on parcel_snap.packages to authenticated;
grant select,insert,update,delete on parcel_snap.package_events to authenticated;
grant select,insert,update,delete on parcel_snap.notifications to authenticated;
grant select on parcel_snap.company_memberships to authenticated;

-- Do not grant these tables to anon.
