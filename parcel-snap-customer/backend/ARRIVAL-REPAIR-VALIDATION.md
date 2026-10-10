# Parcel Snap arrival/photo/email repair checkpoint

Date: 2026-10-09 UTC. Local implementation and isolated validation only. No production deployment, migration, customer write, credential setup, or real email send was performed.

## What changed

- Both receive and destination-arrival routes use `arrival-workflow.mjs` through `portal.ts`.
- Email needs `label_confirmed: true` and `confirmed_customer_id` matching the saved customer. OCR/model confidence never authorizes a send.
- Package photos stay in the existing private bucket. The portal checks the bucket is private before writes. Server-generated company/package/event/content-hash paths are immutable. The stored photo bytes are downloaded and SHA-256 checked after upload and again before sending.
- The attachment is selected through a server-side company/package/customer/facility/event/photo relationship check. Client recipient addresses and storage paths cannot override it. The message includes one exact saved JPEG/PNG/WebP attachment and the saved tracking string, preserving leading zeros. Raw OCR text is no longer dumped into email.
- Company email preferences apply to both arrival flows and are rechecked by the atomic send claim. No recipient email means no send.
- A private durable arrival ledger records a unique company/package/event and frozen mail payload. Preparation uses a database transaction/advisory lock; sending uses an atomic database claim with fingerprint and claim token. These are not process-memory dedupe flags.
- Before any provider attempt, an unconfirmed PENDING draft can be corrected under the original intake ID. A stale caller cannot claim a subsequently edited draft. After an attempt is claimed, its payload is immutable.
- A storage failure cannot leave a newly inserted partial package. A database preparation failure may leave a private unreferenced object; retry verifies/reuses its content-addressed bytes. No cleanup job deletes evidence automatically.
- Documented provider rejection permits explicit identical-payload retry. Transport failure, HTTP 409/5xx, malformed success, or uncertain status persistence is UNKNOWN. Durable SENDING also blocks resend after a crash. No lease expiry silently turns these into a new send.
- `reconcile_notification: true` is a separate read-only-provider status path: authorize company/package/event/facility, load the saved payload, then GET the known provider ID. It does not upload a new photo or POST mail, and works if the customer's current email changed or the browser lost its photo.
- Legacy accepted notifications are not resent. Earlier exact-facility destination photos and corresponding arrival-event history trigger UNKNOWN when an old send cannot be proven absent, including after the package moved elsewhere.
- New write routes default to paused unless the ordinary non-secret `PARCEL_ARRIVAL_WRITES_ENABLED` environment flag is exactly `true`. Read-only reconciliation is exempt. Existing deployed JWT verification must remain enabled.

## Reproduce locally / CI

From repository root, on Node 24:

```sh
node --test parcel-snap-customer/tests/arrival-workflow.test.mjs
node parcel-snap-customer/tests/backend-intake-test.cjs
npm ci --prefix parcel-snap-customer/tests/sql-runtime --ignore-scripts --no-audit --no-fund
node --test parcel-snap-customer/tests/arrival-postgres.test.mjs
node --check parcel-snap-customer/backend/portal.ts
node --check parcel-snap-customer/backend/arrival-workflow.mjs
```

The SQL runtime dependency is isolated under `tests/sql-runtime`; package and lock files pin official npm `@electric-sql/pglite@0.5.8`. It is test-only, with no package install scripts run. `PGLITE_MODULE` can point to an already installed absolute `dist/index.js` instead. No network is used by the tests and no credentials are loaded. The mail transport is a capture function, Storage is an in-memory object store, and fixtures/recipients are synthetic.

Verified results:

- 32 mock-boundary tests pass, including the actual workflow and SQL adapter, exact attachment bytes, ownership attacks, uncertain recognition, preferences, failed upload/DB preparation, repeated/concurrent calls, retry, unknown outcomes, provider reconciliation and authorization rejection.
- 9 PostgreSQL-WASM tests pass. The exact proposal SQL is applied to real in-memory PostgreSQL, then the production SQL adapter runs. Tests verify RLS/privileges, unique event constraint, composite customer/photo/facility foreign keys, deferred ownership correction, stale-fingerprint claim rejection, atomic claim competition, historical-arrival guard, frozen retries and GET-only reconciliation.
- Portal routing/private-bucket/default-pause smoke and JavaScript/TypeScript syntax checks pass.

