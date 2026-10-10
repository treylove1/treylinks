# Parcel Snap arrival and customer-review repair

Checkpoint: 2026-10-10. This is reviewed source plus isolated synthetic tests. It is not a deployment, migration, real inbox-delivery result, or complete live-app acceptance result.

## Matching frontend and backend contract

- Origin receive and destination arrival use `arrival-workflow.mjs` through `portal.ts`. OCR/model output remains review evidence and never authorizes email.
- Confirmed arrival requires the displayed customer ID and opaque `contact_version`. Contact changes invalidate the confirmation before writes, in the database transaction, and at the final atomic claim. The token hashes company/customer identity and the PostgreSQL row revision, without embedding contact details.
- OWNER/MANAGER/STAFF permissions are unchanged. Staff workspace and recovered-review responses keep email hidden and explicitly set `contact_email_visible: false`; the UI describes confirmation of the selected customer's saved contact.
- Destination confirmation also pins the exact displayed `review_version` for package/customer/tracking identity. A stale or missing version fails before photo upload, ledger creation, or movement. Tracking remains text, including leading zeros and explicitly blank values.
- Form, photo, package, customer, contact, route, size, weight and payment edits invalidate the corresponding confirmation. Newly created customers require fresh confirmation.
- An unattempted PENDING origin draft can recover its original package ID, verified private photo and editable metadata. Corrections use that same package instead of creating a duplicate. Recovery is read-only, restricted to the authorized company/origin facility, and rejects concurrent changes.
- Metadata-only corrections are persisted transactionally even when the existing notice fingerprint does not change. Attempted PENDING and SENT/SENDING/UNKNOWN payloads remain immutable. Existing explicit, same-payload FAILED retry behavior is retained.

## Native-driver and displayed-photo follow-up

The first native PostgreSQL CI run exposed a postgres.js parameter-encoding difference not represented by the earlier WASM adapter: binding already-serialized JSON directly to a jsonb parameter encoded it again as a JSON string. Both ledger INSERT and editable-PENDING UPDATE now cast the serialized parameter through text before jsonb. Regression checks cover native driver inference, stored object shape, same-ledger corrections, exact outgoing envelope and attachment bytes; read the exact commit's native CI result before relying on that gate.

After image preparation, the browser now displays the exact prepared JPEG held for submission, replacing the temporary original-image preview before OCR/review. Regression checks compare displayed data with the actual receive payload and reject stale photo selections. This does not substitute for physical-camera or live Storage acceptance.

## Workspace error recovery

A failed workspace load now offers an ordinary Retry workspace button and a loading state. Retry retains the current in-memory session; it does not reload, sign in or sign out. Duplicate clicks are suppressed, older load results cannot replace a newer view, and sign-out invalidates pending loads. The actual request session must match the expected user before fetch, with a second identity check before rendering. Same-user token refresh remains valid. Sixteen synthetic regressions cover repeated failures, stale replies, lost/switched sessions (including A-to-B-to-A), escaped errors, loading state and retained photo/review fields.

## Photo and send safety

The portal requires the existing private photo bucket. Company/package/event/content-hash object paths are immutable, and downloaded bytes are checked against the saved SHA-256. The attachment relationship is checked server-side against the company, package, customer, facility and event. Client addresses or paths cannot override it.

The durable ledger has one company/package/event record, transactional preparation, advisory locking, an atomic claim and a frozen send payload. The successful claim is the authorization point: later customer/tracking changes cannot redirect the claimed message. Mail contains the exact stored photo and tracking, without dumping raw OCR text.

Definitive rejection permits explicit same-payload retry. Timeout, HTTP 409/5xx, malformed provider success, or uncertain status persistence is UNKNOWN. SENDING and UNKNOWN never expire into automatic resends. Read-only provider reconciliation can retrieve a known message ID without uploading a photo or sending mail again. Legacy accepted/uncertain arrival history remains a send barrier.

The ordinary `PARCEL_ARRIVAL_WRITES_ENABLED` flag still defaults to paused. Reconciliation is exempt. JWT verification, private Storage, company preferences and role/facility checks remain required. The proposed ledger migration is not applied by tests or CI to any live system.

## Reproduce the public-safe checks

