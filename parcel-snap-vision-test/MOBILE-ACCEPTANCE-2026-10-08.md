# Fictional-label mobile acceptance

Purpose: distinguish the automation-browser upload restriction from the application's actual camera reading. This protocol is prepared; no mobile acceptance has been observed yet.

Use only an existing authorized nonproduction Parcel Snap identity. Do not create accounts, expose credentials, use real customer labels, save parcels or send messages. The Cloudflare preview is scan-only. A signed-in message is not proof of warehouse-role authorization; a successful read must be observed.

## One mobile attempt

On the phone, open the [camera preview](https://parcel-snap-camera-readiness-20261008-parcel-snap-vision.humestrevon.workers.dev/) and sign in normally with the authorized nonproduction account. Open **Open camera / choose photo**, photograph the printed [fictional clean label](./fixtures/synthetic-label-clean.jpg) from another screen or paper, then press **Read label**. Wait for the editable result. Do not enter the expected values manually before recording the result.

The result must show the destination below, not MOCK SHIPPER from the return address:

| Field | Expected |
| --- | --- |
| Recipient | JORDAN SAMPLE |
| Address | 123 TEST PARCEL WAY |
| Unit | UNIT 04 |
| City / state / postcode | MIAMI / FL / 33101 |
| Tracking | 1ZTEST000000000001 |
| Carrier | UPS; fictional-test qualifier acceptable |

Record the displayed fields and elapsed scan time. Expand **Scan timing** and record authorization, inference, total time and model attempts if supplied. Capture only the fictional result/metrics section; omit the sign-in section, email, passwords and session details. No tokens or browser-storage inspection. Record missing fields as missing and incorrect fields as incorrect; confidence alone never determines PASS.

## Follow-up for an actual authenticated scan

Using the same authorized identity, select the committed clean JPEG directly and run Read label, then select [soft-blurred JPEG](./fixtures/synthetic-label-soft-blur.jpg) and repeat. This separates model reading from the added degradation caused by photographing a print/screen. Compare every field against [ground truth](./fixtures/synthetic-label-expected.json).

If scanning fails, record the visible error and stage (camera permission, file selection, upload, sign-in, authorization or reading). Do not retry login blindly, switch off authentication or send customer photos. No parcel storage or email acceptance is implied by a passing scan; those need separate authorized nonproduction tests.

## Known code and test limits

The fallback deliberately leaves recipient identity empty when the label lacks a recognizable destination marker/sole YEN alias, or contains multiple destination blocks. Varied real-label recall remains unmeasured. Offline synthetic text tests cannot establish actual phone/photo accuracy, speed or camera usability.

The last browser attempt showed Camera preview ready and signed-in text, then the automation runtime rejected the file chooser with retained_data_restricted after credential delivery. No uploaded image or successful POST /scan was observed. This failure stage belongs to the automation runtime; it does not establish whether the application would succeed on a phone.
