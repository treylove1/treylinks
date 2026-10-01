-- Parcel Snap warehouse backend (current cloud design)
-- Tables live in isolated schema parcel_snap.
-- Customer app is NOT connected yet because tenant RLS policies are still pending approval.

create schema if not exists parcel_snap;

-- Core entities:
-- companies
-- customers
-- warehouse_locations
-- packages
-- package_events
-- notifications

-- Operational rules implemented in cloud:
-- 1. Unpaid/partial Nassau package -> HOLD zone.
-- 2. Paid Nassau package -> STORAGE zone.
-- 3. READY_FOR_PICKUP -> READY_PICKUP zone.
-- 4. OVERSIZE -> OVERSIZE zone.
-- 5. Location must have compatible size class and remaining capacity.
-- 6. Lowest-priority-number / least-filled eligible location wins.
-- 7. Storage days calculate from storage start / Nassau arrival until pickup/delivery/current time.
-- 8. Storage fee = max(storage_days - free_days, 0) * rate_per_day.
-- 9. Every automatic location assignment writes a package event.
-- 10. Attention queue flags late in-transit, unpaid arrivals, unlocated arrivals,
--     packages that need pickup staging, missing locations, and storage-fee-due cases.

-- Current verified functions:
-- parcel_snap.storage_days(parcel_snap.packages)
-- parcel_snap.storage_fee(parcel_snap.packages)
-- parcel_snap.location_occupancy(uuid)
-- parcel_snap.suggest_location(uuid)
-- parcel_snap.assign_suggested_location(uuid,text)

-- Current verified views:
-- parcel_snap.package_operations
-- parcel_snap.warehouse_attention

-- Security:
-- anon/authenticated grants are revoked from parcel_snap schema objects.
-- RLS is NOT YET enabled because final tenant policies must be defined first.
-- Do not expose these tables directly to browser clients until RLS policies are approved.