The regression workflow pins Node 24.19.0, PGlite 0.5.8, Tesseract.js 6.0.1, Tesseract.js-core 6.0.0 and canvas 0.1.100. Its package lockfiles use the existing official npm runtimes with install scripts disabled. English OCR data is installed locally by the existing operating-system package step; the tests do not fetch language data.

From the repository root after installing the locked test runtimes:

```sh
export NODE_PATH="$PWD/parcel-snap-customer/tests/ocr-runtime/node_modules"
export TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata
node --import ./parcel-snap-customer/tests/isolated-network-guard.mjs --test \
  parcel-snap-customer/tests/known-customer-matcher-test.mjs \
  parcel-snap-customer/tests/ocr-parser-test.mjs \
  parcel-snap-customer/tests/ocr-speed-architecture-test.mjs \
  parcel-snap-customer/tests/vision-display-test.mjs \
  parcel-snap-customer/tests/customer-label-safety-test.mjs \
  parcel-snap-customer/tests/intake-confirmation-flow-test.mjs \
  parcel-snap-customer/tests/workspace-recovery.test.mjs \
  parcel-snap-customer/tests/vision-result-test.mjs \
  parcel-snap-customer/tests/arrival-workflow.test.mjs \
  parcel-snap-customer/tests/arrival-review.test.mjs \
  parcel-snap-customer/tests/arrival-postgres.test.mjs \
  parcel-snap-customer/tests/portal-contact-review.test.mjs \
  parcel-snap-customer/tests/customer-arrival-integration.test.mjs
```

On the frozen public-safe candidate, this combined command passed 299 tests with zero failures. Separate smoke and pure configuration results are recorded independently; native concurrency and real service delivery are not counted in that result.

The network guard fails accidental global HTTP/socket access. Application transports are injected capture functions. Cross-layer tests exercise real customer event handlers, an actual fictional JPEG, local Tesseract and the production SQL adapter on isolated PostgreSQL-WASM; DOM/auth envelopes, private Storage and mail are substituted. The workflow separately covers portal/private-bucket/default-pause, photo parser, onboarding and the previously published frozen preview.

The unchanged, already-public `arrival-baseline-fixture.sql` was derived from read-only column/type/default/identity/check/primary-key metadata, without customer records. It is not a wholly independently authored production schema. It omits pre-existing foreign keys, triggers, non-primary indexes and RLS, and stubs warehouse assignment. All inserted records are fictional. No newly captured schema metadata or complete-schema fixtures are part of this release.

PGlite uses one database connection. The separately prepared [native PostgreSQL job](../tests/native-postgres/README.md) must pass on the exact published commit before independent-connection behavior is claimed. Local native sockets were restricted; that route was not retried.

## Rollout and rollback gates

1. Review the exact frontend/backend pair and take an approved backup before any live rollout. Stop intake submission and deploy the new handler paused. Drain all old handler instances and in-flight arrivals; the old handler must not overlap the new claim workflow.
2. Rehearse the proposal against an authorized complete disposable schema, including actual constraints, triggers, RLS, allocation functions and independent connections. Public minimal-fixture tests do not establish production migration compatibility.
3. Preserve and review existing notice, event and photo history. Uncertain prior sends require operator/provider reconciliation; missing history is not evidence that nothing was sent.
4. Verify private Storage permissions, existing JWT/role/facility checks, sender preferences and the intended environment. Run authorized staging tests, then an explicitly approved synthetic delivery to a verified test inbox. Verify photo bytes, tracking, persistence and provider/inbox status separately.
5. Release the matching frontend/backend and migration together, refresh open forms, and only then deliberately enable writes for that approved environment. PostgreSQL row revisions are short-lived concurrency markers, not permanent IDs or credentials.

Rollback begins by pausing writes and draining in-flight work. Retain the ledger, claims, event and photo history, and reconcile SENDING/UNKNOWN. Do not drop a populated ledger, restore automatic legacy sends, or create a fresh intake to bypass a retry barrier. A code rollback cannot undo sent email.

SENT means provider acceptance, not inbox delivery or an exactly-once guarantee. Physical camera behavior, actual browser authentication, hosted inference, live private Storage, real inbox delivery and production deployment remain separate acceptance gates.
