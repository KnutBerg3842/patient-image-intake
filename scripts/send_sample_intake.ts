const response = await fetch("http://localhost:3000/appointment-images", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    appointmentId: "appt_demo_42",
    status: "confirmed",
    startsAt: "2026-10-02T09:00:00Z",
    filename: "referral-scan.png",
    contentType: "image/png",
    imageBase64: process.env.SAMPLE_IMAGE_BASE64 ?? "iVBORw0KGgo=",
  }),
});

console.log(JSON.stringify(await response.json(), null, 2));
