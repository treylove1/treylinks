# Isolated camera authorization

The deployed `parcel-snap-portal` version18 (bundleSHA256 `2e998ecf5b5109f33aaf57a93ceac1ae1a50a2dbfeb776a330ad6683f98350b9`) invokes `materializeBusinessSetup` on eligible OWNER workspace requests. That path upserts business configuration and facilities. It is unsuitable as a read-only camera preflight. This finding describes a reachable code path, not evidence an unwanted write occurred.

Staging now uses a separate `parcel-snap-camera-auth-staging-20261008` function. The existing production portal is unchanged. Version1 has verify_jwt=true and bundleSHA256 `9a7f588111bf45fa58da4dd070a0e64624b90e5677217fac4ec4853e7d144612`.

The pinned @supabase/server1.9.1 auth:user wrapper verifies identity. Authorization queries execute in a Postgres read-only transaction and select only membership, company, subscription, profile completion and same-company active facility OPERATE access. There is no workspace dispatch, business initialization, customer/package query, storage operation or notification sender. Tenant selection is derived from verified user identity, never request data. Existing first-membership and ACTIVE/TRIALING entitlement rules are retained. OWNER/MANAGER require completed setup; warehouse staff require an existing active OPERATE assignment. Responses expose only ACTIVE and role.

Verification: deployed source readback matches; actual database transaction_read_only=on. Actual deployed missing/invalid bearer calls both return401. Regression tests exercise exclusively SELECT statements in read-only mode, missing membership, expired entitlement, incomplete setup, wrong role and missing facility assignment. Worker test ensures staging calls only this dedicated endpoint with no workspace action.

Not yet proven: successful valid-user deployed execution or staged /scan inference, physical phone capture, customer matching/save/email. Native browser credential-state recovery remains blocked; do not copy credentials or bypass authorization. A fresh supported session is required.

Rollback: restore repair branch bd26aaf only after review; do not switch staging back to workspace for signed-in tests. The new unused function can remain isolated. No production/main changes.
