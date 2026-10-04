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


---

# Update — 2026-10-03 Night Stop

## Work completed today
- Researched PackageX public architecture and documented the key design correction:
  - Parcel Snap is not "an OCR app".
  - Photo/vision/OCR/barcode are evidence.
  - The real engine is: evidence -> match known recipient/customer/business -> run the tenant's configured workflow.
- Saved architecture notes:
  - `parcel-snap-customer/PACKAGEX-ARCHITECTURE-NOTES-2026-10-03.md`
- Changed package intake routing so warehouse/destination selectors are hidden when the logged-in employee/company profile already determines the route.
  - Single valid receiving facility -> auto-selected.
  - Single valid destination -> auto-selected.
  - Dropdowns appear only when there is a genuine operational choice.
- Updated Supabase portal workspace response to provide destination-route options separately from worker facility scope.
- Added fuzzy known-alias matching across noisy OCR text while excluding sender/return-address blocks.
- Added safety logic so exact longer business identities beat fuzzy shorter ones.
- Added support for mapping a label alias such as "Your Electronic Needs" directly to a person record such as "Trevon Humes" and that person's saved email.
- Confirmed customer directory model supports:
  - person/business name
  - email
  - phone/WhatsApp
  - label aliases
  - mailbox/account/customer codes
- Added targeted recipient-line OCR recovery:
  - Tesseract returns layout blocks/line bounding boxes.
  - Parcel Snap locates a likely destination street-address line.
  - It then OCRs the narrow strip immediately above that address, where recipient/business text normally appears.
  - This is intended to be faster and more logistics-specific than rereading the whole label repeatedly.
- Latest OCR test for the targeted recipient-line change passed.

## Current intended tenant workflow
1. Business completes needs assessment before operational use.
2. Parcel Snap creates the business's tailored locations, roles, staff access, and enabled features.
3. Employee login already knows assigned facility/permissions.
4. Employee takes a package photo.
5. Parcel Snap reads barcode/QR/OCR/vision evidence.
6. Parcel Snap matches against the business's known recipient directory.
7. MATCHED -> customer selected automatically.
8. REVIEW/AMBIGUOUS -> suggestion shown; employee confirms.
9. NO_MATCH -> ask name/email once and save label alias for next time.
10. Package photo/tracking/facility/storage location saved.
11. Arrival email is sent to the matched customer's saved email.

## Important known test case
Owner test customer:
- Customer: Trevon Humes
- Saved label alias: Your Electronic Needs
- Expected behavior: OCR does not need to read the full personal name. If "Your Electronic Needs" is recognized confidently as that customer's saved LABEL alias, route the package to Trevon Humes and use Trevon's saved email.

## Where to resume tomorrow
1. Verify the latest recipient-line OCR change on the real Android phone.
2. Re-test the Roadie label:
   - Your Electronic Needs only -> Trevon Humes
   - Your Electronic Needs + partial Trevon -> Trevon Humes
   - unknown identity -> no invented match
3. Measure:
   - first-result latency
   - background-recovery latency
4. Verify actual receive/save flow:
   - matched customer
   - tracking/QR
   - current facility
   - assigned shelf/bin
   - saved photo
   - actual arrival email
5. Re-test a second package immediately after the first to ensure recovery from package 1 never blocks package 2.
6. Continue simplifying toward the PackageX-style architecture rather than adding more generic OCR complexity.
7. If the real-phone Roadie test still fails, stop quickly and send the isolated OCR code + failure evidence for independent review instead of spending hours stacking patches.

## Stop condition
Do not call Parcel Snap OCR production-ready until multiple real labels from different people/businesses pass on the actual phone at warehouse-usable speed.


---

# Update — 2026-10-04 Resume

## Work completed
- Resumed from the saved 2026-10-03 night checkpoint on the existing `main` source.
- Added visible real-phone OCR timing:
  - first-result latency
  - total background-recovery latency
  - timing remains visible in the receive result after save
- Preserved stale-read protection:
  - a new package increments the read token
  - prior recovery OCR is stopped
  - prior-package recovery cannot replace package 2
- Locked the owner-specific Roadie recognition cases:
  - `Your Electronic Needs` LABEL alias only -> Trevon Humes
  - `Your Electronic Needs / TrevonHu` -> Trevon Humes
  - unknown identity -> no invented customer
- Re-ran the live matcher/architecture gates from the current GitHub source; all checked cases passed.
- Added `.github/workflows/parcel-snap-customer-regression.yml` so customer matcher and OCR architecture regressions run automatically on Parcel Snap customer-app changes.
- Fixed the Pages deployment trigger so `parcel-snap-customer/**` changes are included instead of leaving the Android test on stale code.

