# Parcel Snap repair checkpoint — unmarked recipient recall

Date: 2026-10-08 (America/Nassau)

## Repository state

- Repository: `treylove1/treylinks`
- Repair branch: `parcel-snap-camera-readiness-20261008`
- Pre-edit remote HEAD and backup: `9c70007f1b26957740a1104684d6c9714b095d77`
- Local dated backup ref: `backup-parcel-snap-pre-unmarked-recall-20261008-1706`
- Scoped code/fixture commit: `a372f123cfddeb2f795801a1e2456cb976fcfa94`
- Production/main: unchanged

## Located failure and scoped correction

The branch fallback parser intentionally returned an empty destination for a label containing one otherwise valid but unmarked name/address block. That rule can explain a blank displayed name when hosted vision falls back to local OCR, although no claim is made that it caused the owner's specific photographed failure.

The correction recognizes a recipient only when the OCR text has exactly one plausible street address, one plausible name immediately above it, a city/state/postcode within the next three lines, no sender/return marker and no second address. The result is tentative: it is displayed as `Possible: <name> — please confirm`, remains `NEEDS_REVIEW`, does not select a customer, and cannot save or notify in camera-review mode. Existing explicit destination, alias, sender, multiple-address, tracking validation, leading-zero and full-frame protections remain in place.

## Reproducible verification

Actual local OCR was run with Tesseract 5.3.4 PSM 6 against the committed fictional 1600×1000 JPEG:

```text
tesseract parcel-snap-vision-test/fixtures/synthetic-label-unmarked.jpg <temporary-output> --psm 6
diff -u parcel-snap-vision-test/fixtures/tesseract-psm6-unmarked-20261008.txt <temporary-output>.txt
```

Result: PASS. OCR returned `JORDAN SAMPLE`, the complete fictional address including `UNIT 04`, and `1ZTEST000000000001` without an explicit `SHIP TO` marker.

Syntax and isolated suite:

```text
node --check parcel-snap-vision-test/app.js
node --check parcel-snap-vision-test/vision-client.js
node --check parcel-snap-vision-test/barcode-reader.js
node --check parcel-snap-vision-proxy/worker.mjs
node --test parcel-snap-vision-proxy/*.test.mjs parcel-snap-vision-test/*.test.mjs
```

Result: PASS — 40 tests, 0 failures.

## Evidence boundary and deployed paths

- Actual image OCR: verified locally with the new fictional unmarked JPEG.
- Parser/customer-field behavior: verified in the current `readPackagePhoto` harness; tentative recipient displayed, no automatic customer selection, no writes.
- Full customer app: GitHub Pages deploy workflow runs from `main`; this repair branch is not automatically the public customer page.
- Vision-test app: branch source contains the review-only UI and production vision endpoint configuration, but the branch version is not the public Pages deployment.
- Scan-harness staging: the Cloudflare branch preview is a separate scan-only Worker path. It does not execute the full customer app's local fallback/customer matching UI.
- Real owner photo / physical phone: NOT VERIFIED in this iteration.
- Storage/email: NOT AUTHORIZED and NOT TESTED.

## Remaining limitation and next exact step

After CI succeeds for this commit, use one legitimate authenticated nonproduction phone session to photograph the committed fictional unmarked label through the intended staged full-app path. Record the displayed recipient, address, unit, postcode, tracking and authorization/inference/total timing. Do not save a parcel or send a notification. The protected automated-browser file chooser remains an unchanged runtime blocker and must not be bypassed or retried through credential extraction.
