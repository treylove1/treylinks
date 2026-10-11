# Parcel Snap automatic-reading owner test

Build: ps-20261011-reader-05. Phone/browser verification is pending.

This is a review-only, in-browser English OCR prototype. No customer selection, parcel intake, email, account, database, paid AI service, or new hosting is connected. Original and manual clockwise-90° readings remain available. The new automatic action tries four separate full-photo readings and initially displays one whole reading. Recognized text and source-linked proposals remain unverified.

## Frozen optical recipe

- Orientations: 0°, 90°, 180°, 270°, in that order
- Tesseract.js 6.0.1, core 6.0.0, English @tesseract.js-data/eng 1.0.0 / 4.0.0_best_int, OEM 1
- Automatic: PSM 11, preserve_interword_spaces 1, user_defined_dpi 300, rotateAuto true
- Manual: unchanged PSM 6, no internal auto-deskew
- Full-frame downscale: maximum edge 2400 pixels, maximum area 4 million pixels, no crop
- A fresh worker for each reading; no simultaneous workers

The fixed whole-pass score is the sum, over all recognized words, of Unicode letter/digit count multiplied by max(0, native word confidence minus 50). Missing or nonfinite confidence contributes zero. Ties prefer 0°, 90°, 180°, 270°. This ranks engine readings; it does not establish optical correctness, recipient identity, address validity, or tracking accuracy. No fields or text are pooled across passes. An incomplete, canceled, or cleanup-failed comparison has no ranking winner; retained attempts remain available for manual review.

## Evidence, preview and export

Schema parcel-snap-local-reader-test-v3 retains complete raw text and blocks, native rows, original literal proposals, separate structural qualification, actual engine settings, build ID, source photo hash, rotation, score, and returned internal deskew angle. The structural qualifier does not measure optical accuracy. Ambiguous or incomplete proposals are not automatically accepted.

Each PNG preview is captured from the exact canvas supplied before OCR. Automatic OCR applies an additional internal deskew. The caption explicitly says the supplied canvas is not the final internally deskewed raster and records the actual returned angle. No row-coordinate overlay incorrectly maps internal geometry onto that earlier canvas. The original photo remains separate.

Comparison details bind to the displayed reading and also list every recorded comparison, including failed comparisons without a retained pass. The JSON export includes all retained readings and automatic comparison attempts, failure status and selection rationale. It excludes photo bytes and transient image URLs. Images and recognized text stay in the tab unless the user exports a local report. The page downloads only version-pinned public reader assets from jsDelivr and does not upload photos or text. Offline operation is not guaranteed.

## Bounds and interruption behavior

A batch lock holds across preparation, every worker and the gaps between workers. Automatic reading requires four free slots under the existing six-reading session limit. Remaining encoded-preview capacity is divided into four reserved slices within the existing 16 MiB per-preview and 48 MiB total caps. Remaining text-evidence capacity, less 64 KiB reserved for comparison metadata, is divided into four slices within the existing 6 MiB observation and 16 MiB session caps. Oversized attempts stop the run without evicting prior evidence. At most six comparison attempts are recorded per photo.

Recognized text is never silently truncated. Raw JSON is bounded to 2 MiB; proposals are bounded to 500 rows and 4096 UTF-16 units per row. Diagnostic error explanations in comparison metadata are shortened after 4096 characters with an explicit suffix; this limit does not alter recognized text.

Automatic worker cancellation is requested after 90 seconds. An independent 360-second comparison timer includes preparation and gaps. Browser-native preview encoding and pending worker initialization cannot be forcibly stopped by this page. Their single-flight locks remain until completion, or the user reloads. Cancel, a new photo, pagehide, stale callbacks and late worker handles cannot start later orientations. Completed evidence remains available. The no-winner rule for incomplete comparisons is stricter than the diagnostic benchmark fallback and does not change any of the six fully completed benchmark selections.

## Measured diagnostic and verification limits

A fixed private Node/WASM diagnostic used six authorized real parcel photos. Exact selected raw recovery changed as follows:

- Recipient: 1 to 3 of 6
- Ordered complete address span: 0 to 1 of 6
- Known full tracking: 2 to 3 of 6, with five known references and one partial reference
- All three core fields in the same raw pass: 0 to 1 of 6

No previously recovered core-field span regressed. The deployed parser still yielded zero complete exact proposed tuples before the separate parser repair. These are small-sample diagnostics, not demonstrated 95% accuracy or phone-browser parity. Native canvas decoding and resampling are not proven pixel-identical to browser createImageBitmap/canvas.

The optical snapshot has 52 mocked lifecycle/preview checks and six mocked engine checks. A saved-output replay verifies that the new selector exactly reproduces all 24 candidate scores and six selected rotations. No new OCR is run by those tests. Real browser rendering, camera/gallery behavior, model loading, native image encoding, and phone timing still require their own authorized verification.

This build integrates the separately reviewed tracking-only repair: exact TRACKING ID heading recognition and bounded immediate same-band right-hand OCR fragments. Literal values, source offsets and conflicts are preserved. No name/address code changes were included. Saved-output replay increased exact displayed tracking from 1 to 2 of 6, with no added wrong tracking value and no name/address change. Complete exact proposed tuples remain 0 of 6.

Tesseract.js and core are Apache-2.0 software: https://github.com/naptha/tesseract.js and https://github.com/naptha/tesseract.js-core. English model source: https://github.com/naptha/tessdata.
