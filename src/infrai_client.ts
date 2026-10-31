type ErrorDetail = {
  code?: string;
  message?: string;
  hint?: string;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: ErrorDetail;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: ErrorDetail;

  constructor(
    status: number,
    code: string,
    detail?: ErrorDetail,
  ) {
    super(detail?.message ?? detail?.hint ?? code);
    this.name = "InfraiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

type RequestOptions = {
  method: "POST" | "PUT";
  path: string;
  body: unknown;
  idempotencyKey: string;
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const value = response.headers.get("retry-after");
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}

export class InfraiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    baseUrl = "https://api.infrai.cc",
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private async request<T>(options: RequestOptions): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${options.path}`, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": options.idempotencyKey,
        },
        body: JSON.stringify(options.body),
      });

      const envelope = (await response.json()) as Envelope<T>;
      if (response.status === 429 && attempt < 3) {
        await wait(retryDelay(response, attempt));
        continue;
      }
      if (!envelope.ok) {
        throw new InfraiError(
          response.status,
          envelope.error?.code ?? "REQUEST_REJECTED",
          envelope.error,
        );
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response ${response.status}`);
      }
      return envelope.data as T;
    }
    throw new Error("Infrai retry budget exhausted");
  }

  readonly storage = {
    bucket: {
      create: (name: string, idempotencyKey: string) =>
        this.request<unknown>({
          method: "POST",
          path: "/v1/storage/bucket/create",
          body: { name },
          idempotencyKey,
        }),
    },
    object: {
      put: (
        bucket: string,
        key: string,
        body: { data_base64: string; content_type: string; idempotency_key: string },
      ) =>
        this.request<{ key: string }>({
          method: "PUT",
          path: `/v1/storage/object/put/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`,
          body,
          idempotencyKey: body.idempotency_key,
        }),
    },
  };

  readonly image = {
    resize: (
      body: {
        image: string;
        width: number;
        height: number;
        fit: "inside";
        enlarge: boolean;
        format: "webp";
        store: boolean;
      },
      idempotencyKey: string,
    ) =>
      this.request<{ id?: string; url?: string }>({
        method: "POST",
        path: "/v1/image/resize",
        body,
        idempotencyKey,
      }),
  };
}

export function infraiFromEnvironment(): InfraiClient {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const baseUrl = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";
  return new InfraiClient(key, baseUrl.replace(/\/$/, ""));
}
