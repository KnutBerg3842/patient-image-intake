import { createHash } from "node:crypto";
import { z } from "zod";
import { InfraiClient } from "./infrai_client.js";

export const intakeSchema = z.object({
  appointmentId: z.string().regex(/^[A-Za-z0-9_-]{3,80}$/),
  status: z.enum(["awaiting_review", "confirmed", "rescheduled", "cancelled"]),
  startsAt: z.string().datetime({ offset: true }),
  filename: z.string().min(1).max(120).regex(/^[A-Za-z0-9._-]+$/),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  imageBase64: z.string().min(1),
});

export type Intake = z.infer<typeof intakeSchema>;

export type PatientNotification = {
  kind: "appointment_confirmed" | "appointment_rescheduled" | "appointment_cancelled";
  message: string;
} | null;

export function patientNotification(input: Pick<Intake, "status" | "startsAt">): PatientNotification {
  switch (input.status) {
    case "confirmed":
      return {
        kind: "appointment_confirmed",
        message: `Your appointment is confirmed for ${input.startsAt}.`,
      };
    case "rescheduled":
      return {
        kind: "appointment_rescheduled",
        message: `Your appointment has moved to ${input.startsAt}.`,
      };
    case "cancelled":
      return {
        kind: "appointment_cancelled",
        message: "Your appointment was cancelled. Contact the clinic to choose another time.",
      };
    case "awaiting_review":
      return null;
  }
}

function stableToken(input: Intake): string {
  return createHash("sha256")
    .update(`${input.appointmentId}:${input.filename}:${input.imageBase64}`)
    .digest("hex")
    .slice(0, 24);
}

export async function receiveAppointmentImage(
  rawInput: unknown,
  infrai: InfraiClient,
  bucket: string,
) {
  const input = intakeSchema.parse(rawInput);
  const token = stableToken(input);
  const originalKey = `appointments/${input.appointmentId}/original/${token}-${input.filename}`;

  await infrai.storage.object.put(bucket, originalKey, {
    data_base64: input.imageBase64,
    content_type: input.contentType,
    idempotency_key: `original-${token}`,
  });

  const resized = await infrai.image.resize(
    {
      image: input.imageBase64,
      width: 1280,
      height: 1280,
      fit: "inside",
      enlarge: false,
      format: "webp",
      store: true,
    },
    `clinical-preview-${token}`,
  );

  return {
    appointmentId: input.appointmentId,
    workflowStatus: input.status,
    originalKey,
    preview: resized,
    notification: patientNotification(input),
  };
}
