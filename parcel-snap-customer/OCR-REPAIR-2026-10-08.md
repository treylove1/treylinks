# Parcel Snap OCR/intake repair — 2026-10-08

Previous source: 24671f80f24e427fcba7cd33c84c663555b1229c. Frozen branch: backup-2026-10-08-parcel-ocr.
Backend before: parcel-snap-portal v17; external saved backend rollback archive: Parcel-Snap-Backend-Before-OCR-Fix-2026-10-08.zip.
Backend after: parcel-snap-portal v18, JWT verification retained.

Changes: visible extracted label text, name/address/tracking/email summary, honest missing-email status, label corner straightening with raw recovery crop preserved, timing from photo selection including preprocessing, automatic intake for strong directory matches only, one send/save per photo selection, client intake UUID and server duplicate protection, OCR text included in customer arrival email. A photo is never auto-routed using an unconfirmed printed email address. Unknown/ambiguous recipients require directory confirmation.

Verification: JS syntax; existing parser, matcher and OCR architecture checks; real warm Tesseract/canvas clean-label OCR plus 100-customer directory test at 0.4s on this server; mocked missing-email, stale-photo and duplicate-intake/mail tests. These tests do not send a real email.

Limitations: the supplied blurred screenshot still does not yield the name correctly using local OCR. The optional Cloudflare vision function is unconfigured. No claim of subsecond correctness for that screenshot, cold startup or Samsung S10. Browser download failed; no full browser/account/device acceptance completed. Actual email delivery not tested during repair. Existing provider account is configured; no new paid services or keys provisioned.

Local test: node parcel-snap-customer/tests/photo-intake-flow-test.cjs (requires installed tesseract.js, canvas and local English traineddata); node parcel-snap-customer/tests/backend-intake-test.cjs. Backend rollback: redeploy the archived v17 source with verify_jwt=true. Frontend rollback: restore files from frozen branch; avoid force-pushing unrelated newer changes.
