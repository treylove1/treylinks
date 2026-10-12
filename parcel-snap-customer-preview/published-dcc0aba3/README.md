# Parcel Snap fictional preview: frozen source

This source bundle reproduces the three modules uploaded as Parcel Snap preview version 10 on 2026-10-10.

- Existing Worker: `parcel-snap-vision`
- Uploaded version: `dcc0aba3-0d30-46a0-8181-3f74544392c1`
- Verified version URL: https://dcc0aba3-parcel-snap-vision.humestrevon.workers.dev
- Upload was version-only with `deploy: false`; production traffic was unchanged.
- The uploaded modules were read back and matched the frozen module hashes byte-for-byte.

The six customer source files here are the exact originals used for that uploaded version. They were reconstructed by reversing the reviewed build transformations and verified against their locked SHA-256 hashes. This snapshot intentionally excludes later customer-app changes.

## Reproduce locally

Use Node.js 22 or newer. From this bundle's root:

```sh
cd parcel-snap-customer-preview
node test.mjs
node --check worker.mjs
node --check preview-policy.js
node --check preview-bootstrap.js
node --check dist/public/app.js
node --check dist/public/vision-client.js
```

`node test.mjs` runs a fresh deterministic build before all 29 mock tests. It uses Node built-ins, without dependency installation, network calls, credentials, authentication, model calls, or publication. Generated output goes to the ignored `parcel-snap-customer-preview/dist/` directory. It is intentionally absent from this source bundle.

Expected generated SHA-256 values:

- `dist/worker.mjs`: `9fe7f0808b15390ac41b32ab13ce920c34b363a6970e077933e70be6f943057f`
- `dist/assets.mjs`: `c0df274976b39b07f8fb70208944ca8285cad889ca3ae91fe50f406b9306e589`
- `dist/preview-policy.js`: `e71410fd1e2f8f7aea718208a74fea1a75185d4dc9a039b6556a2821c596e747`
- `dist/MANIFEST.json`: `39594d181301fef09ae6d0dd497d7a3a0365b7880e8d58302d71a4135603a390`

`SOURCE-MANIFEST.json` lists every included source/test/document path, its SHA-256 hash and byte size, plus expected generated outputs. Do not update source locks automatically to accommodate later app changes; that would create a different preview version.

## What this preview does

It presents the existing customer UI with a permanent FICTIONAL banner. The original photo/OCR/recognition/review/receive/arrival handlers are preserved. Only transport constants, the auth-client factory and safety presentation are substituted, with exact transformations recorded in the generated manifest.

- Existing-user sign-in uses the existing Supabase SDK directly. No signup, staff joining, invitations, onboarding, billing, or management writes are allowed.
- Every fixture workspace/operation requires real read-only entitlement verification and both preview-only rate-limit checks. Blank or forged tokens do not unlock a workspace.
- Only fixed fictional customers, warehouses and packages are returned. Real customer or package data is never loaded.
- Browser requests strip photos, OCR, contact details, tracking and notes to an allowlisted action plus fictional IDs. Captures and simulated fixture changes remain in tab memory. Persistent local/session storage is blocked.
- Real writes and notifications are impossible in this runtime. The Worker has no database, storage, email or AI binding, and its only external request is the fixed read-only authorization endpoint.
- Hosted inference is hard-disabled in the browser and Worker before any model call. The inherited provider secret is unused and is never retrieved by this code.
- The existing rate-limit binding uses distinct preview aggregate and token-digest keys. Missing or denied limits fail closed before auth.
- Strict response headers/CSP and browser transport guards block production portal/data/model endpoints. Do not serve generated static assets alone: that would omit the Worker auth/CSP boundary.

## Test coverage and limitations

The bundle passes 29 mock tests covering full-app boot, rejected/fake auth, role checks, fixture allowlists, body limits, origins, throttles, disabled inference, network restrictions, persistent-storage denial, unchanged actual photo/receive/arrival handlers, and deterministic transformations.

Authentication, image decoding, OCR output and network calls are mocked in these tests. The published landing/login screen and fictional banner were observed, but signed-in workspace access, physical-camera accuracy, browser/CSP/OCR compatibility and live model accuracy have not been established by this bundle.

Simulated receives/arrivals deliberately return `photo_saved: false`, `persisted: false`, `notifications_sent: 0` and `SIMULATED_DISABLED`. The unchanged app retains its photo and review fields. This tests the safe retained-photo/review path, not successful persistence or email delivery. Simulated package overlays become visible on the next workspace reload.

The original Supabase CDN remains a major-version `@2` reference. Tesseract main/worker are pinned to 6.0.1 and core to 6.0.0. Dependencies are not vendored; a permitted browser session downloads them and English OCR language data. No model request or real notification is enabled by environment configuration alone.

## Publication boundary

This bundle contains no uploader or deployment automation. `metadata.proposal.json` is retained because a security test verifies the intended inherited bindings; it contains public configuration and existing resource/version identifiers, with no secret values or access tokens.

Any future publication requires separate review and authorization. Use the existing Worker principal and a version-only upload with production deployment disabled. The new Workers version API supports pinned binding inheritance; the classic version-upload route does not accept the pinned UUID format used here. Do not retrieve/re-enter secrets, create credentials, substitute a new Worker, or change production traffic to reproduce this build.

## Intentionally excluded

- Generated `dist/` artifacts (recreated locally by the build)
- Backend/proxy source and the wider repository
- Private evidence, tool responses, connection metadata and logs
- Real or synthetic photo files, binary language data and vendor bundles
- Credentials, secret values, tokens, environment files or authentication state
- Git metadata, caches and dependency directories
- Later customer-app email-status changes

Only the explicit source/test/document files listed in `SOURCE-MANIFEST.json` belong to this bundle.
