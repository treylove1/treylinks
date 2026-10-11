# Parcel Snap reader08 private timing/copy candidate

Build: ps-20261011-reader-08. Browser and phone execution are not yet verified. Publication requires separate approval and live header/asset verification.


## Reader08: smaller speed investigation

This candidate preserves the one-shot reader lifecycle. Every Paddle action still creates, initializes and terminates a dedicated worker. There is no prewarm, persistent worker, model change, optical tuning, cache-policy change, telemetry or new network destination. The complete reader07 runtime directory is byte-identical, including the untouched SDK, model shards, exact hashes, ORT kernel and notices.

The normal canvas ImageData path now transfers its existing RGBA ArrayBuffer rather than copying it again. Direct transfer is permitted only for an exact whole-buffer view; an offset or shorter view still copies its exact range. Pixel hashing and exact PNG capture finish first. The prepared full-frame canvas is reset before worker initialization, and its local reference is dropped. At the existing 10 MP limit this avoids one 40,000,000-byte JavaScript buffer copy on the normal path and shortens canvas retention. Actual peak memory and phone speed were not measured. Browser resource reclamation is not guaranteed immediately.

A prominent Download results (JSON) button appears by the completion status when evidence exists. It shares the existing explicit local export path. The export contains recognized text, existing source hashes and evidence, and new timings; it contains no photo bytes, PNGs or blob URLs. It is not a redacted report: share only with intended recipients. The older result-panel button remains available. Canceled attempts do not replace completed evidence, and a new photo or pagehide clears local observations and timings.

For successful Paddle reads, top-level timingReports bind to passId. tapToResultMs spans entry to the Read handler through the first synchronous result DOM update. It includes photo decoding/drawing, preview encoding, RGBA extraction, pixel hashing, transfer-buffer preparation, canvas release, module/setup/prediction, source verification, fields, storage and DOM work. It excludes earlier photo selection and the physical display paint. Engine stages and native SDK stages are nested, so adding them all double-counts time. Missing native stages are null, not measured zero. The legacy observation elapsedSeconds remains explicitly labeled as engine/evidence-only. Tesseract observations and automatic-batch timings are unchanged. Timing records reserve 4 KiB each within the unchanged 6 MiB observation and 16 MiB session evidence caps; at most six records exist per photo. Existing preview caps remain 16/48 MiB.

Asset requests remain credential-free GET with cache:'default' and byte/SHA-256 validation. This permits normal HTTP caching but does not prove a phone cache hit, distinguish network transfer from cached bytes or avoid model-session startup. The first owner reading was reported as about 15 seconds; no measured reader08 speedup is claimed. New tests are synthetic lifecycle/allocation fixtures and saved-output replay only. Actual phone first/repeat timings and browser image behavior still require an authorized test.

## Free Paddle reading

An explicit action runs official @paddleocr/paddleocr-js 0.4.2 with PP-OCRv6 small detection/recognition models, OpenCV4.10.0-release.1 and ONNX Runtime Web1.22.0, in one dedicated same-origin module worker. The official SDK is untouched; the Node diagnostic compatibility port is not shipped. A bundler alias chooses ORT's official WASM-only export. It uses one WASM thread and one prediction per worker. Tesseract actions remain available as separate readings; no text or fields are pooled.

Photos remain limited to20MB and40 million source pixels. Paddle preserves the exact unchanged canvas preparation for sources up to10 million pixels. Larger accepted photos are explicitly downsized as one complete frame to at most10 million pixels using sqrt(10,000,000/source pixels), with both dimensions floored. An extreme aspect ratio that would produce a zero dimension is refused, not stretched. No crop or enhancement is applied; the original file stays unchanged. Export and UI record original/processed dimensions and scale. Only resized frames request browser-native high-quality smoothing. Actual resampling may differ across browsers, and no larger-photo accuracy measurement has been performed. The shown dimensions, source hash, transferred pixel hash, native detector polygons, raw recognition returns (including empty rows), model scores and final SDK projection are retained. Scores are model-specific, not field correctness or cross-engine calibrated confidence. The exact pre-OCR PNG frame is retained under the existing preview budget.

The supplied reader assets are 53,505,906 bytes for the runtime, notices and asset manifest, including31,211,520bytes of models. Cache/compression affect actual transfer size. Browsers do not offer a reliable hard process-memory limit; this prototype limits input size, concurrent workers, result bytes and time. The180-second OCR deadline hard-terminates the dedicated worker; earlier photo decoding/preview encoding uses the existing lifecycle locks. Cleanup failure requires reload. Low-memory phones may fail; phone performance and browser rendering remain unverified.

Raw literal text is immediately visible with the captured photo. Name/address role assignment remains conservative and may stay blank even when raw lines are useful. The Paddle-only tracking policy requires an exact printed heading and bounded, direction-compatible, native-adjacent literal caption; bare number matches remain visible unassigned evidence. Conflicts withhold selection. This is not complete automatic parcel extraction. No customer, email, account or paid API is used.

## Assets and policy scope

Only the site directory is eligible for future publication. It contains no private photos, OCR outputs or reference answers. Models/WASM use exact same-origin asset URLs with byte-count/SHA256 validation. The recognition tar is transported as three fixed ordered parts, each at most10MiB, because of the publication request-size limit. Each part and the reconstructed original archive are verified before the unchanged SDK receives tar bytes. Missing, reordered, oversized, truncated or corrupt parts fail closed. This transport preserves the exact model weights and does not change OCR. Requests are credential-free, redirect-rejecting GET requests. Dynamic module imports are same-host code trust; the fetch wrapper is not a runtime integrity enforcement mechanism for JavaScript modules. Worker network scope is source-code enforcement, not inherited document CSP. XMLHttpRequest fallback is denied before ORT initialization so failed fetch integrity checks cannot silently load unchecked bytes.

The sole proposed document policy expansion is the exact worker URL:

worker-src blob: https://treylove1.github.io/treylinks/parcel-snap-test-20261011/paddle-runtime/paddle-worker.mjs;

Main script-src is unchanged with no unsafe-eval addition. OpenCV contains dynamic Function calls. The separately URL-served worker has its own response-policy context; existing site responses had no HTTP CSP header, but the new worker's deployed headers must be verified after authorization. A restrictive worker-response policy can block initialization; no policy bypass is supported.

Local tests and frozen saved-output replays are not browser or phone validation. The seven-image CPU diagnostic found useful raw improvements and some regressions, so Tesseract is retained. Parser changes are evaluated separately from OCR. No accuracy percentage is promised.

# Prior Tesseract and chooser behavior

The following sections describe the retained Tesseract and chooser06 behavior.

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

Comparison details bind to the displayed reading and also list every recorded comparison, including failed comparisons without a retained pass. The JSON export includes all retained readings and automatic comparison attempts, failure status and selection rationale. It excludes photo bytes and transient image URLs. Images and recognized text stay in the tab unless the user exports a local report. The Tesseract path downloads version-pinned public reader assets from jsDelivr and does not upload photos or text. Offline operation is not guaranteed.

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

## Photo selection feedback

Build reader-06 keeps loading, validation errors and ready status beside the native photo controls. One file selected before the app module starts is opened after handlers attach. Two pre-start selections have unknown order, so the page asks the user to choose again. Canceling the native picker keeps an already added photo; completed selections clear the input value so the same file can be selected again. JPEG/PNG/WebP/HEIC/HEIF validation, image decoding, evidence hashing, OCR and field rules are unchanged. This is a bounded feedback/startup repair; the cause of the owner’s Android selection report remains unconfirmed.
