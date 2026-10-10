# Arrival warehouse and duplicate-intake safety

## Local candidate

The arrival workflow now checks new destination arrivals against the saved planned facility, facility kind and forward shipping stage. Package rows are locked for update, facilities are locked for share, and the destination update repeats its legal-state predicates with `RETURNING`. The mail claim rechecks the current facility, route and stage. An old warehouse shelf is cleared before asking the existing assignment helper for a new one.

For origin intake, the server checks exact previously saved label-photo hashes and conservative carrier/tracking identities across different intake UUIDs, always within `company_id`. Sorted database advisory identity locks precede the package lock, and the lookup repeats inside the transaction. Exact old workflow photo paths preserve duplicate recognition after a draft changes its current photo.

The original tracking text is preserved. Known carrier aliases and recognized formats may normalize case and ordinary separators for comparison; leading zeros remain. Unknown carrier formats retain literal tracking equality. A broad ASCII-alphanumeric search/lock key is only a candidate filter, not evidence of identity. Control characters and nonstandard whitespace in a new tracking request require correction/review.

## Review conflicts and limits

A possible duplicate returns an explicit HTTP 409 review message. It creates no new parcel or email, and does not reveal another customer's name, email, photo or package ID. The existing receive UI retains the photo, fields and intake ID after this error. Staff can review existing packages through their already-authorized workspace and saved-review/status flows.

There is no new reroute, reassignment or multi-piece override in this patch. A legitimate reused or multi-piece identifier with a different photo requires a separately reviewed operation. There is no blanket unique index on tracking. Never work around a conflict by changing customer, tracking or intake UUID merely to force a save.

Same-ID unattempted draft corrections remain supported. Attempted notifications retain their immutable payload and no-resend barriers. Existing accepted-event retries preserve later package states. The ordinary new destination route accepts `ORIGIN_RECEIVED`, `MIAMI_RECEIVED` or `IN_TRANSIT` into the planned active `DESTINATION` or `TRANSIT` facility. Later states require review rather than backward movement.

Exact-hash screening is not perceptual duplicate detection. Cropped/recompressed images have different bytes. Legacy arbitrary photo paths without retained digests are not backfilled by this change. The queries need production-size performance review and appropriate nonunique lookup indexes before a busy deployment. All intake writers must use the durable identity checks; drain older handlers before activation.

## Test files

- `arrival-warehouse-safety.test.mjs`: focused actual PostgreSQL-WASM tests for stage/route races, duplicate identities, canonicalization, old photos, tenant separation, explicit draft corrections and claim barriers.
- `arrival-conflict-ui.test.mjs`: current receive handler retains its input and displays a generic duplicate conflict.
- `arrival-safety-harness.mjs`: synthetic fixture, reserved `example.invalid` recipients, in-memory Storage and immutable fake provider records. It has no live transport.
- Existing workflow, PostgreSQL, saved-review and customer integration suites retain their behavioral expectations. Independent scenarios now clear their synthetic parcel rows so a reused test image is not mistaken for a second physical parcel; tests of retries continue using their same saved ID.

Run the PGlite suites after the existing pinned `npm ci --prefix parcel-snap-customer/tests/sql-runtime --ignore-scripts --no-audit --no-fund`:

```
node --test parcel-snap-customer/tests/arrival-workflow.test.mjs parcel-snap-customer/tests/arrival-postgres.test.mjs parcel-snap-customer/tests/arrival-review.test.mjs parcel-snap-customer/tests/arrival-warehouse-safety.test.mjs parcel-snap-customer/tests/arrival-conflict-ui.test.mjs
```

The customer integration suite additionally uses the already-pinned OCR runtime and English language data. A separate private baseline recorded 200 offline workflow cases with nine safety failures; the unchanged expectations pass against this candidate. That is not a camera accuracy rate or proof of real email delivery.

## Native CI gate

The existing `native-postgres` job remains the only prepared native route. Keep its official disposable PostgreSQL 17 service, fixed loopback binding, explicit synthetic DB/user/port opt-in, fresh-schema assertion, three independent backend IDs and unchanged native configuration guard. Do not execute it through a local socket/TCP workaround.

The adapted native suite isolates each synthetic scenario, then adds concurrent different-UUID photo/tracking collisions, a visible identity advisory-lock wait and a package-row wait where another connection commits `DELIVERED`. It also checks the final destination assignment contract using an independently authored stub, not a production-schema copy.

The existing command remains:

```
node --test parcel-snap-customer/tests/native-postgres/native-concurrency.test.mjs
```

Syntax/static review and PGlite results do not establish these independent-connection outcomes. The new native cases must pass in authorized CI before claiming this gate is met. No production migration, deployment, storage upload, real message or new credential is part of this patch.