Evidence logs: `evidence/arrival-workflow-tests.log`, `evidence/arrival-postgres-tests.log`, and `evidence/arrival-portal-smoke.log`.

The baseline SQL fixture was built from read-only production column/type/default/identity/check/primary-key metadata. It contains no customer records. It intentionally omits pre-existing foreign keys, triggers, non-primary indexes and RLS. Location assignment is stubbed to return no location. PostgreSQL-WASM uses one database connection; it does not prove independent-process locking or Supabase transaction/connection-pool behavior.

## Schema and rollout gates

`schema-proposals/arrival-notices.sql` is a reviewed local proposal, not an applied migration. Supabase CLI was unavailable here, so no migration filename was invented. Use `supabase migration new arrival_notices` to generate the real migration after review, copying the proposal into it.

Before live writes are enabled:

1. Take the approved database/storage backup. Keep the existing notification, package-event and photo history intact.
2. Deploy a paused handler (`PARCEL_ARRIVAL_WRITES_ENABLED` absent/false) and stop frontend intake submission during the transition. Verify all old handler instances and in-flight old arrivals have drained before applying the ledger migration or enabling the new flow. The old handler does not honor the new claim lock and must not overlap it.
3. Rehearse the migration against a complete disposable PostgreSQL schema with actual triggers, existing FKs, RLS, indexes and `assign_suggested_location`. Test multiple independent database connections/processes competing for the same event, transaction rollback, restart, and claim persistence. Review Supabase advisors. Never treat the WASM test as proof of this gate.
4. Review legacy send/history inventory and reconcile suspicious events with provider records. Inventory from read-only checks at 2026-10-09 23:53 UTC: 4 packages, 4 origin events, 4 origin photos, 4 origin notification rows; 0 destination events/photos/notifications. All 4 photo metadata entries had a matching Storage object. Earlier audit showed the 4 notification rows marked SENT. This inventory supports current retained-record consistency, not proof of inbox delivery, absence of deleted history, or no unlogged provider acceptance.
5. Verify private bucket settings and no newly broad Storage policies, existing JWT verification, role/facility authorization, company preferences, and the intended email sender. Do not expose keys in client code or logs.
6. Run nonproduction end-to-end application tests with real private Storage and captured mail, then an explicitly approved synthetic delivery to a verified test inbox. Verify attachment rendering/bytes, tracking, record/photo consistency, bounce/delivery interpretation, and low-confidence/manual review behavior.
7. Only after the above gates, deliberately enable `PARCEL_ARRIVAL_WRITES_ENABLED=true` for the approved environment and verify the deployed frontend/backend/migration versions match. Monitor first approved operations without sending any unsolicited test notices to real customers.

## Recovery/rollback limitations

- SENT means Resend accepted the message; it is not an inbox-delivery claim. Reconciliation records provider `last_event` separately. No exactly-once delivery guarantee is claimed; provider idempotency expires after 24 hours, while this ledger's accepted/uncertain send barrier persists.
- An uncertain attempt without a provider ID stays blocked for operator/provider reconciliation. The code never guesses that it was unsent or automatically sends another message.
- After a definitive rejection, retries currently require the same payload. Correcting a rejected recipient address requires a separately reviewed durable attempt-version/idempotency-key workflow. Do not relax FAILED immutability or create a fresh intake just to bypass the block.
- Historical destination detection depends on retained photos/facility association or matching event site information. Missing/deleted history or renamed sites can make old outcomes unprovable. Such uncertainty needs review; absence of a record is not evidence that a provider never accepted an email.
- Keep the ledger on rollback. First pause writes and drain in-flight work, preserve all claims/history, and reconcile SENDING/UNKNOWN. Do not restore automatic legacy sending or drop a populated ledger: either would remove dedupe protection. Only an empty disposable test database may drop the proposal table and its four supporting indexes without a separate data-retention plan.

Official references: [Resend send/attachments](https://resend.com/docs/api-reference/emails/send-email), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [Resend GET sent email](https://resend.com/docs/api-reference/emails/retrieve-email), [Supabase private download](https://supabase.com/docs/reference/javascript/storage-from-download), [Supabase bucket metadata](https://supabase.com/docs/reference/javascript/storage-getbucket).
