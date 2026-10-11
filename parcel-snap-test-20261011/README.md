# Parcel Snap photo reader test

A review-only, in-browser English OCR test. Open index.html through HTTPS, choose a camera/gallery photo, and run the actual Tesseract.js reader. The original orientation and explicit 90° reading remain separate. No account, customer database, parcel intake, email or paid AI service is connected.

Reader assets are downloaded from exact-version public jsDelivr URLs. OCR runs locally. Internet is needed for assets; offline operation is not guaranteed. The app does not save photo/text to storage or send them to an application server. Optional JSON export is a local user-initiated download.

Tesseract.js 6.0.1 and core 6.0.0 are Apache-2.0 software: https://github.com/naptha/tesseract.js and https://github.com/naptha/tesseract.js-core. English data source: https://github.com/naptha/tessdata. App code is part of the existing Parcel Snap repository.

Tracking proposals are OCR-only; no barcode decoder is connected. Fields are unverified source-linked proposals. Recognition confidence is not accuracy. The 95% goal has not been demonstrated. This page does not select a customer or send notifications.

## Private quality/preview revision

Export schema `parcel-snap-local-reader-test-v2` keeps complete `raw`, `rows`, and the unchanged extractor output under `originalFields`. `fields` is a separate structural qualification (`parcel-snap-field-qualification-v1`), retaining each withheld candidate and its source offsets/reasons. Weak unstructured OCR is shown as “Couldn’t read reliably.” Incomplete or unfamiliar address layouts remain review evidence, not invalid addresses. Explicit destination literals are preserved. Neither this layer nor an engine confidence score verifies that OCR characters are optically correct.

Each successful pass retains a lossless PNG captured from the exact full processed canvas before that same canvas is passed to OCR. Original and clockwise-90° previews stay separate and selection-bound; the original photo is separate. PNGs and Blob URLs never enter JSON export. Preview metadata records capture, pass, orientation, dimensions, MIME type and byte size. Limits are 16 MiB per PNG and 48 MiB total encoded preview bytes, in addition to the unchanged six-pass/image-dimension limits. New reads are refused rather than silently evicting earlier evidence when a preview would exceed the budget.

PNG capture has a 15-second caller deadline. Since the browser encoder cannot be aborted, a canceled/timed-out encode retains its single-flight lock until its actual callback settles; another read must wait or the page must reload. Late callbacks cannot start OCR or allocate URLs. Failed/canceled new reads release their pending URL without erasing completed passes. New-photo reset and pagehide release retained URLs. A display error releases only that preview and shows an explicit unavailable message; immutable text/capture evidence remains unchanged. Browser-internal decoded-image memory is implementation-dependent; the stated limits bound retained encoded PNGs, not total browser process memory.

This revision was verified with fictional text and mocked Node lifecycle/canvas/worker tests only. No actual photo, browser rendering, image encoding, OCR, model, network transfer or publication was executed. The owner screenshot was not an exact OCR replay; source photo/full export were unavailable. Engine code, version, OCR parameters, rotation/downscale math and reader limits are unchanged.
