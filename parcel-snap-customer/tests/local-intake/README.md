# Reviewed local-reader mock CI boundary

This directory relocates the reviewed local-reader tests into the customer tree.
The only changes to the imported tests are relative source paths, removal of the
independent suite's machine-specific root, and an explicit skip for the one
private-preview fixture test. Assertions and synthetic input values are otherwise
unchanged. No application, reader runtime, backend, or SQL source is changed by
this CI compatibility adjustment.

## Included coverage

The `regression` job in `.github/workflows/parcel-snap-customer-regression.yml`
uses explicit file lists and the existing `isolated-network-guard.mjs`:

- `intake-policy.test.mjs`, `free-intake-reader-lifecycle.test.mjs`, and
  `local-intake-integration.test.mjs`: 104 passing mock tests and one explicit
  private-preview skip out of the 105 reviewed tests. The reader runtime, image
  decoder, canvas, authentication, and portal requests are synthetic substitutes.
  They check explicit reading, cancellation, stale evidence, independent literal
  and directory identities, manual confirmation, and fail-closed transport.
- `independent-regression.test.mjs`: 22 adversarial mock checks of the same
  reviewed source. Its root is now relative to this directory.
- Existing `workspace-recovery.test.mjs`, `signout-recovery.test.mjs`, and
  `auth-signout-interaction.test.mjs`: 38 auth/recovery mock tests. The existing
  `tenant-onboarding-architecture-test.mjs` is also retained as one static smoke
  script, not an account-creation or onboarding end-to-end test.
- Existing matcher, OCR parser, customer-label safety, and vision-result unit
  suites use supplied text or mocked observations. Historical test names that
  mention image OCR describe stored input text; this job performs no optical
  inference and proves no image-reading accuracy.
- Existing backend arrival workflow, saved review, warehouse safety, PostgreSQL
  WASM adapter, contact-version, and portal-routing checks remain selected and
  unchanged. PGlite is installed from `tests/sql-runtime/package-lock.json` with
  install scripts disabled. Image fixture bytes are read only as attachment data.
- Candidate request guards remain selected. The separate native PostgreSQL
  matrix jobs and pinned Deno check job are unchanged. Local PGlite results do
  not stand in for those native PostgreSQL or Deno gates.

No OCR runtime or English model data is installed by the regression job.
No global test-directory glob should replace these explicit lists.

## Excluded from this job, retained in the repository

These files are deliberately not deleted or silently rewritten to pass:

- `tests/photo-intake-flow-test.cjs` and
  `tests/customer-arrival-integration.test.mjs` start actual Tesseract workers and
  recognition. Neither was executed for this compatibility adjustment. They
  require a separately authorized optical validation and updated legacy harness.
- `tests/barcode-detection.test.mjs` mixes unit assertions with actual image/WASM
  barcode decoding. It is not executed by the mock-only job and no barcode
  accuracy pass is claimed.
- `tests/ocr-speed-architecture-test.mjs` asserts the former hosted/Tesseract HTML
  and flow, including a Tesseract v6 script tag. Those assumptions conflict with
  the reviewed explicit local-reader entry point. It was inspected, not run.
- `tests/vision-display-test.mjs`, `tests/photo-source-selection.test.mjs`, and
  `tests/intake-confirmation-flow-test.mjs` target the old automatic-photo or
  write-enabled UI. Diagnostic network-guarded runs fail against the reviewed
  hard-off UI; the reviewed local-reader suites above cover its intended behavior.
- `tests/arrival-conflict-ui.test.mjs` extracts the old receive handler without the
  new capability boundary. Its diagnostic run fails with
  `requireArrivalCapability is not defined`. The backend SQL conflict and
  duplicate protections remain covered by the unchanged backend suites; this
  exclusion does not claim the old cross-layer UI path passes.
- The former workflow's frozen phone-preview command references a separate
  preview tree that is not part of this reviewed customer payload. It is not run.
- The one `fictional no-file preview initializes...` case remains visibly skipped
  in `local-intake-integration.test.mjs`, with its original assertions retained.
  Its private review fixture is intentionally not copied into this public tree.
  This does not assert a preview pass.

A green run establishes only the selected mock, synthetic SQL, native database,
and static/type-check boundaries that actually ran. It is not a complete-app,
physical-device, optical-quality, live API, storage, mail, or deployment approval.