## Live Supabase verification
- `parcel-snap-portal` is active.
- The saved owner customer has:
  - PERSON record
  - active `Your Electronic Needs` LABEL alias
  - active `Your Electronic Needs / Trevon Humes` LABEL alias
  - saved email present
- Customer notifications are enabled for EMAIL.
- Resend API configuration exists.
- Resend sending domain is verified and sending is enabled.
- The package-photo storage bucket exists.
- Receive backend currently performs:
  1. package row insert
  2. photo upload + package photo row
  3. package event
  4. suggested-location assignment
  5. arrival email when enabled and customer email exists
- There are currently no live package rows, package-photo rows, or notification rows, so the real end-to-end receive/save/email path has NOT yet been honestly verified.

## Backend fix applied
- Generalized `parcel_snap.assign_suggested_location`:
  - `DESTINATION_RECEIVED` now promotes to `WAREHOUSED` when a location is assigned.
  - storage timing can begin from generic `DESTINATION_RECEIVED`, not only the legacy `NASSAU_RECEIVED` stage.

## Current blocker
The live database has zero active warehouse shelf/bin locations at:
- Miami
- Fort Lauderdale
- Orlando
- Nassau

Therefore `assigned_location_id` must remain null until real storage locations are configured. Do not invent warehouse shelf/bin names.

## Exact next test
1. Configure at least one real receiving/storage location for the warehouse being tested, using the owner's actual shelf/bin naming.
2. Open the freshly deployed Parcel Snap customer app on the real Android phone.
3. Photograph the Roadie label.
4. Record the visible first-result and recovery timing.
5. Confirm the label alias maps to Trevon Humes.
6. Save the package.
7. Verify:
   - package row exists
   - tracking/QR value is correct
   - selected/current facility is correct
   - photo row/storage object exists
   - assigned shelf/bin is correct
   - notification row reports SENT
   - arrival email actually arrives
8. Immediately photograph package 2 and verify package 1 recovery never blocks or overwrites it.

## Stop condition remains
Do not call Parcel Snap production-ready until multiple real labels from different people/businesses pass on the actual Android phone at warehouse-usable speed and the complete save/photo/location/email flow succeeds.


---

# Update — 2026-10-04 Courier Entrance / Tenant Tailoring

## Customer entrance corrected
New courier/business flow is now:
1. Create/sign in to company account.
2. Complete business needs assessment BEFORE payment.
3. Enter only the courier's real locations and operating roles.
4. Save the assessment.
5. Continue to payment.
6. After payment is active, Parcel Snap automatically materializes that saved assessment into the courier's private workspace.
7. The courier then sees only its own facilities, workflow choices, staff scope, and enabled features.

## Pre-payment assessment persistence
`parcel_snap.portal_onboarding` now stores:
- `business_profile` JSON
- `business_locations` JSON
- `business_setup_complete`
- `business_setup_completed_at`

The live portal exposes `BUSINESS_SETUP_PREPAY` and `save_prepaid_business_profile`.

## Location assumptions removed
Customer app no longer hardcodes or prioritizes:
- MIA
- FLL
- ORL
- NAS
- Miami
- Orlando
- Fort Lauderdale
- Nassau

Facility sorting is now generic by operational role and business-provided name.
Transfer arrival does not default to Nassau.
New locations are generated only from the courier's assessment.

## Live backend generalized
- New package receipt uses generic `origin_received_at` / `last_arrived_at`.
- Destination receipt uses generic `DESTINATION_RECEIVED`.
- Warehouse assignment functions no longer depend on Miami/Nassau stage names.
- Warehouse-location `site` defaults to that courier's actual facility city/name rather than Nassau.
- Arrival email footer uses the tenant company's own name and `Powered by Parcel Snap`.
- The generic customer portal no longer sends Your Electronic Needs / Alpha Omega branding for another courier.

## OCR isolation
The OCR/matching engine was not replaced during this onboarding change.
Retained:
- two-worker fast/recovery OCR
- recipient-line targeted recovery
- known-recipient/alias matching
- stale-package cancellation
- first-result and background-recovery timing
- unknown-recipient safety behavior

Static validation after the onboarding changes passed:
- saved label -> matching tenant customer
- unknown identity -> no invented customer
- tenant onboarding state/hooks present
- fixed-location routing codes absent from customer app
- city-specific package timestamp fields absent from live portal

## Architecture rule
Do not build a separate independent OCR codebase per courier.
Use one tested multi-tenant Parcel Snap application and recognition engine.
Each courier gets an isolated private workspace generated from its own assessment, payment status, directory, locations, staff, and workflow configuration.

## Remaining OCR acceptance condition
These onboarding changes do NOT change the OCR stop condition:
- real Android Roadie test still required
- full receive/photo/location/email test still required
- multiple labels from different people/businesses must pass at warehouse-usable speed before calling OCR production-ready
