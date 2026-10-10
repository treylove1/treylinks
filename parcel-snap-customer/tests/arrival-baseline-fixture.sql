-- Read-only production column metadata captured 2026-10-09; no customer rows.
-- Fixture omits pre-existing FKs, triggers, indexes and RLS. New proposal constraints are applied verbatim.
create schema parcel_snap;
create role anon;
create role authenticated;
create table parcel_snap.companies (
"id" uuid primary key default gen_random_uuid() not null,
"name" text not null,
"created_at" timestamp with time zone default now() not null
);
create table parcel_snap.company_profiles (
"company_id" uuid not null,
"business_type" text,
"primary_business_name" text,
"website" text,
"employee_count" integer,
"warehouse_count" integer,
"estimated_customers" integer,
"packages_per_day" integer,
"handles_pallets" boolean,
"handles_oversize" boolean,
"handles_appliances" boolean,
"handles_tvs" boolean,
"needs_storage" boolean,
"needs_returns" boolean,
"needs_inspection" boolean,
"needs_delivery" boolean,
"needs_customer_notifications" boolean,
"notification_channels" text[] default ARRAY['EMAIL'::text] not null,
"needs_worker_sublogins" boolean,
"needs_driver_access" boolean,
"needs_multi_warehouse" boolean,
"notes" text,
"onboarding_complete" boolean default false not null,
"updated_at" timestamp with time zone default now() not null
);
create table parcel_snap.customers (
"id" uuid primary key default gen_random_uuid() not null,
"company_id" uuid not null,
"name" text not null,
"email" text,
"phone" text,
"status" text default 'ACTIVE'::text not null,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null,
"customer_type" text default 'PERSON'::text not null
);
create table parcel_snap.facilities (
"id" uuid primary key default gen_random_uuid() not null,
"company_id" uuid not null,
"code" text not null,
"name" text not null,
"facility_type" text not null,
"address_line1" text,
"address_line2" text,
"city" text,
"region" text,
"postal_code" text,
"country" text,
"notification_label" text,
"timezone" text,
"active" boolean default true not null,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null
);
create table parcel_snap.notifications (
"id" uuid primary key default gen_random_uuid() not null,
"package_id" uuid not null,
"customer_id" uuid,
"event_type" text not null,
"recipient" text not null,
"provider" text default 'RESEND'::text not null,
"provider_message_id" text,
"status" text default 'QUEUED'::text not null,
"error_message" text,
"created_at" timestamp with time zone default now() not null,
"sent_at" timestamp with time zone,
"delivered_at" timestamp with time zone
);
create table parcel_snap.package_events (
"id" bigint generated always as identity primary key not null,
"package_id" uuid not null,
"event_type" text not null,
"site" text,
"location_id" uuid,
"note" text,
"actor_label" text,
"created_at" timestamp with time zone default now() not null
);
create table parcel_snap.package_photos (
"id" uuid primary key default gen_random_uuid() not null,
"company_id" uuid not null,
"package_id" uuid not null,
"facility_id" uuid,
"kind" text default 'ARRIVAL'::text not null,
"storage_path" text not null,
"mime_type" text,
"created_at" timestamp with time zone default now() not null
);
create table parcel_snap.packages (
"id" uuid primary key default gen_random_uuid() not null,
"company_id" uuid not null,
"customer_id" uuid,
"tracking_number" text,
"carrier" text,
"size_class" text default 'UNKNOWN'::text not null,
"weight_lb" numeric(10,2),
"payment_status" text default 'UNKNOWN'::text not null,
"stage" text default 'MIAMI_RECEIVED'::text not null,
"current_location_id" uuid,
"received_miami_at" timestamp with time zone,
"departed_miami_at" timestamp with time zone,
"expected_nassau_at" timestamp with time zone,
"received_nassau_at" timestamp with time zone,
"ready_for_pickup_at" timestamp with time zone,
"picked_up_at" timestamp with time zone,
"delivered_at" timestamp with time zone,
"storage_started_at" timestamp with time zone,
"free_storage_days" integer default 7 not null,
"storage_rate_per_day" numeric(10,2) default 0 not null,
"source_photo_url" text,
"ocr_name" text,
"ocr_tracking" text,
"ocr_confidence" numeric(5,4),
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null,
"received_site_id" uuid,
"origin_facility_id" uuid,
"destination_facility_id" uuid,
"current_facility_id" uuid,
"ocr_raw_text" text,
"ocr_recipient_address" text,
"vision_provider" text,
"vision_model" text,
"vision_result" jsonb,
"vision_confidence" numeric(5,4),
"origin_received_at" timestamp with time zone,
"last_arrived_at" timestamp with time zone
);
create function parcel_snap.assign_suggested_location(uuid,text) returns uuid language sql as $$select null::uuid$$;
alter table parcel_snap.company_profiles add constraint company_profiles_employee_count_check CHECK (((employee_count IS NULL) OR (employee_count >= 0)));
alter table parcel_snap.company_profiles add constraint company_profiles_estimated_customers_check CHECK (((estimated_customers IS NULL) OR (estimated_customers >= 0)));
alter table parcel_snap.company_profiles add constraint company_profiles_packages_per_day_check CHECK (((packages_per_day IS NULL) OR (packages_per_day >= 0)));
alter table parcel_snap.company_profiles add constraint company_profiles_warehouse_count_check CHECK (((warehouse_count IS NULL) OR (warehouse_count >= 0)));
alter table parcel_snap.customers add constraint customers_customer_type_check CHECK ((customer_type = ANY (ARRAY['PERSON'::text, 'BUSINESS'::text])));
alter table parcel_snap.customers add constraint customers_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text])));
alter table parcel_snap.facilities add constraint facilities_facility_type_check CHECK ((facility_type = ANY (ARRAY['ORIGIN'::text, 'DESTINATION'::text, 'TRANSIT'::text])));
alter table parcel_snap.notifications add constraint notifications_status_check CHECK ((status = ANY (ARRAY['QUEUED'::text, 'SENT'::text, 'DELIVERED'::text, 'FAILED'::text, 'BOUNCED'::text, 'SUPPRESSED'::text])));
alter table parcel_snap.package_photos add constraint package_photos_kind_check CHECK ((kind = ANY (ARRAY['ARRIVAL'::text, 'DESTINATION'::text, 'WAREHOUSE'::text, 'DELIVERY'::text, 'OTHER'::text])));
alter table parcel_snap.packages add constraint packages_free_storage_days_check CHECK ((free_storage_days >= 0));
alter table parcel_snap.packages add constraint packages_payment_status_check CHECK ((payment_status = ANY (ARRAY['UNKNOWN'::text, 'UNPAID'::text, 'PARTIAL'::text, 'PAID'::text, 'WAIVED'::text])));
alter table parcel_snap.packages add constraint packages_size_class_check CHECK ((size_class = ANY (ARRAY['UNKNOWN'::text, 'SMALL'::text, 'MEDIUM'::text, 'LARGE'::text, 'OVERSIZE'::text])));
alter table parcel_snap.packages add constraint packages_stage_check CHECK ((stage = ANY (ARRAY['NEEDS_REVIEW'::text, 'ORIGIN_RECEIVED'::text, 'MIAMI_RECEIVED'::text, 'IN_TRANSIT'::text, 'DESTINATION_RECEIVED'::text, 'NASSAU_RECEIVED'::text, 'WAREHOUSED'::text, 'READY_FOR_PICKUP'::text, 'OUT_FOR_DELIVERY'::text, 'PICKED_UP'::text, 'DELIVERED'::text, 'EXCEPTION'::text])));
alter table parcel_snap.packages add constraint packages_storage_rate_per_day_check CHECK ((storage_rate_per_day >= (0)::numeric));
alter table parcel_snap.company_profiles add PRIMARY KEY (company_id);
