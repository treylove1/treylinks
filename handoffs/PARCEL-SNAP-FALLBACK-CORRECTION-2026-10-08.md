Parcel Snap fallback correction

Starting remote checkpoint: eeb3d079ce71abb47a2c6797481b910757f6e344.
Backup branch: backup/parcel-snap-before-fallback-20261008-1950.

Scoped repairs in parcel-snap-vision-test/app.js: destinationBlock and destinationIdentity restrict extraction and directory matching to identifiable destination evidence; ambiguous unmarked sender/destination stays empty. guessTracking accepts supported carrier formats instead of generic long words. Barcode input is validated too. Missing/unverified tracking is empty and flagged for review. Numeric strings remain strings, preserving leading zeroes. Recovery uses the same destination gate. Existing full-frame geometry and review-only receive/email guards remain.

vision-client.js validates tracking extracted from barcode URLs/JSON rather than trusting the payload. CI includes the new fallback-extraction.test.mjs.

Local verification: all 31 Node tests pass (existing 22 plus 9 new), syntax checks pass and git diff --check passes. Tests run the actual current readPackagePhoto and runDeepRecovery declarations with stubbed OCR/canvas input, the real known customer matcher, and the existing save/auto-notification guards. No network, real customer access, package writes or email. These are extraction regressions, not photograph OCR, phone accuracy or email acceptance.

Remaining acceptance: deployed authenticated clean/blurred scan and rendered fields, varied phone photos, and expressly authorized nonproduction storage/email tests. No production changes or main merge in this checkpoint. Do not restart OCR from scratch or remove authentication to test.
