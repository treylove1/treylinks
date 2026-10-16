# Parcel Snap high-volume intake checkpoint — 2026-10-16

## Goal
Warehouse flow: photo/gallery selection starts OCR automatically; printed fields populate; a sufficiently strong exact saved-customer match can proceed to automatic receive/email without an employee pressing Read or Send. Ambiguous evidence must stop for review.

## Restore point
- Pre-pass backup branch: `backup/parcel-snap-before-high-volume-auto-20261016`
- Backup SHA: `4acbc72128fa3e312ecc6ece0d4f783b68c54beb`
- Work branch: `parcel-snap-high-volume-auto-20261016`

## Changes in this pass
- Preserved the one-full-frame-prediction-per-worker OCR boundary.
- Added pre-warming of the next verified Paddle OCR worker/model so initialization can happen before the next package photo.
- Exposed reader `warm()`/`dispose()` support while preserving photo/evidence generation guards.
- Kept camera/gallery auto-read; manual Read remains retry-only.
- Added conservative printed carrier extraction.
- Added conservative printed weight extraction only when the label contains an explicit WEIGHT/WT value and unit; no invented weight.
- Added high-volume post-read flow: unique recipient block -> bounded tracking -> exact strong directory match -> saved customer selection -> confirmation -> automatic receive/email path when the commercial arrival gate is enabled.
- Exact auto-match policy: score >= 0.97, margin >= 0.08 when there is a runner-up, and evidence reason must be `exact-line` or `compact-exact`.
- Ambiguous/missing recipient, tracking, address, or customer match stops for human review.

## Current release gate
The public customer build remains commercially paused for package writes/email. The frontend auto-flow is staged, but `BUILD.writesEnabled` remains false and the deployed Supabase arrival capability also remains PAUSED. Do not claim automatic production email is enabled yet.

## Stored customer check
The production directory already contains an ACTIVE `Trevon Humes` record with the saved business email and aliases for `Trevon Humes`, `Your Electronic Needs`, and `Your Electronic Needs / Trevon Humes`. The worker should not type the email per package; the backend should use the saved customer contact after a verified match.

## Automated proof
Workflow: `Parcel Snap High Volume Auto`.
Run 38970443353 passed syntax checks, high-volume auto-flow regression, existing customer matcher regression, and tenant/onboarding regression.
This is code/architecture proof only, not a real Samsung photo latency or optical-accuracy measurement.

## Next exact step
Deploy the green speed/auto-fill branch to the read-only public test URL, test real Samsung camera/gallery labels, record photo-to-fields timing and field correctness, then enable the reviewed arrival write/email release only after the exact-match behavior is confirmed. Do not weaken customer-match or duplicate-email guards to make a demo pass.
