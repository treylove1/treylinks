# Hosted reader repair: local proposal and verified deployment gap

## Result

The existing production Worker uses **OpenAI gpt-4o**, not Cloudflare Workers AI. The local repair preserves that provider and the already stored Worker secret. It adds a strict legacy/Worker response adapter and replaces the scan's mutating workspace preflight with a separately verified read-only authorization function. Nothing in this repair has been uploaded, deployed, or tested against an actual model.

The customer page still calls its original Supabase `parcel-snap-vision` endpoint. The pure adapter is safe to integrate now. The URL must not be changed until the updated Worker is reviewed, deployed with the intended provider, and passes an authorized real-user scan. No healthy inference route has yet been proven.

## What is actually deployed

Read-only Cloudflare control-plane checks on October 9, 2026 verified:

- Worker: `parcel-snap-vision`, account `30e9da5770a97e88b866786e979164b8`.
- Deployment `ec5f7010-0f66-4265-b27f-c2444b2b1a0c`, created October 8 at 14:44:31 UTC.
- Version `2c980fc3-0c50-4267-a624-cf3fa7177ffe` (number 9) receives 100% of traffic.
- No `AI` binding and no `VISION_PROVIDER` variable. The deployed source defaults to OpenAI; `OPENAI_MODEL` is `gpt-4o`.
- The `OPENAI_API_KEY` secret binding exists. Its value was never retrieved. Existence does not prove validity, credits, quota, or model access.
- Exact browser origin: `https://treylove1.github.io`. Rate limit: 30 requests per 60 seconds, namespace `10808`.
- The live source still calls `parcel-snap-portal` with `action: workspace`. That can initialize eligible owners' business setup and is unsuitable as a read-only scan preflight.

The repository's original `wrangler.toml` selects Cloudflare AI and describes a different configuration from the live Worker. Do not deploy that file as a routine production repair. `wrangler.production.toml` is a separate local proposal matching the verified public production configuration and explicitly preserving OpenAI. It contains no secret values. Before deployment, inspect the change preview and ensure the existing OpenAI secret is retained without reading or copying it.

The deployed-source snapshot and structured evidence are in `evidence/hosted-reader-deployed-source-20261009.mjs` and `evidence/hosted-reader-audit-20261009.json`.

## Authorization contract verified from deployed source

Supabase `parcel-snap-camera-auth-staging-20261008` is ACTIVE, version 1, with `verify_jwt=true`. The retrieved bundle hash is `9a7f588111bf45fa58da4dd070a0e64624b90e5677217fac4ec4853e7d144612`; its two source files match the local `auth-staging` files.

- The pinned `@supabase/server@1.9.1` user-auth wrapper supplies verified user claims.
- Tenant selection comes from that user's first active membership, never request JSON.
- All authorization SQL executes in a read-only transaction. It only selects membership, subscription, setup, and facility authorization metadata.
- ACTIVE/TRIALING entitlement is required; a supplied expiration must be in the future.
- OWNER/MANAGER require completed business setup.
- STAFF/WAREHOUSE require an active same-company OPERATE assignment on an active facility.
- Other roles fail closed. Only ACTIVE and role are returned, with no customer/package data.

The endpoint name is **not an immutable version URL**. Recheck version and bundle hash before any future deployment; stop and review if they differ. Source and mock checks do not establish successful execution for a valid signed-in user.

## Local repair and tests

- `vision-result.js` converts modern `tracking` and structured address fields to the customer UI's legacy names while preserving unit designators and leading zeros. Legacy results remain supported. Numeric/overlong fields are rejected rather than silently repaired. Conflicting tracking readings are withheld with a review warning. Every result requires human review.
- The Worker uses the read-only auth endpoint for both production and staging. It never dispatches a workspace, parcel save, or notification action. Missing auth/rate-limit bindings, failed auth, and unavailable/malformed auth responses fail closed before inference.
- CORS accepts the existing public `apikey` compatibility header from the configured origin. That header grants no authorization; a valid bearer session is still required.
- The OpenAI branch preserves its model and 1,000-output-token limit, detects truncated responses, and returns warnings, attempt count, and timings. It does not switch provider or automatically retry OpenAI failures.
- All 45 focused adapter/Worker/auth tests passed with mocked provider and authorization calls. JavaScript syntax and production TOML parsing also passed. The log is `evidence/hosted-reader-mock-tests-20261009.log`.

## Remaining live-test gate

The task's cloud-browser attempt to reach the Worker was blocked. This repair did not retry or bypass that denial. No authenticated Worker scan, actual image transcription, credential validity, billing availability, or physical-phone accuracy has been proven.

After authorized deployment and a supported authenticated session are available, a small test can preserve the current provider: at most three fictional-label images, stop on the first failure, no retry loop, no customer-label uploads, no package saves or notifications. Obtain a one-time **US$0.05 maximum OpenAI inference budget** first. Current [gpt-4o pricing](https://developers.openai.com/api/docs/models/gpt-4o) is $2.50 per million input tokens and $10 per million output tokens. Bound image dimensions and request text using the [official image-token rules](https://developers.openai.com/api/docs/guides/images-vision). This proposed test does not require creating or revealing credentials or buying a subscription. Any missing credit or rejected credential is a separate blocker, not authorization to change billing or authentication.

## Rollback checkpoints

No rollback is currently needed because production was not changed. If a later approved deployment fails, inspect the then-current deployment before acting. The verified prior Worker version is `2c980fc3-0c50-4267-a624-cf3fa7177ffe`; restoring it would also restore the old workspace-auth side effect, so disable the new customer routing before considering a reviewed rollback. Keep the original customer Supabase route until the new route passes its gates. Do not delete or modify the existing read-only auth function as part of rollback.

Source checkpoints: [repair branch Worker](https://github.com/treylove1/treylinks/blob/4c831dc297360db22ea49e4d7336306c4faccc7b/parcel-snap-vision-proxy/worker.mjs), [existing read-only auth source](https://github.com/treylove1/treylinks/blob/4c831dc297360db22ea49e4d7336306c4faccc7b/parcel-snap-vision-proxy/auth-staging/authorize.mjs).

Mixed-schema address review: matching legacy/street components retain a separately read unit in the displayed address. Bare numeric units never deduplicate against a street number. Contradictory embedded/separate units preserve the original street/legacy reading and retain the separate candidate with an explicit warning; they are never concatenated into a fabricated address. Five added unit regressions pass.
