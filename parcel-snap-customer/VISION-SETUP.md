# Parcel Snap: vision-first labels

This branch contains the updated frontend and a Cloudflare Worker proxy. It is not yet enabled on the live GitHub Pages site. No AI key is included. The proxy needs a funded OpenAI API account and deployment before real vision inference works. Do not promise a subsecond network/model round trip; the UI reports measured elapsed time.

## Files
- `vision-client.js`: full-photo preprocessing, vision first, ZXing barcode reading, fuzzy customer name/address ranking, top-three suggestions, confidence, highlighted editable null fields, guarded automatic intake and OCR fallback.
- `vision-config.js`: public proxy URL only.
- `index.html`: pinned ZXing 0.1.5 dependency and updated scripts.
- `vision-proxy/worker.mjs`: authenticated server-side OpenAI GPT-4o request, strict nullable JSON schema, input validation, origin restriction, timeout, no-store response and rate limit.
- `vision-proxy/wrangler.toml`: deployment settings.

## Setup
1. Download/check out this branch. Backups are in `backup-20261008-before-vision-first`.
2. Install Node.js and use Cloudflare Wrangler: from `parcel-snap-customer/vision-proxy`, run `npx wrangler login`.
3. In `wrangler.toml`, set `SUPABASE_PUBLISHABLE_KEY` to the existing public `SUPABASE_KEY` in `../app.js`. Never use a Supabase service-role key. The configured origin is `https://treylove1.github.io`; GitHub Pages path is not part of an origin.
4. Run `npx wrangler deploy`, then `npx wrangler secret put OPENAI_API_KEY`. Paste the OpenAI key only into that terminal secret prompt. Never place it in JS, git, screenshots, or chat. Configure an API spending budget with your provider.
5. Set `window.PARCEL_VISION_URL` in `vision-config.js` to the deployed HTTPS Worker URL. It is public and contains no credentials. Deploy again if Wrangler asks for missing secrets; confirm the secret exists in the Worker settings.
6. Merge this branch into main to publish GitHub Pages. Open the scanner and sign in with an active owner/manager/warehouse account. Hard refresh once.
7. Take a new full-resolution photo of the package label, not a screenshot of the app. Confirm the returned recipient is Trevon Humes, street 16600 NW 54TH AVE, city HIALEAH, state FL, ZIP 33014-6105. Do not hard-code these expected values; unreadable fields remain null. Verify the unit from the real photo.
8. Verify the QR-decoded value against the label. Simple identifier payloads become tracking; URLs only contribute recognized tracking query fields and JSON only its tracking field. Arbitrary URL payloads are shown as decoded barcode text, not sent as tracking.
9. Confirm the correct saved customer/email and warehouse before a real mail test. Automatic intake requires a unique strong name match, AI confidence at least 90%, compatible saved address if available, and readable destination/tracking fields. Missing saved email shows **Email not listed**. Other cases require manual verification/save.
10. Turn off internet or temporarily use an invalid proxy URL: confirm local OCR runs on the full frame and displays **Low confidence, please verify**. Fallback does not auto-send.

## Behavior and limitations
- Full uncropped photo, browser EXIF orientation, maximum 1600px long side, JPEG quality 0.85.
- Strict JSON: recipient_name, address_line, unit, city, state, zip, tracking, order_reference, partner_order, carrier, confidence. All text fields may be null.
- Fuzzy scoring uses the existing name similarity plus saved address when the directory includes an address. The current customer table commonly lacks addresses; then matching uses name only. Duplicate/close names require manual selection. Addresses shared by a warehouse do not identify a person.
- AI confidence is model-reported, not a calibrated probability. Manual corrections update displayed/saved OCR metadata; they do not silently switch or send to another customer.
- Only saved directory email addresses are used. The existing receive_package backend sends mail and suppresses duplicate intake UUIDs. Resend/backend configuration still governs actual delivery.
- ZXing dependencies and local OCR scripts must have loaded/cached before fully offline fallback is possible. A QR may be too small or blurred to decode; printed tracking is then the AI result.
- Tests use mocked AI responses and native contract checks. Real GPT-4o inference, EXIF/device behavior, barcode decoding of your actual label, and real email delivery still need the acceptance test above after key setup.

## Tests
`node parcel-snap-customer/tests/vision-first-test.mjs`
`node parcel-snap-customer/tests/ocr-parser-test.mjs`
`node parcel-snap-customer/tests/known-customer-matcher-test.mjs`

Provider documentation: https://developers.openai.com/api/docs/guides/structured-outputs
Worker secrets: https://developers.cloudflare.com/workers/configuration/secrets/
ZXing browser: https://github.com/zxing-js/browser
