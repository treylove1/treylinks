# Isolated OCR test runtime

Exact versions: Tesseract.js 6.0.1, Tesseract.js-core 6.0.0, canvas 0.1.100. The core pin matches Tesseract 6.0.1’s default browser CDN URL; it avoids npm resolving a newer compatible core behind the test.

Test-only dependencies, installed from official npm packages with scripts disabled. No native binaries or `node_modules` belong in the repository or handoff source archive.

```sh
npm ci --prefix parcel-snap-customer/tests/ocr-runtime --ignore-scripts --no-audit --no-fund
export NODE_PATH="$PWD/parcel-snap-customer/tests/ocr-runtime/node_modules"
export TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata
node parcel-snap-customer/tests/photo-intake-flow-test.cjs
node evidence/customer-jpeg-probe.cjs
node evidence/customer-jpeg-adversarial-probe.cjs
```

Install English Tesseract language data through the operating system package manager first. On Ubuntu, the package is `tesseract-ocr-eng`. Set `TESSDATA_PREFIX` to the directory containing `eng.traineddata`; tests fail clearly if the data is unavailable and do not download it.

The canvas native addon is supplied by npm's platform-specific optional dependency, so keep optional packages enabled. It needs no install script. Tesseract's disabled postinstall is an optional donation notice; its runtime and WASM core are package contents.

The test renders fictional text or reads committed fictional JPEGs, uses actual image preprocessing and OCR, and captures actions locally. It does not exercise a physical phone camera, native browser barcode decoding, real hosted inference, Supabase writes or email delivery.
