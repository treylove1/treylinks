-- INDEPENDENTLY AUTHORED FICTIONAL CONTRACT FIXTURE. NOT a production schema.
-- Only the columns needed by the additive migration and atomic claim are modeled.
-- Passing these tests DOES NOT prove full production compatibility, Supabase Auth,
-- application policies, allocation, Storage, provider delivery, or deployed behavior.
-- Load only in the fresh disposable PostgreSQL 17 service guarded by the test runner.
create schema parcel_snap;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role fictional_reader nologin;
grant usage on schema parcel_snap to anon, authenticated, service_role, fictional_reader;

create table parcel_snap.companies (id uuid primary key, name text not null);
create table parcel_snap.customers (
  id uuid primary key,
  company_id uuid not null,
  email text not null
);
create table parcel_snap.facilities (
  id uuid primary key,
  company_id uuid not null,
  active boolean not null,
  facility_type text not null
);
create table parcel_snap.packages (
  id uuid primary key,
  company_id uuid not null,
  customer_id uuid not null,
  tracking_number text not null,
  current_facility_id uuid not null,
  destination_facility_id uuid,
  stage text not null
);
create table parcel_snap.package_photos (
  id uuid primary key,
  company_id uuid not null,
  package_id uuid not null,
  facility_id uuid not null
);
create table parcel_snap.company_profiles (
  company_id uuid primary key,
  needs_customer_notifications boolean not null,
  notification_channels text[] not null
);

-- Deliberate existing grant and row, used to prove additive preservation locally.
grant select on parcel_snap.customers to authenticated;
insert into parcel_snap.companies values
  ('10000000-0000-4000-8000-000000000001', 'Fictional Contract Company');
