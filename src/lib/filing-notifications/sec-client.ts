import "server-only";

const DEFAULT_TIMEOUT_MS = 10_000;
const TRANSIENT_REQUEST_ATTEMPTS = 3;
const TRANSIENT_RETRY_BASE_DELAY_MS = 250;

export class SecRequestError extends Error {
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;
  readonly code: string | null;

  constructor(message: string, options: { status?: number | null; retryAfterSeconds?: number | null; code?: string | null } = {}) {
    super(message);
    this.name = "SecRequestError";
    this.status = options.status ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.code = options.code ?? null;
  }
}

export type SecTextFetchOptions = {
  /** Reject before retaining more than this many response bytes in memory. */
  maxBytes?: number;
};

export function secUserAgent(): string {
  return process.env.SEC_USER_AGENT?.trim() || "";
}

export async function fetchSecJson<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const response = await fetchSec(url, "application/json", timeoutMs);
  return response.json() as Promise<T>;
}

export async function fetchSecText(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  options: SecTextFetchOptions = {},
): Promise<string> {
  const response = await fetchSec(url, "text/html,application/xhtml+xml", timeoutMs);
  return readResponseText(response, options.maxBytes);
}

export async function fetchSecAtom(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const response = await fetchSec(url, "application/atom+xml,application/xml;q=0.9,text/xml;q=0.8", timeoutMs);
  return response.text();
}

async function fetchSec(url: string, accept: string, timeoutMs: number): Promise<Response> {
  const userAgent = secUserAgent();
  if (!userAgent) throw new SecRequestError("SEC_USER_AGENT is required for SEC filing notifications");
  if (!isAllowedSecUrl(url)) throw new SecRequestError("SEC request URL must use an approved SEC host");

  for (let attempt = 1; attempt <= TRANSIENT_REQUEST_ATTEMPTS; attempt += 1) {
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
      const requestError = toSecRequestError(error, url);
      if (attempt >= TRANSIENT_REQUEST_ATTEMPTS || !isTransientSecError(requestError)) {
        throw requestError;
      }
      await sleep(TRANSIENT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new SecRequestError(`SEC request failed for ${url}`);
}

function toSecRequestError(error: unknown, url: string): SecRequestError {
  if (error instanceof SecRequestError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new SecRequestError(`SEC request timed out for ${url}`);
  }
  const message = error instanceof Error ? error.message : "SEC request failed";
  const cause = error instanceof Error && error.cause
    ? ` (${error.cause instanceof Error ? error.cause.message : String(error.cause)})`
    : "";
  return new SecRequestError(`${message}${cause} for ${url}`);
}

function isTransientSecError(error: SecRequestError): boolean {
  return error.status === null || error.status === 408 || error.status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAllowedSecUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "www.sec.gov" || url.hostname === "data.sec.gov");
  } catch {
    return false;
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

async function readResponseText(response: Response, maxBytes?: number): Promise<string> {
  const boundedMaxBytes = maxBytes === undefined
    ? null
    : Math.max(1, Math.floor(maxBytes));
  const declaredLength = Number(response.headers.get("content-length"));
  if (boundedMaxBytes !== null && Number.isFinite(declaredLength) && declaredLength > boundedMaxBytes) {
    throw new SecRequestError(`SEC response exceeds the ${boundedMaxBytes}-byte on-demand limit`, {
      status: 413,
      code: "response_too_large",
    });
  }

  if (boundedMaxBytes === null || !response.body) return response.text();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > boundedMaxBytes) {
        await reader.cancel();
        throw new SecRequestError(`SEC response exceeds the ${boundedMaxBytes}-byte on-demand limit`, {
          status: 413,
          code: "response_too_large",
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
