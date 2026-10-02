# Parcel Snap Checkpoint — 2026-10-02

## What is live / completed
- Customer/business recognition directory supports PERSON and BUSINESS records plus aliases.
- Trevon Humes is stored with the label alias "Your Electronic Needs".
- A clear "Your Electronic Needs" label can route to Trevon Humes when it is stored as that customer's LABEL alias.
- New-customer intake now saves the entered label alias with the customer record.
- Fast OCR path uses a reusable Tesseract worker.
- Recovery OCR uses a separate worker so it does not block the next package.
- Directory matcher is the authoritative identity decision.
- MATCHED auto-selects; REVIEW / AMBIGUOUS do not.
- Label crop, gentle grayscale/auto-levels, deskew, adaptive recovery, barcode detection, and background OCR recovery are integrated.
- Vision runs in parallel and uses the same directory matcher.
- New business onboarding asks about locations, employees, volume, storage, returns, inspection, delivery, staff, and notification needs.
- Owner can preview new-business onboarding without overwriting the real YEN / Alpha Omega workspace.

## Current intended package workflow
1. Add customer once: name + email + optional phone/WhatsApp.
2. Add any label names/business aliases that may appear on packages.
3. Worker takes package photo.
4. Parcel Snap reads the label and matches any saved alias to that customer.
5. Package photo and tracking are saved.
6. Package is assigned to the receiving warehouse and storage location.
7. Arrival email is sent to the saved customer email.

Example:
- Customer: Trevon Humes
- Email: saved email
- Label alias: Your Electronic Needs
- OCR sees: Your Electronic Needs
- Result: Trevon Humes customer record is selected and the arrival notice goes to that record's email.

## Claude/review changes already merged
- Two OCR workers: fast + recovery.
- Recovery cancellation when a newer package starts.
- PSM/OEM tuning.
- Gentler first-pass preprocessing.
- Deskew before first OCR pass.
- Adaptive-binarization recovery.
- True raw-crop recovery.
- Authoritative ParcelSnapKnownMatcher decision.
- Generic sender/recipient context instead of hardcoded YEN boost.
- Business/person identity hierarchy.
- Stale-photo protection.
- Background-match visual highlight.

## Still to verify next session
- Real Android timing on the Samsung phone: first result latency and full background-recovery latency.
- Real Roadie label cases:
  1. Your Electronic Needs only.
  2. Your Electronic Needs + partial Trevon.
  3. Unknown person/business.
- Confirm the exact Roadie QR/barcode payload and whether it contains useful package identity data.
- Confirm actual live receive action sends the arrival email for the matched alias/customer.
- Confirm the package record stores the correct photo, customer, tracking number, facility, and assigned shelf/bin.
- Stress-test repeated package intake so package 2 is never delayed by package 1 recovery.
- Continue independent review of OCR-ENGINE-INDEPENDENT-REVIEW.js.
- Consider whether server-side multimodal vision should become primary after local OCR proves stable enough.

## Important rule
Do not claim the OCR is finished or production-ready until the real Roadie photo and multiple different customer/business labels pass on the actual phone at acceptable speed.
