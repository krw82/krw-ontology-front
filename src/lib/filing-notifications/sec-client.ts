import "server-only";

const DEFAULT_TIMEOUT_MS = 10_000;

export class SecRequestError extends Error {
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(message: string, options: { status?: number | null; retryAfterSeconds?: number | null } = {}) {
    super(message);
    this.name = "SecRequestError";
    this.status = options.status ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export function secUserAgent(): string {
  return process.env.SEC_USER_AGENT?.trim() || "";
}

export async function fetchSecJson<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const response = await fetchSec(url, "application/json", timeoutMs);
  return response.json() as Promise<T>;
}

export async function fetchSecText(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const response = await fetchSec(url, "text/html,application/xhtml+xml", timeoutMs);
  return response.text();
}

async function fetchSec(url: string, accept: string, timeoutMs: number): Promise<Response> {
  const userAgent = secUserAgent();
  if (!userAgent) throw new SecRequestError("SEC_USER_AGENT is required for SEC filing notifications");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": userAgent,
        Accept: accept,
        "Accept-Encoding": "gzip, deflate",
      },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new SecRequestError(`SEC request failed (${response.status}) for ${url}`, {
        status: response.status,
        retryAfterSeconds: readRetryAfter(response.headers.get("retry-after")),
      });
    }
    return response;
  } catch (error) {
    if (error instanceof SecRequestError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new SecRequestError(`SEC request timed out for ${url}`);
    }
    throw new SecRequestError(error instanceof Error ? error.message : "SEC request failed");
  } finally {
    clearTimeout(timer);
  }
}

function readRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(Math.floor(seconds), 24 * 60 * 60);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(1, Math.min(Math.ceil((date - Date.now()) / 1000), 24 * 60 * 60));
}
