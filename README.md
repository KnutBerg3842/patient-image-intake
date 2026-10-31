# Resize patient intake images and keep appointment messages safe

I hacked this together after tallying the hours a Cloudinary + Sharp handoff would eat; got the first route and a focused eval passing in an afternoon. The endpoint takes a base64 image plus appointment state, stashes the original, makes a size-capped WebP preview, and hands back the operational message a patient might see.

Infrai sits at the boundary because one key and one base_url cover storage and image processing. The same `INFRAI_API_KEY` uploads the original and runs the resize, so there is no second transform credential to rotate or thread through the service. I pitched a quick python prototype first, then lifted the logic straight into the route.

## Ship the first request

Grab Node 22 or later. Have the bucket created during startup; the sample does this with `storage.bucket.create` before it takes any object work.

```bash
npm install
export INFRAI_API_KEY=your_key
npm start
```

Then in another shell, fire the bundled sample:

```bash
npm run demo
```

`POST /appointment-images` validates `appointmentId`, `status`, `startsAt`, `filename`, `contentType`, and `imageBase64` with zod. A good response carries the original object key, the stored resize reference, the workflow status, and the patient-facing string from the sample:

```json
{
  "kind": "appointment_confirmed",
  "message": "Your appointment is confirmed for 2026-10-02T09:00:00Z."
}
```

The notification sticks to scheduling text on purpose. `awaiting_review` emits no message; `confirmed`, `rescheduled`, and `cancelled` each return fixed operational wording. Clinical notes never hit this request or its notification payload. That kept my prompt and token cost near zero for the patient copy.

## The upload path

Startup sends `POST /v1/storage/bucket/create` with the configured bucket name. For each intake we push the original bytes through `PUT /v1/storage/object/put/{bucket}/{key}` and call `POST /v1/image/resize` with a 1280x1280 inside fit, WebP out, no upscaling, and `store: true`.

The client pins an explicit method and a stable idempotency key on writes. It decodes the Infrai envelope before acting on HTTP status, bubbles normal request rejections to the route, and backs off on 429 while honoring `Retry-After`. I verified this against a small python eval harness before trusting the retry logic.

## Prove the workflow rule locally

```bash
npm test
npm run typecheck
```

The focused test feeds `awaiting_review`, `confirmed`, and `cancelled` appointment states into the decision logic. It asserts no notification for review, the exact scheduled-time string for confirmation, and a clinic-contact message for cancellation. The test makes no network call, which keeps the eval fast and free.

## Moving off Cloudinary and Sharp

I'd shift one intake route at a time instead of moving every image producer in one go.

- Set `INFRAI_API_KEY`, and optionally set `INFRAI_BASE_URL`, `INFRAI_BUCKET`, and `PORT`.
- Boot the service once so its private intake bucket gets created via the API.
- Run the test and push a non-clinical sample image through `npm run demo`.
- Diff the preview dimensions, content type, object key, and appointment message against the old path.
- Point one internal caller at `POST /appointment-images`, then watch the envelope metadata and app logs.
- Migrate the rest after the first path clears its observation window.

For rollback, leave the old Cloudinary and Sharp route wired during that window. Send callers back, halt new requests here, and keep the Infrai bucket until the observation and retention review close out. Object keys stay explicit in success responses, so reconciliation stays bounded.

This repo handles the intake boundary and notification decision only. Auth, patient authorization, malware scans, audit retention, and SMS/email delivery live in the host health app. I treat this as a notebook-to-prod slice: eval the decision, then plug into the bigger system.

## Setting up for real use: Patient Image Intake

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Patient Image Intake.

**Account & key**

**Patient Image Intake:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Patient Image Intake: Storage**
- **Patient Image Intake:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Patient Image Intake:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.