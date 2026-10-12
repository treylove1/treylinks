# Local Data Matrix tracking repair

## Scope

- Request only native barcode formats the current device supports, including Data Matrix when available. Older implementations without format discovery use their default formats.
- Add pinned zxing-wasm 3.1.5 reader as an optional local fallback. The immutable JavaScript and WASM assets are served from this app’s origin; photos are never posted to a barcode service.
- Decode a bounded full-photo canvas independently of the existing OCR crop. This does not change the displayed/stored JPEG, OCR preprocessing, crop selection, or OCR engines.
- Preserve successfully decoded format metadata. An exact TBA-prefixed symbol can supply tracking even if OCR cannot read the carrier word. This is format evidence, not carrier delivery verification. Arbitrary payloads, routing IDs, and unlabelled numeric strings remain rejected.
- Keep all conflicting tracking candidates unresolved. A later model response cannot silently erase a local conflict. Manual confirmation remains required; no automatic intake/email behavior was added.

## Resource and privacy bounds

The fallback runs one full-photo pass in a dedicated worker, with internal rotation/inversion/downscale support, at most 32 symbols, maximum 3200px side and 6 million pixels. Only valid, error-free decoded values of 6–200 characters are returned. The worker is terminated on success, failure, or after 8 seconds; native detection has a 2.5-second wait bound. The barcode module is loaded lazily in that worker. Failure returns no barcode evidence and leaves normal review available.

The initial full-photo canvas is capped to a 3200px side; the adapter applies the 6MP cap before sending pixels. Existing photo-generation and manual-edit guards prevent a late result from replacing a newer selection or reviewed edits.

## Verification

- 412 guarded customer regressions, including 47 barcode tests and 2 later-vision conflict regressions
- 54 camera/proxy tests, 29 frozen-preview tests, 5 native SQL configuration tests, and customer smoke checks
- Actual vendored WASM decodes synthetic Data Matrix, QR and Code128 images. Native API support/exception cases are mocks, explicitly separate from actual decoding.
- Barcode source tests do not establish recipient/address recognition or full-label OCR accuracy.

The actual WASM validation used Node browser-host shims and native canvas. A browser could not be launched in the isolated executor because process sockets were blocked. Physical Android capture, browser-worker behavior, and phone performance are not established by these results.

## Serving and deployment gates

Serve barcode-reader.js, barcode-worker.js and vendor/zxing-wasm-3.1.5/ beside the customer app. Verify same-origin worker execution, allowed WebAssembly/CSP, asset paths, cache refresh, and actual browser decoding on the intended host before calling a deployment accepted. Prefer application/wasm for the WASM response. The decoder also handles non-streaming array-buffer compilation.

This patch does not update or deploy the frozen acceptance preview. Its old build allowlist does not package this worker/vendor directory and must not be reused as a deployment procedure for this change.

## Reproduction

Install the existing pinned test runtime with npm ci --prefix parcel-snap-customer/tests/ocr-runtime --ignore-scripts --no-audit --no-fund, then run the guarded test workflow in .github/workflows/parcel-snap-customer-regression.yml. Dependency hashes, package integrity, licenses, and source links are in vendor/zxing-wasm-3.1.5/PROVENANCE.json and README.md. Public barcode images are wholly synthetic.
