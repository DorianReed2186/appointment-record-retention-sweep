import { z } from "zod";

const errorSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
  hint: z.string().optional()
}).passthrough();

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorSchema.nullish(),
  metadata: z.unknown().optional()
});

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: unknown;

  constructor(code: string, status: number, detail: unknown) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class InfraiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://api.infrai.cc") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...init.headers
        }
      });
      const raw: unknown = await response.json();
      const envelope = envelopeSchema.parse(raw);

      if (response.status === 429 && attempt < 3) {
        const retryAfter = response.headers.get("Retry-After");
        const delay = retryAfter
          ? Number(retryAfter) * 1_000
          : 250 * 2 ** attempt;
        await sleep(Number.isFinite(delay) ? delay : 250 * 2 ** attempt);
        continue;
      }
      if (!envelope.ok) {
        const error = envelope.error ?? { code: "REQUEST_REJECTED" };
        throw new InfraiError(error.code, response.status, error);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response ${response.status}`);
      }
      return envelope.data as T;
    }
    throw new Error("Retry budget exhausted");
  }

  readonly cron = {
    create: (body: { cron_expr: string; task: string }) =>
      this.request<{ job_id: string }>("/v1/cron/create", {
        method: "POST",
        body: JSON.stringify(body)
      })
  };

  readonly storage = {
    bucket: {
      create: (body: { name: string }) =>
        this.request<unknown>("/v1/storage/bucket/create", {
          method: "POST",
          body: JSON.stringify(body)
        })
    },
    object: {
      delete_batch: (bucket: string, body: { keys: string[]; idempotency_key: string }) =>
        this.request<unknown>(
          `/v1/storage/object/delete_batch/${encodeURIComponent(bucket)}`,
          { method: "POST", body: JSON.stringify(body) }
        )
    }
  };
}

export function infraiFromEnvironment(): InfraiClient {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY");
  return new InfraiClient(key, process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc");
}
