# Parcel Snap Warehouse Verification

Verified in cloud database on 2026-10-01.

## Email backend
- Verified business domain: yourelectronicneeds.org
- Sender tested: Parcel Snap <notifications@yourelectronicneeds.org>
- Controlled Resend sink result: DELIVERED
- Domain receiving is disabled; sender is notification-only.

## OCR cloud gate
Public USPS-style shipping label:
- Clean label: correct customer John Smith, customer score 1.0, tracking score 1.0
- Rotated/compressed warehouse stress label after recovery pass: correct customer John Smith, customer score 1.0, tracking score 1.0
- OCR gate now runs whenever intake logic changes.

## Warehouse rules
Rollback tests:
- Unpaid Nassau package -> HOLD-H1
- Paid Nassau package -> STOR-A1
- Ready for pickup -> PICK-P1
- Full STOR-A1 -> fallback STOR-A2
- 10 storage days, 7 free days, $2/day -> $6 storage fee
- Late in-transit package -> CHECK_LATE_SHIPMENT
- Ready package not in pickup zone -> MOVE_TO_PICKUP
- Unpaid Nassau arrival -> MOVE_TO_HOLD

## 100-package stress test
All test rows were rolled back afterward.
- Packages total: 100
- Packages assigned: 100
- Unpaid packages in HOLD: 20
- Paid packages in STORAGE: 80
- Over-capacity locations: 0
- Assignment audit events: 100

## Security gate
The new parcel_snap schema is not connected to the public app yet.
Supabase flagged RLS disabled on these new tables. Direct browser access will remain disconnected
until tenant policies are explicitly approved and enabled.


## Configurable receiving warehouses
A cloud warehouse profile layer now supports interchangeable receiving sites.
Verified profile rendering for:
- Miami
- Fort Lauderdale
- Orlando
- Nassau

The arrival email pulls its warehouse name/address from the selected profile; package-processing code does not hard-code a city/address.

Real Resend delivery sink results:
- Miami profile: DELIVERED
- Fort Lauderdale profile: DELIVERED
- Orlando profile: DELIVERED
- Nassau profile: DELIVERED

The addresses used for this verification were rollback-only sentinel test addresses and were not persisted as customer/warehouse production data.
