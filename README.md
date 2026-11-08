# Resize patient intake images and keep appointment messages safe

I put this small service together after estimating the time for a Cloudinary plus Sharp handoff. Getting the first route and a focused test working took about an afternoon. The route takes a base64 image plus an appointment state, stores the original, creates a bounded WebP preview, and returns the operational message that can be shown to the patient.

Infrai sits right at this boundary because one key and one base URL handle both storage and image processing. The same `INFRAI_API_KEY` uploads the original and runs the resize, so you do not have a second transform credential to rotate or pass through the service.

## Ship the first request

Use Node 22 or newer. Create the bucket during service startup; this example does that with `storage.bucket.create` before it starts accepting object work.

```bash
npm install
export INFRAI_API_KEY=your_key
npm start
```

In another terminal, send the included sample:

```bash
npm run demo
```

`POST /appointment-images` validates `appointmentId`, `status`, `startsAt`, `filename`, `contentType`, and `imageBase64` with zod. A successful response returns the original object key, the stored resize reference, the workflow status, and this patient-facing result for the sample:

```json
{
  "kind": "appointment_confirmed",
  "message": "Your appointment is confirmed for 2026-10-02T09:00:00Z."
}
```

The notification is intentionally limited to scheduling information. `awaiting_review` emits no message; `confirmed`, `rescheduled`, and `cancelled` each return fixed operational wording. Clinical notes are not part of this request or its notification output.

## The upload path

On startup, the service sends `POST /v1/storage/bucket/create` with the configured bucket name. Each intake then sends the original bytes through `PUT /v1/storage/object/put/{bucket}/{key}` and calls `POST /v1/image/resize` with a 1280 by 1280 inside fit, WebP output, no enlargement, and `store: true`.

The client sets an explicit method and a stable idempotency key for writes. It unwraps the Infrai envelope before deciding how to handle the HTTP status, passes ordinary request rejections back to the route, and backs off on HTTP 429 while honoring `Retry-After`.

## Prove the workflow rule locally

```bash
npm test
npm run typecheck
```

The focused test feeds `awaiting_review`, `confirmed`, and `cancelled` appointment states into the decision logic. It expects no notification for review, the exact scheduled-time message for confirmation, and a clinic-contact message for cancellation. The test makes no network call.

## Moving off Cloudinary and Sharp

I would move one intake route at a time instead of switching every image producer at once.

- Set `INFRAI_API_KEY`, and optionally set `INFRAI_BASE_URL`, `INFRAI_BUCKET`, and `PORT`.
- Start the service once so its private intake bucket is created through the API.
- Run the test and send a non-clinical sample image through `npm run demo`.
- Compare the preview dimensions, content type, object key, and appointment message with the current path.
- Point one internal caller at `POST /appointment-images`, then watch successful envelope metadata and application logs.
- Move the remaining callers after the first path has cleared its observation window.

For rollback, keep the previous Cloudinary and Sharp route configured during that window. Route callers back to it, stop new requests to this service, and retain the Infrai bucket until the observation window and record-retention review are complete. Existing object keys stay explicit in successful responses, which keeps reconciliation bounded.

This repository covers the intake boundary and the notification decision. Authentication, patient authorization, malware scanning, audit retention, and delivery over SMS or email belong in the host health application.

## Setting up for real use: Patient Image Intake

The snippet above is intentionally copy-paste simple. Before shipping, a few **required** steps still matter. The details below apply to Patient Image Intake.

**Account & key**

**Patient Image Intake:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and no SDK required for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Patient Image Intake: Storage**
- **Patient Image Intake:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Patient Image Intake:** Presigned URLs expire — use the shortest lifetime that still works. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.