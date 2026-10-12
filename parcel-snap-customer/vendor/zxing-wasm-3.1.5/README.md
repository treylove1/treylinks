# Pinned local barcode reader

zxing-wasm 3.1.5 is the official Sec-ant package wrapping ZXing-C++ for JavaScript/WebAssembly. Only the reader is vendored. Files are byte-for-byte copies from the npm tarball, checked against its SHA-512 integrity. The reader WASM SHA-256 also equals the package’s exported ZXING_WASM_SHA256. See PROVENANCE.json for audit hashes and original paths.

The JavaScript wrapper is MIT (Copyright 2023 Ze-Zheng Wu); ZXing-C++ and the C++/WASM binding use Apache-2.0. Complete license texts are included. ZXing-C++ upstream source and license: https://github.com/zxing-cpp/zxing-cpp/tree/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4 . Binding source/license: https://github.com/Sec-ant/zxing-wasm/tree/main/src/cpp . No writer or Zint binary is distributed here.

Production uses a same-origin dedicated worker and explicitly overrides the upstream default CDN WASM location before decoding. Barcode decoding does not upload image pixels; the app’s existing vision upload behavior is unchanged. Do not remove that override. No account, service API, credentials, install scripts, or paid backend is required.
