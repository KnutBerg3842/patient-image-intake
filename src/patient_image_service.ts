import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { receiveAppointmentImage } from "./appointment_image_intake.js";
import { InfraiError, infraiFromEnvironment } from "./infrai_client.js";

const port = Number(process.env.PORT ?? 3000);
const bucket = process.env.INFRAI_BUCKET ?? "patient-intake-images";
const infrai = infraiFromEnvironment();
const bucketReady = infrai.storage.bucket.create(bucket, `bucket-${bucket}`);

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 12 * 1024 * 1024) throw new RangeError("Request body exceeds 12 MB");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/appointment-images") {
    send(response, 404, { error: "Route not found" });
    return;
  }

  try {
    await bucketReady;
    const result = await receiveAppointmentImage(await jsonBody(request), infrai, bucket);
    send(response, 201, result);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof RangeError) {
      send(response, 400, { error: "Invalid appointment image request" });
      return;
    }
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      send(response, error.status, { error: error.code, message: error.message });
      return;
    }
    console.error(error);
    send(response, 502, { error: "Image intake could not be completed" });
  }
});

server.listen(port, () => {
  console.log(`Patient image intake listening on http://localhost:${port}`);
});
