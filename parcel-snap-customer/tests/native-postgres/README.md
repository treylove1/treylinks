# Synthetic native PostgreSQL CI proposal

This suite is prepared for a fresh GitHub Actions PostgreSQL service. It has been syntax-checked; pure configuration guards have been run without a connection. Independent-connection results remain pending until the native job passes on the exact candidate commit. No local native-socket workaround is authorized or used.

## Data and runtime boundary

- Official image: `postgres:17.11`; pinned test-only client: `postgres@3.4.7` with its npm lockfile and install scripts disabled.
- Fresh database `parcel_snap_synthetic`, user `postgres`, loopback-only `127.0.0.1:55437`, service-local trust authentication, no saved volume or secrets.
- Reuses only the repository's unchanged, already-public `arrival-baseline-fixture.sql` and existing ledger proposal. That minimal baseline was metadata-derived; it is not an independently authored full production schema.
- Inserts only fictional records. Storage and mail are in-memory capture functions. A newly authored trivial assignment stub checks the final stage/location response contract without reproducing warehouse allocation.
- No newly captured schema metadata, full-schema fixtures, live configuration or private staging files are included.

The workflow verifies Docker's actual loopback port binding before running tests. `nativeTestConfig` refuses arbitrary hosts, connection URLs, passwords and external database environment variables. The native suite also checks PostgreSQL 17, the expected database/user, and absence of existing application/Auth schemas before making changes.

The CI-only environment marker is an explicit execution guard, not cryptographic proof. Do not set GitHub markers locally to bypass a socket restriction. The local Unix-socket configuration branch is not exercised by this release; no local runner or binary installer is included.

## Checks

The pure guard command performs no connection:

```sh
node --import ./parcel-snap-customer/tests/isolated-network-guard.mjs --test \
  parcel-snap-customer/tests/native-postgres/native-test-config.test.mjs
```

Only the actual GitHub job supplies `GITHUB_ACTIONS=true`, `PARCEL_NATIVE_CI_DISPOSABLE=true`, port `55437`, database `parcel_snap_synthetic` and user `postgres`, then runs `native-concurrency.test.mjs` without the all-socket isolation guard.

Prepared assertions verify three independent backend PIDs, observed advisory-lock blocking, overlapping complete arrivals and atomic claims with one winner, invalid-input preflight rejection and same-ID recovery, persistent UNKNOWN blocking, and final persisted stage/location. The preflight-rejection case does not exercise database rollback after a write. These checks do not establish native post-write transaction rollback, Supabase pooling, production migration/RLS compatibility, real Storage behavior, live mail delivery or camera accuracy.

Official references: [GitHub PostgreSQL service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers), [official image catalogue](https://github.com/docker-library/official-images/blob/master/library/postgres).
