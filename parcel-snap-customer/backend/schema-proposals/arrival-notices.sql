-- LOCAL REVIEW PROPOSAL ONLY. Not applied; not a generated Supabase migration.
-- Generate an actual migration with `supabase migration new arrival_notices`
-- after schema review, backup, and isolated PostgreSQL execution tests.
begin;

-- These indexes permit composite foreign keys that bind tenant/recipient/photo.
create unique index if not exists packages_arrival_identity
 on parcel_snap.packages(id,company_id,customer_id);
create unique index if not exists customers_arrival_identity
 on parcel_snap.customers(id,company_id);
create unique index if not exists facilities_arrival_identity
 on parcel_snap.facilities(id,company_id);
create unique index if not exists package_photos_arrival_identity
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
revoke all on parcel_snap.arrival_notices from public,anon,authenticated;
comment on table parcel_snap.arrival_notices is 'Private durable arrival email claims. UNKNOWN/SENDING must never be automatically re-sent; reconcile provider outcome.';
commit;

-- Rollback plan (not executable rollback here): stop new arrivals and mail first;
-- preserve/export this ledger for dedupe and reconciliation; restore the prior code
-- only with sending disabled. Do NOT drop a populated ledger or resume legacy
-- automatic sending: that would remove the durable duplicate-send barrier.
-- In an empty disposable test DB only, DROP TABLE followed by the four indexes
-- restores this proposal's schema additions. Production rollback needs a reviewed
-- retention/migration plan for any recorded send attempts.
