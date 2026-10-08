# Parcel Snap — Camera Readiness Gate (October 8, 2026)

## Freeze scope
No new dashboards, billing flows, automatic email, or automatic intake enhancements until the reader is independently measured. The changes in this branch are **not deployed** and do not claim commercial reliability.

## Verified code-level repairs in this branch
- Display completed AI transcription without waiting for the independent QR/barcode decoding task.
- Do not overwrite differing model tracking with barcode text; show a verification conflict.
- Do not treat arbitrary QR content as a tracking number.
- Preserve up to 2400px of full-frame image detail while keeping photo upload under the Worker size limit.
- Correct each Cloudflare model's generation-token parameter (`max_completion_tokens` for Gemma 4, `max_tokens` for Llama 4 Scout).
- Guard legacy local OCR too: no silent customer selection/automatic save during test mode.
- Require human confirmation before package saving/customer notifications in the vision test intake.
- Measure authorization time, inference time, total Worker time, and how many vision models were attempted.
- Include repeatable mock-provider regression tests and an automatic draft-PR GitHub Actions workflow (no paid API calls, no real customer labels).

## Ground-truth acceptance test (not yet performed)
1. Collect at least 100 consented shipping-label photos from real phones. Include clear labels, tilted images, mixed light, partial obstruction, multiple visible barcodes, and distinct couriers.
2. Store photos **privately**, never in the public GitHub repository or screenshots containing private customer data.
3. Record independently verified recipient, street, unit, city, postal code, carrier, and exact tracking number for each label. Indicate unreadable fields explicitly.
4. Process each through the deployed camera test; record photo-to-visible-readout seconds, AI model attempts, mismatches, missing fields, false customer matches, and manual corrections.
5. Proposed pilot gate: 99% exact tracking and recipient transcription on *readable* labels; **zero** unreviewed wrong-customer assignments or notifications; ambiguous scans clearly flagged. 100 samples alone cannot prove a low long-term error rate.
6. Record p50 and p95 latencies; set speed targets from the baseline, aiming for a quickly displayed readout rather than delaying for barcode scans.
7. Separately verify photo storage, correct company/customer isolation, and real email delivery with authorized test accounts.
8. Only consider automatic intake after accuracy, security, and notification gates pass on repeated independent runs.

## Local tests
`node --test parcel-snap-vision-proxy/worker.test.mjs`

GitHub Actions workflow: `.github/workflows/parcel-snap-camera-readiness.yml`. The presence of CI configuration is not proof that a GitHub runner executed it.

These are synthetic unit/integration-mock tests, **not** live Cloudflare inference or actual image recognition benchmarks.

## Operations / deployment
- Base repository: `treylove1/treylinks`
- Branch: `parcel-snap-camera-readiness-20261008`
- Worker: `parcel-snap-vision-proxy/worker.mjs`
- Client: `parcel-snap-vision-test/vision-client.js`
- Do not merge or deploy before a controlled authenticated pilot and a production-safe login test. Use 100 private photographs for the first measured baseline and a wider independent set before approving unattended operations.
- Never commit API credentials, real addresses, customer identities, or signed access tokens.
