-- PRIVATE REVIEW CANDIDATE. Not deployed or registered in Supabase migration history.
-- Promote with supabase migration new arrival_notices only in the approved release environment.
-- Derived from pinned 5f15580 proposal; retains its private ledger and ownership constraints.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $preflight$
declare required_table text;
begin
 if to_regclass('parcel_snap.arrival_notices') is not null then
  raise exception 'Arrival ledger already exists. Stop and inspect; never drop or silently replace it.';
 end if;
 foreach required_table in array array['companies','customers','facilities','packages','package_photos'] loop
  if to_regclass('parcel_snap.'||required_table) is null then raise exception 'Missing required table %',required_table; end if;
 end loop;
 if current_user <> (select pg_get_userbyid(relowner) from pg_class where oid='parcel_snap.packages'::regclass) then
  raise exception 'Migration must run as the existing application table owner. Do not broaden grants.';
 end if;
end;
$preflight$;
-- These indexes permit composite foreign keys that bind tenant/recipient/photo.
create unique index packages_arrival_identity
 on parcel_snap.packages(id,company_id,customer_id);
create unique index customers_arrival_identity
 on parcel_snap.customers(id,company_id);
create unique index facilities_arrival_identity
 on parcel_snap.facilities(id,company_id);
create unique index package_photos_arrival_identity
 on parcel_snap.package_photos(id,company_id,package_id,facility_id);

create table parcel_snap.arrival_notices (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references parcel_snap.companies(id),
 package_id uuid not null,
 customer_id uuid not null,
 facility_id uuid not null,
 event_type text not null,
 photo_id uuid not null,
 photo_path text not null,
 photo_mime text not null check(photo_mime in ('image/jpeg','image/png','image/webp')),
 photo_sha256 text not null check(photo_sha256 ~ '^[0-9a-f]{64}$'),
 fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 status text not null default 'PENDING' check(status in ('PENDING','SENDING','SENT','FAILED','UNKNOWN')),
 claim_token uuid,
 confirmed_by uuid,
 confirmed_at timestamptz,
 started_at timestamptz,
 attempt_count integer not null default 0 check(attempt_count>=0),
 provider_message_id text,
 provider_event text,
 error_message text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(company_id,package_id,event_type),
 foreign key(package_id,company_id,customer_id) references parcel_snap.packages(id,company_id,customer_id) deferrable initially deferred,
 foreign key(customer_id,company_id) references parcel_snap.customers(id,company_id),
 foreign key(facility_id,company_id) references parcel_snap.facilities(id,company_id),
 foreign key(photo_id,company_id,package_id,facility_id) references parcel_snap.package_photos(id,company_id,package_id,facility_id),
 check(event_type='ORIGIN_ARRIVAL' or event_type='FACILITY_ARRIVAL_'||facility_id::text)
);
alter table parcel_snap.arrival_notices enable row level security;
revoke all on parcel_snap.arrival_notices from public,anon,authenticated,service_role;
comment on table parcel_snap.arrival_notices is 'parcel-snap-arrival-ledger-v1';

-- Candidate filters only, never uniqueness rules for tracking or photo bytes.
create index packages_arrival_tracking_search on parcel_snap.packages(company_id,upper(regexp_replace(tracking_number,'[^0-9A-Za-z]','','g')));
create index arrival_notices_photo_identity on parcel_snap.arrival_notices(company_id,photo_sha256,package_id,photo_id);
-- Default privileges can grant access to a newly created ledger. Never inherit
-- an unexpected public/BYPASSRLS grant or change the existing default ACLs.
do $access_check$
begin
 if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
   where c.oid='parcel_snap.arrival_notices'::regclass and acl.grantee<>c.relowner)
 or exists(select 1 from pg_class c join pg_attribute a on a.attrelid=c.oid
   cross join lateral aclexplode(a.attacl) acl
   where c.oid='parcel_snap.arrival_notices'::regclass and a.attnum>0 and not a.attisdropped and acl.grantee<>c.relowner)
 or has_table_privilege('service_role','parcel_snap.arrival_notices','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 or has_any_column_privilege('service_role','parcel_snap.arrival_notices','SELECT,INSERT,UPDATE,REFERENCES') then
  raise exception 'Unexpected ledger access. Stop and review default privileges; do not broaden grants.';
 end if;
end;
$access_check$;
commit;
-- Production rollback: PAUSE, drain, retain ledger and reconcile; no destructive DOWN script.
