# Preview source and tests

See [the bundle README](../README.md) for the exact published-version URL, boundaries, expected hashes and exclusions.

From this directory, run `node test.mjs` to build and run all 29 mock tests. No installation, network, authentication or upload occurs. `node build.mjs` builds only. Output is generated under `dist/`.

Inputs are the six adjacent frozen `../parcel-snap-customer/` files and three safety assets. Source locks reject drift. The generated manifest describes every transformation and hashes the exact originals, transformed assets and three Worker modules. Do not substitute later app files or update source locks automatically.

`metadata.proposal.json` is non-executable review/test input. It contains no secret values and does not authorize publication.
