# Additive-candidate CI checks

**This independently authored fictional contract schema does not prove full production compatibility.** It is intentionally not a reconstruction of the application schema. It contains only six tiny tables and the columns needed by the candidate migration and atomic claim query. It has no captured production metadata, application functions, private fixture, customer rows, actual photos, service credentials or provider traffic.

## Scope and execution boundary

The existing `native-postgres` job now has two matrix entries. Each entry gets a separate fresh `postgres:17.11` service with the same disposable name `parcel_snap_synthetic` and fixed loopback binding `127.0.0.1:55437`. The original native workflow suite remains unchanged. The new candidate suite never reads the original metadata-derived baseline fixture or old schema proposal.

The Docker binding check still runs before connecting. The candidate guard requires the explicit CI markers, exact disposable database/user/port, and rejects connection URLs, passwords and application service configuration. The suite verifies native PostgreSQL 17, four independent server PIDs, the expected database/user, absent application/Auth schemas and absent test roles before writing. Do not emulate GitHub's environment marker on a local executor or use a live database.

These tests deliberately create and mutate fictional roles, default ACLs, tables, indexes and data inside that disposable service. The explicit `BYPASSRLS` test role reproduces a hypothetical inherited grant hazard. It is never an instruction to alter any actual Supabase role, production ACL or account. There are no persistent volumes or application secrets.

## New assertions

- Missing ledger and incompatible request/review fields fail closed; the actual release candidate stays hard-paused even when its ordinary environment flag is true.
- A conflicting index and an unexpected default grant fail the transactional migration without leaving its earlier DDL behind.
- Successful migration preserves the fictional existing company row, existing table grants and default ACLs, while removing inherited service-role ledger access.
- The new ledger's native catalog shape must match the checked-in candidate-only JSON contract. This is a genuine fail-closed comparison, not a native-output rewrite of the expectation.
- Anonymous, authenticated and bypass-RLS service roles cannot select/update/delete the ledger. Service-role, arbitrary-role and column grants, disabled RLS and a bad contract marker invalidate capability.
- Stale contact and tracking reviews cannot acquire a claim or increment attempts.
- Two actual claim queries on independent sessions are both observed blocked by a held row lock, then produce one durable `SENDING` claim and one attempt. Reclaiming `SENDING` or `UNKNOWN` returns no claim.

The claim suite calls the actual repository's claim SQL. It never calls the portal bootstrap, Storage, the mail provider or inference. It tests neither delivery nor full arrival/warehouse allocation; the existing native suite remains separate coverage.

## Deno check

An additional job uses the official `denoland/deno:2.4.5` image and verifies the reported runtime version before running:

```sh
deno check --no-config --no-lock --node-modules-dir=none parcel-snap-customer/backend/portal.ts
```

`deno check` parses and type-checks the actual module graph without evaluating the portal module, so it does not start `Deno.serve`, create a database connection, retrieve service credentials or contact application services. No Deno runtime permissions or service secrets are supplied. Dependency resolution downloads official registry packages; this is not an offline step. No `deno run`, bundle execution, deployment, npm install lifecycle opt-in or check-error suppression is used.

The Deno image and existing PostgreSQL image are exact version tags, not verified immutable digests. The portal currently imports `npm:@supabase/supabase-js@2` without a checked-in Deno lock. The check intentionally examines that real source rather than substituting fabricated dependency declarations or a different SDK version. It is not a reproducibly locked deployment guarantee. Before a release, separately review the resolved dependency graph and immutable runtime/dependency pins; do not pretend those are established here. Deno checks the TypeScript entrypoint; the unannotated `.mjs` implementations retain their existing JavaScript inference/checking limits.

## Local evidence versus pending CI

Prepared locally: Node syntax checks, nine connection-free request/configuration tests, the existing public-safe portal routing smoke, workflow structural checks, and a supplemental PostgreSQL-WASM rehearsal using this same new fictional fixture. The WASM rehearsal verifies SQL/ACL/sequential-claim compatibility only, on PostgreSQL 18.3, not native PostgreSQL 17 or concurrent sessions.

**Native candidate execution and the official Deno type check remain pending on the exact published candidate commit.** Deno and a permitted native PostgreSQL service were unavailable locally. No local socket/TCP workaround, package download, live CI run, external write or deployment was performed for this preparation.

Safe connection-free command after combining this patch with its reviewed backend dependencies:

```sh
node --import ./parcel-snap-customer/tests/isolated-network-guard.mjs --test \
  parcel-snap-customer/tests/native-postgres/native-test-config.test.mjs \
  parcel-snap-customer/tests/native-postgres/candidate-review.test.mjs
```

## Requirements for an approved CI run

1. Obtain approval to publish the exact public-safe allowlisted backend/test changes to the existing repair branch and run CI. This file is not authorization. Do not push private source captures, rehearsal scripts, local evidence, dependency directories or archives.
2. Re-read the branch head and every workflow before updating it. Keep the existing draft PR. Do not merge to `main`, dispatch a Pages/deployment or unrelated OCR workflow, or change production services.
3. A pull-request update triggers the customer regression workflow. Its token is `contents: read`, checkout does not persist credentials, and no application service secrets or deployment environment are used. No separate workflow dispatch is needed. A pull-request job ordinarily checks GitHub's synthetic merge ref; record both the source head SHA and tested merge/checkout SHA.
4. Use only GitHub-hosted standard Ubuntu runners and the disposable services shown in the workflow. Dependency/image downloads and CI resources require the owner's approved CI scope. Recheck repository visibility/billing before making any zero-cost claim; no runner-cost guarantee was verified here.
5. Record final results for regression, both native matrix entries and Deno on the exact candidate. Failures are blockers. Never skip failed type checks, rewrite the ledger contract merely to fit drift, or substitute WASM results for the pending native gate.

The observed Pages deployment workflow triggers for matching `main` pushes or explicit dispatch and uploads the repository root. A later merge can therefore publish repository files as a website. The observed cloud OCR workflow also triggers on matching `main` pushes/dispatch. A repair-branch push alone does not match those triggers. External app/webhook deployment settings are outside this source-only assurance and must be checked separately if applicable.

Passing this CI still does not establish complete production-schema/RLS compatibility, deployed Supabase Auth/JWT, import bundling, real Storage permissions/bytes, warehouse behavior, real delivery, billing safety, rollout drain, rollback, scale or camera accuracy. Those gates remain separate.
