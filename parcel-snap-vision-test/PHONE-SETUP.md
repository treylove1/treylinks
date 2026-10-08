# Parcel Snap — setup entirely from your phone

No terminal is required. Use Chrome; if a page hides editor/build settings, use Chrome's three-dot menu > Desktop site.

1. Open https://dash.cloudflare.com and sign in. Select your account, then Workers & Pages > Create application. Choose Import a repository / Connect GitHub. Authorize access to treylove1/treylinks and choose that repository.
2. Name: parcel-snap-vision. Branch: main. Under advanced/build settings, set Root directory to parcel-snap-vision-proxy. Leave Build command empty. Deploy command: npx wrangler deploy. Choose Deploy. The prepared wrangler.toml already contains the public Supabase key, allowed GitHub origin and rate limit. Do not choose the repository root: that contains unrelated sites.
3. Open the created Worker > Settings > Variables and Secrets > Add. Type: Secret. Name: OPENAI_API_KEY. Value: your OpenAI API key. Save/Deploy. Do not put this key in GitHub or the app. This Worker uses OpenAI, not Gemini/Claude credentials. ChatGPT subscriptions do not supply API usage credits. An API account with usable billing/credits is required.
4. Under Settings > Domains & Routes, copy the production workers.dev URL. If workers.dev is disabled, enable it. Use the permanent production URL, not a version preview URL.
5. Open that URL in Chrome. Expected JSON: service is Parcel Snap vision proxy; vision_configured and auth_configured are true. This checks configuration only, not a paid model request.
6. Open https://github.com/treylove1/treylinks/blob/main/parcel-snap-vision-test/vision-config.js while signed into GitHub. Tap the pencil/Edit (or the three-dot file menu > Edit). Replace the empty URL with your production Worker URL:
   window.PARCEL_VISION_URL = 'https://parcel-snap-vision.YOUR-SUBDOMAIN.workers.dev';
   Commit changes directly to main. This URL is public; never include your API key here. If editing from mobile is difficult, send only the Worker URL to me and I can put it into the app.
7. Wait for the GitHub Pages deployment to finish. Open https://treylove1.github.io/treylinks/parcel-snap-vision-test/?v=barcode-2 and refresh. Sign in, photograph the original package. AI confidence should appear after a successful call. An OCR fallback warning means vision failed; it must not be presented as an AI success.
8. QR/barcode scanning runs locally before vision and separately from OCR. Barcode status shows the raw decoded payload. For your uploaded screenshot, the tested decoder returned 1r1f231d46301835. Test on your phone too. Missing/ambiguous codes require manual verification; unreadable data is never guessed.

Errors:
- Vision proxy is not configured: the app's vision-config.js URL is still empty, or a stale script is cached.
- VISION_NOT_CONFIGURED: secret absent from the deployed Worker.
- ACCESS_DENIED: sign in to an active Parcel Snap company with warehouse permissions.
- ORIGIN_DENIED: ALLOWED_ORIGIN must be https://treylove1.github.io, with no trailing slash or path.
- VISION_PROVIDER_FAILED: check provider credentials, available credits/model access and Worker logs. Never share logs containing secrets.
- RATE_LIMITED: wait a minute and retry.
- Opening Worker URL shows hello-world/404: deployment/root directory is wrong.

The GitHub test app still uses your real company backend. Manual save and high-confidence auto intake may create packages and request real emails. Verify customer and warehouse. OCR fallback does not auto-send.

Sources:
https://developers.cloudflare.com/workers/get-started/dashboard/
https://developers.cloudflare.com/workers/configuration/secrets/
