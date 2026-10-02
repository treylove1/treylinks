# Parcel Snap OCR — Claude Review Update — 2026-10-02

## Why I need a second set of eyes
Implementation has taken too long because I kept trying to improve generic browser OCR instead of fully embracing the simpler warehouse-specific rule:

**Known customers already have saved names/business aliases. The system should primarily identify which known alias appears on the package, not perfectly reconstruct every line of the label.**

The user has repeatedly demonstrated a Roadie label where the person name is only partly readable but the business alias is much clearer.

## Latest real-phone failure
On Samsung/Android, the current portal showed:
- No known customer matched
- ~5.2 seconds first result
- label crop around 1174x1500

The visible label includes a Roadie shipping label and the saved alias "Your Electronic Needs".

Expected:
- If "Your Electronic Needs" is saved as a LABEL alias for Trevon Humes, the package should route to Trevon Humes and use Trevon's saved email.
- It should not require the full personal name to be OCR-perfect.

## Simplified target architecture
1. Customer directory stores:
   - customer/person/business name
   - email
   - phone/WhatsApp
   - label aliases
   - mailbox/account/customer codes
2. Photo selected.
3. Show photo instantly.
4. Crop likely label.
5. Fast OCR worker reads once.
6. Known-alias matcher searches OCR text fuzzily across broken spacing/misspellings.
7. Sender/return-address blocks are excluded from global alias detection.
8. If confident MATCHED -> select customer immediately.
9. REVIEW/AMBIGUOUS -> show possible customer, require confirmation.
10. NO_MATCH -> ask for name/email; save the entered label alias for next time.
11. Background recovery worker can continue improving OCR without blocking the next package.
12. On confirmed receive -> save photo/tracking/facility and send arrival email.

## Claude suggestions already merged
- Two Tesseract workers: fast + recovery.
- Separate recovery worker so package 2 doesn't wait behind package 1.
- Recovery termination when a newer package starts.
- PSM/OEM tuning.
- Gentle first-pass preprocessing.
- Deskew before first OCR pass.
- Adaptive binarization in recovery.
- True raw crop available to recovery.
- PSM 6 / 11 / 4 / 3 recovery sequence.
- ±6° only as last resort.
- Authoritative ParcelSnapKnownMatcher.
- MATCHED only auto-selects; REVIEW/AMBIGUOUS do not.
- Generic sender/recipient context instead of YEN-specific regex.
- Stale-photo protection.
- Background-match visual highlight.

## Additional changes made after the user's latest failure
- Added global fuzzy matching for LABEL aliases and stable business/customer codes across the entire non-sender OCR text.
- This handles broken spacing and OCR errors such as:
  - "Y0ur electr0nic / need5"
  - "Your electonic neads"
- Added a safety rule so exact long business names beat fuzzy shorter names.
- Excluded RETURN ADDRESS / SHIP FROM / SENDER lines from global alias matching.
- Direct matcher regression now passes locally.

## Current known identity mapping in the owner's test workspace
Trevon Humes:
- PERSON_NAME: Trevon Humes
- LABEL: Your Electronic Needs
- LABEL: Your Electronic Needs / Trevon Humes
- saved email: owner/test email in Parcel Snap

This means "Your Electronic Needs" alone is intentionally enough to route to Trevon Humes in this tenant.

## What still needs simplification / review
Please review the live OCR engine and answer these specifically:

1. Is Tesseract still the wrong primary choice for Android warehouse labels?
2. Is there a simpler client-side approach for **known alias spotting** that avoids full OCR?
3. Would you use targeted OCR/recognition only for saved aliases rather than general OCR?
4. Is the current label-crop + deskew pipeline overengineered?
5. Would raw crop + PSM 11 or PSM 6 outperform the preprocessing stack on Roadie/thermal/typewriter labels?
6. How would you get first useful identity below ~2 seconds on a mid-range Android phone?
7. Is a compact on-device model (PaddleOCR/ONNX/ML Kit-style) more suitable than Tesseract.js for this?
8. Can QR/barcode identity be prioritized before OCR when present?
9. What parts of the current engine should be deleted rather than improved?
10. Please propose the smallest reliable architecture that can process 100 packages in a warehouse without blocking.

## Files to review
- parcel-snap-customer/OCR-ENGINE-INDEPENDENT-REVIEW.js
- parcel-snap-customer/known-customer-matcher.js
- parcel-snap-customer/app.js
- parcel-snap-customer/vision-client.js
- parcel-snap-customer/tests/known-customer-matcher-test.mjs
- parcel-snap-customer/tests/ocr-speed-architecture-test.mjs

## Acceptance test before production
Do not call this finished until all pass on the actual phone:
1. Roadie label: "Your Electronic Needs" -> Trevon Humes.
2. Roadie label: partial Trevon + Your Electronic Needs -> Trevon Humes.
3. Mark Roberts -> Mark Roberts.
4. Felida Hughes -> Felida Hughes.
5. Jalida Hughes -> Jalida Hughes.
6. Business-only label -> correct business/customer owner.
7. Unknown label -> no invented match.
8. Return-address business -> never chosen as recipient.
9. Package 2 starts immediately even if package 1 recovery is still running.
10. Arrival email is sent to the matched customer's saved email after package save.
