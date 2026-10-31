import assert from "node:assert/strict";
import test from "node:test";
import { patientNotification } from "../src/appointment_image_intake.js";

test("only actionable appointment states produce patient-safe operational text", () => {
  const startsAt = "2026-10-02T09:00:00Z";

  assert.equal(patientNotification({ status: "awaiting_review", startsAt }), null);
  assert.deepEqual(patientNotification({ status: "confirmed", startsAt }), {
    kind: "appointment_confirmed",
    message: "Your appointment is confirmed for 2026-10-02T09:00:00Z.",
  });
  assert.deepEqual(patientNotification({ status: "cancelled", startsAt }), {
    kind: "appointment_cancelled",
    message: "Your appointment was cancelled. Contact the clinic to choose another time.",
  });
});
