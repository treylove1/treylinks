# Parcel Snap — PackageX Architecture Research — 2026-10-03

## What PackageX publicly says it does
PackageX does not present its product as plain OCR. Its public product material describes a logistics-specific pipeline that combines:
- camera capture assistance / border detection / image adjustment
- OCR
- barcode and QR scanning
- document classification
- logistics-field extraction
- matching against recipients, purchase orders, or another known dataset
- workflow triggers such as arrival notifications, exceptions, and put-away

PackageX's public Vision SDK material says processing can run on-device and advertises very fast response, while its receiving product describes AI scanning & matching against recipients/records.

## What this means for Parcel Snap
Do NOT treat Tesseract as the product.

Parcel Snap should be:

1. BUSINESS SETUP / TAILORING
   - business completes needs interview before using operational workspace
   - locations are already known
   - employees and facility access are already known
   - workflows/features are already known
   - the UI only shows choices that are genuinely ambiguous

2. RECOGNITION DIRECTORY
   Each customer/recipient record can store:
   - person name
   - business name
   - email
   - phone/WhatsApp
   - label aliases
   - mailbox/account/customer codes

3. PACKAGE INTAKE
   - take photo
   - show photo immediately
   - read barcode/QR first where useful
   - extract OCR/vision evidence
   - match evidence against the known recognition directory
   - MATCHED -> select customer automatically
   - REVIEW/AMBIGUOUS -> suggest, require confirmation
   - NO_MATCH -> ask name/email once and save the label alias for next time

4. ROUTING / FACILITY
   - worker login already knows assigned facility
   - hide receiving warehouse selector when there is only one valid facility
   - hide destination selector when the company route has one valid destination
   - only show a dropdown when the workflow genuinely has multiple valid choices

5. RECEIVE / NOTIFY
   - save photo
   - save customer
   - save tracking / barcode
   - save facility
   - assign storage location
   - send "your package arrived" email to saved customer email
   - log chain of custody

## Immediate engineering priority
Stop spending hours trying to make generic Tesseract OCR behave like a logistics vision SDK.

Use the known-recipient directory as the primary truth source. OCR/vision/barcode are evidence used to select a known record.

## Benchmark target
Before calling Parcel Snap production-ready:
- Roadie / Your Electronic Needs alias must resolve correctly on the real Android phone
- first useful result should be fast enough for a warehouse line
- package 2 must not wait on package 1 recovery
- employee should not choose warehouse/destination when their profile already determines it
- arrival email must actually be sent after save
