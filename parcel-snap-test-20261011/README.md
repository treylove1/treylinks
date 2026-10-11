# Parcel Snap photo reader test

A review-only, in-browser English OCR test. Open index.html through HTTPS, choose a camera/gallery photo, and run the actual Tesseract.js reader. The original orientation and explicit 90° reading remain separate. No account, customer database, parcel intake, email or paid AI service is connected.

Reader assets are downloaded from exact-version public jsDelivr URLs. OCR runs locally. Internet is needed for assets; offline operation is not guaranteed. The app does not save photo/text to storage or send them to an application server. Optional JSON export is a local user-initiated download.

Tesseract.js 6.0.1 and core 6.0.0 are Apache-2.0 software: https://github.com/naptha/tesseract.js and https://github.com/naptha/tesseract.js-core. English data source: https://github.com/naptha/tessdata. App code is part of the existing Parcel Snap repository.

Tracking proposals are OCR-only; no barcode decoder is connected. Fields are unverified source-linked proposals. Recognition confidence is not accuracy. The 95% goal has not been demonstrated. This page does not select a customer or send notifications.
