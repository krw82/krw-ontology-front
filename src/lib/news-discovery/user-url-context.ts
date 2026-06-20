import "server-only";

import { lookup } from "node:dns/promises";
import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type RequestOptions as HttpRequestOptions,
} from "node:http";
import {
  request as httpsRequest,
  type RequestOptions as HttpsRequestOptions,
} from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 40_000;
const USER_AGENT =
  "KRWOntologyUserUrlReader/0.1 (+https://krw-ontology.local)";

type UserUrlContextErrorCode =
  | "invalid_url"
  | "blocked_url"
  | "fetch_failed"
  | "unsupported_content";

export class UserUrlContextError extends Error {
  code: UserUrlContextErrorCode;

  constructor(code: UserUrlContextErrorCode, message: string) {
    super(message);
    this.name = "UserUrlContextError";
    this.code = code;
  }
}

interface BuildUserUrlNewsEventContextParams {
  url: string;
  ticker: string;
  userQuestion: string;
}

interface BuildUserUrlsNewsEventContextParams {
  urls: string[];
  ticker: string;
  userQuestion: string;
}

interface FetchedUserUrlDocument {
  sourceUrl: string;
  finalUrl: string;
  domain: string;
  contentType: string;
  rawText: string;
  downloadedBytes: number;
  downloadTruncated: boolean;
}

interface ExtractedUserUrlDocument {
  title: string;
  description: string;
  canonicalUrl: string;
  visibleText: string;
  textTruncated: boolean;
}

interface PublicHttpUrlResolution {
  parsed: URL;
  hostname: string;
  address: string;
}

export async function buildUserUrlNewsEventContext(
  params: BuildUserUrlNewsEventContextParams,
): Promise<Record<string, unknown>> {
  const ticker = params.ticker.trim().toUpperCase();
  if (!ticker) {
    throw new UserUrlContextError(
      "invalid_url",
      "URL 점검은 종목 기준이 필요합니다.",
    );
  }

  const fetched = await fetchUserUrlDocument(params.url);
  const extracted = extractUserUrlDocument(fetched);
  const readAt = new Date().toISOString();
  const sourceUrl = fetched.finalUrl;
  const canonicalUrl = extracted.canonicalUrl || sourceUrl;
  const title =
    extracted.title || `${fetched.domain} 사용자가 제공한 URL`;
  const originalText = buildOriginalTextForOntology({
    ticker,
    userQuestion: params.userQuestion,
    sourceUrl,
    canonicalUrl,
    domain: fetched.domain,
    title,
    description: extracted.description,
    visibleText: extracted.visibleText,
    textTruncated: extracted.textTruncated || fetched.downloadTruncated,
  });

  const ontologyBrief = [
    `Ticker: ${ticker}`,
    "Source kind: user-provided external URL.",
    `User question: ${params.userQuestion.trim()}`,
    `URL: ${canonicalUrl}`,
    `Title: ${title}`,
    extracted.description ? `Description: ${extracted.description}` : "",
    "Use the mechanically extracted page text as a market hypothesis for the investor question.",
    "First consider what would matter for the company if this narrative is directionally true.",
    "Do not turn forward-looking claims into a filing-presence audit; filings normally will not confirm future scenarios.",
    "Use KRW Ontology filing evidence to anchor, qualify, or limit company-specific interpretation.",
  ]
    .filter(Boolean)
    .join("\n");

  const sourcePack = {
    version: "user-url-source-pack/v1",
    selected_event_id: `user-url-${ticker.toLowerCase()}-${Date.now()}`,
    read_at: readAt,
    source_urls: [canonicalUrl],
    source_previews: [
      {
        url: canonicalUrl,
        title,
        publisher: fetched.domain,
        snippet_summary: extracted.description,
      },
    ],
    reads: [
      {
        url: sourceUrl,
        ok: true,
        title,
        content_type: fetched.contentType,
        downloaded_bytes: fetched.downloadedBytes,
        text: extracted.visibleText,
        truncated: extracted.textTruncated || fetched.downloadTruncated,
      },
    ],
    ontology_search_brief_en: ontologyBrief,
    original_text_for_ontology: originalText,
    source_read_status: extracted.visibleText ? "read" : "metadata_only",
  };

  return {
    version: "user-url-event/v1",
    source_kind: "user_provided_url",
    ticker,
    source_url: sourceUrl,
    canonical_url: canonicalUrl,
    source_domain: fetched.domain,
    title,
    description: extracted.description,
    user_question: params.userQuestion.trim(),
    extraction_status: extracted.visibleText ? "read" : "metadata_only",
    extracted_text_char_count: extracted.visibleText.length,
    extracted_text_truncated: extracted.textTruncated || fetched.downloadTruncated,
    ontology_bridge_brief_en: ontologyBrief,
    source_pack: sourcePack,
  };
}

export async function buildUserUrlsNewsEventContext(
  params: BuildUserUrlsNewsEventContextParams,
): Promise<Record<string, unknown>> {
  const urls = Array.from(
    new Set(params.urls.map((url) => url.trim()).filter(Boolean)),
  );
  if (urls.length === 0) {
    throw new UserUrlContextError(
      "invalid_url",
      "올바른 http 또는 https URL을 입력해주세요.",
    );
  }

  if (urls.length === 1) {
    return buildUserUrlNewsEventContext({
      url: urls[0],
      ticker: params.ticker,
      userQuestion: params.userQuestion,
    });
  }

  const contexts = await Promise.all(
    urls.map((url) =>
      buildUserUrlNewsEventContext({
        url,
        ticker: params.ticker,
        userQuestion: params.userQuestion,
      }),
    ),
  );
  const ticker = params.ticker.trim().toUpperCase();
  const readAt = new Date().toISOString();
  const sourceUrls = contexts
    .map((context) => getStringField(context, "canonical_url") || getStringField(context, "source_url"))
    .filter(Boolean);
  const sourcePreviews = contexts.flatMap((context) => {
    const sourcePack = getRecordField(context, "source_pack");
    const previews = sourcePack?.source_previews;
    return Array.isArray(previews) ? previews : [];
  });
  const reads = contexts.flatMap((context) => {
    const sourcePack = getRecordField(context, "source_pack");
    const sourceReads = sourcePack?.reads;
    return Array.isArray(sourceReads) ? sourceReads : [];
  });
  const originalText = contexts
    .map((context, index) => {
      const sourcePack = getRecordField(context, "source_pack");
      const text = sourcePack?.original_text_for_ontology;
      return typeof text === "string"
        ? `# URL ${index + 1}\n\n${text}`
        : "";
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
  const extractedTextCharCount = contexts.reduce((sum, context) => {
    const count = context.extracted_text_char_count;
    return sum + (typeof count === "number" ? count : 0);
  }, 0);
  const extractedTextTruncated = contexts.some(
    (context) => context.extracted_text_truncated === true,
  );
  const ontologyBrief = [
    `Ticker: ${ticker}`,
    `Source kind: ${contexts.length} user-provided external URLs.`,
    `User question: ${params.userQuestion.trim()}`,
    "URLs:",
    ...sourceUrls.map((url, index) => `${index + 1}. ${url}`),
    "Use the mechanically extracted page texts as market hypotheses for the investor question.",
    "First consider what would matter for the company if these narratives are directionally true.",
    "Do not turn forward-looking claims into a filing-presence audit; filings normally will not confirm future scenarios.",
    "Use KRW Ontology filing evidence to anchor, qualify, or limit company-specific interpretation.",
  ].join("\n");

  const sourcePack = {
    version: "user-url-source-pack/v1",
    selected_event_id: `user-url-${ticker.toLowerCase()}-${Date.now()}`,
    read_at: readAt,
    source_urls: sourceUrls,
    source_previews: sourcePreviews,
    reads,
    ontology_search_brief_en: ontologyBrief,
    original_text_for_ontology: originalText,
    source_read_status: reads.length > 0 ? "read" : "metadata_only",
  };

  return {
    version: "user-url-event/v1",
    source_kind: "user_provided_urls",
    ticker,
    source_url: sourceUrls[0] ?? urls[0],
    canonical_url: sourceUrls[0] ?? urls[0],
    source_urls: sourceUrls,
    source_domain: `${contexts.length} user URLs`,
    title: `사용자가 제공한 URL ${contexts.length}개`,
    description: "사용자가 직접 입력한 여러 URL을 함께 읽어 만든 점검 컨텍스트입니다.",
    user_question: params.userQuestion.trim(),
    extraction_status: reads.length > 0 ? "read" : "metadata_only",
    extracted_text_char_count: extractedTextCharCount,
    extracted_text_truncated: extractedTextTruncated,
    ontology_bridge_brief_en: ontologyBrief,
    source_pack: sourcePack,
  };
}

export async function fetchUserUrlDocument(
  inputUrl: string,
): Promise<FetchedUserUrlDocument> {
  const sourceUrl = normalizeUserUrlForFetch(inputUrl);
  let currentUrl = sourceUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const resolution = await resolvePublicHttpUrl(currentUrl);
    const response = await fetchWithTimeout(resolution);

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new UserUrlContextError(
          "fetch_failed",
          "URL 리다이렉트 위치를 확인하지 못했습니다.",
        );
      }
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }

    if (!response.ok) {
      throw new UserUrlContextError(
        "fetch_failed",
        `URL을 읽지 못했습니다. HTTP ${response.status}`,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!isSupportedContentType(contentType)) {
      throw new UserUrlContextError(
        "unsupported_content",
        "HTML 또는 텍스트 URL만 읽을 수 있습니다.",
      );
    }

    const body = await readLimitedBody(response);
    return {
      sourceUrl,
      finalUrl: currentUrl,
      domain: new URL(currentUrl).hostname,
      contentType,
      rawText: body.text,
      downloadedBytes: body.bytes,
      downloadTruncated: body.truncated,
    };
  }

  throw new UserUrlContextError(
    "fetch_failed",
    "URL 리다이렉트가 너무 많습니다.",
  );
}

export function normalizeUserUrlForFetch(inputUrl: string): string {
  const trimmed = inputUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new UserUrlContextError(
      "invalid_url",
      "올바른 http 또는 https URL을 입력해주세요.",
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UserUrlContextError(
      "invalid_url",
      "http 또는 https URL만 사용할 수 있습니다.",
    );
  }
  if (parsed.username || parsed.password) {
    throw new UserUrlContextError(
      "blocked_url",
      "인증 정보가 포함된 URL은 사용할 수 없습니다.",
    );
  }
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    throw new UserUrlContextError(
      "blocked_url",
      "비표준 포트 URL은 사용할 수 없습니다.",
    );
  }
  parsed.hash = "";
  return parsed.href;
}

export function isPrivateIpAddress(address: string): boolean {
  const ipVersion = isIP(address);
  if (ipVersion === 4) return isPrivateIpv4(address);
  if (ipVersion === 6) return isPrivateIpv6(address);
  return false;
}

async function resolvePublicHttpUrl(url: string): Promise<PublicHttpUrlResolution> {
  const parsed = new URL(normalizeUserUrlForFetch(url));
  const hostname = normalizeLookupHostname(parsed.hostname);
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new UserUrlContextError(
      "blocked_url",
      "로컬 주소는 읽을 수 없습니다.",
    );
  }

  const records = await lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) {
    throw new UserUrlContextError(
      "fetch_failed",
      "URL 호스트를 확인하지 못했습니다.",
    );
  }

  const blocked = records.find((record) => isPrivateIpAddress(record.address));
  if (blocked) {
    throw new UserUrlContextError(
      "blocked_url",
      "내부 네트워크 주소는 읽을 수 없습니다.",
    );
  }

  return {
    parsed,
    hostname,
    address: records[0].address,
  };
}

async function fetchWithTimeout(
  resolution: PublicHttpUrlResolution,
): Promise<Response> {
  const { parsed, hostname, address } = resolution;
  const isHttps = parsed.protocol === "https:";
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  const requestOptions: HttpRequestOptions & HttpsRequestOptions = {
    hostname: address,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : isHttps ? 443 : 80,
    path: `${parsed.pathname}${parsed.search}`,
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
      Host: parsed.host,
      "User-Agent": USER_AGENT,
    },
    signal: controller.signal,
  };

  if (isHttps) {
    requestOptions.servername = hostname;
  }

  return new Promise<Response>((resolve, reject) => {
    const request = (isHttps ? httpsRequest : httpRequest)(
      requestOptions,
      (incoming) => {
        clearTimeout(timeoutId);
        resolve(
          new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
            status: incoming.statusCode ?? 599,
            headers: headersFromIncoming(incoming.headers),
          }),
        );
      },
    );

    request.on("error", (error) => {
      clearTimeout(timeoutId);
      if (timedOut || error.name === "AbortError") {
        reject(
          new UserUrlContextError(
            "fetch_failed",
            "URL 응답 시간이 너무 깁니다.",
          ),
        );
        return;
      }
      reject(
        new UserUrlContextError(
          "fetch_failed",
          "URL을 읽지 못했습니다.",
        ),
      );
    });

    request.end();
  });
}

function headersFromIncoming(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(key, item);
    } else if (typeof value === "string") {
      result.set(key, value);
    }
  }
  return result;
}

function normalizeLookupHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function isSupportedContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return (
    lower.includes("text/html") ||
    lower.includes("application/xhtml+xml") ||
    lower.includes("text/plain")
  );
}

async function readLimitedBody(response: Response): Promise<{
  text: string;
  bytes: number;
  truncated: boolean;
}> {
  if (!response.body) return { text: "", bytes: 0, truncated: false };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      const remaining = value.byteLength - (totalBytes - MAX_RESPONSE_BYTES);
      if (remaining > 0) chunks.push(value.slice(0, remaining));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }

  const bytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(buffer),
    bytes,
    truncated,
  };
}

function extractUserUrlDocument(
  document: FetchedUserUrlDocument,
): ExtractedUserUrlDocument {
  const isPlainText = document.contentType.toLowerCase().includes("text/plain");
  const raw = document.rawText;
  const title = isPlainText ? "" : decodeHtmlEntities(matchTitle(raw));
  const description = isPlainText
    ? ""
    : decodeHtmlEntities(matchMeta(raw, [
        "description",
        "og:description",
        "twitter:description",
      ]));
  const canonicalUrl = isPlainText
    ? ""
    : decodeHtmlEntities(matchCanonicalUrl(raw));
  const visibleText = isPlainText ? normalizePlainText(raw) : htmlToVisibleText(raw);
  const truncatedText = truncateText(visibleText, MAX_EXTRACTED_TEXT_CHARS);

  return {
    title,
    description,
    canonicalUrl,
    visibleText: truncatedText.text,
    textTruncated: truncatedText.truncated,
  };
}

function buildOriginalTextForOntology(params: {
  ticker: string;
  userQuestion: string;
  sourceUrl: string;
  canonicalUrl: string;
  domain: string;
  title: string;
  description: string;
  visibleText: string;
  textTruncated: boolean;
}) {
  return [
    `Ticker: ${params.ticker}`,
    `User question: ${params.userQuestion.trim()}`,
    `Source URL: ${params.canonicalUrl || params.sourceUrl}`,
    `Domain: ${params.domain}`,
    `Title: ${params.title}`,
    params.description ? `Description: ${params.description}` : "",
    params.textTruncated
      ? "[The following visible page text was mechanically truncated for safety.]"
      : "[The following visible page text was mechanically extracted.]",
    params.visibleText,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function matchTitle(html: string): string {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
}

function matchMeta(html: string, names: string[]): string {
  for (const name of names) {
    const escaped = escapeRegex(name);
    const forward = new RegExp(
      `<meta\\s+[^>]*(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']*)["'][^>]*>`,
      "i",
    );
    const reverse = new RegExp(
      `<meta\\s+[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${escaped}["'][^>]*>`,
      "i",
    );
    const match = html.match(forward) ?? html.match(reverse);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function matchCanonicalUrl(html: string): string {
  const forward =
    /<link\s+[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*href=["']([^"']*)["'][^>]*>/i;
  const reverse =
    /<link\s+[^>]*href=["']([^"']*)["'][^>]*rel=["'][^"']*canonical[^"']*["'][^>]*>/i;
  return (html.match(forward) ?? html.match(reverse))?.[1]?.trim() ?? "";
}

function htmlToVisibleText(html: string): string {
  const withoutHidden = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ");
  const withBreaks = withoutHidden
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote)>/gi, "\n");
  const withoutTags = withBreaks.replace(/<[^>]+>/g, " ");
  return normalizePlainText(decodeHtmlEntities(withoutTags));
}

function normalizePlainText(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function truncateText(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit).trimEnd(), truncated: true };
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    if (lower === "nbsp") return " ";
    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    }
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    }
    return "";
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getRecordField(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const field = value[key];
  return field && typeof field === "object" && !Array.isArray(field)
    ? (field as Record<string, unknown>)
    : null;
}

function getStringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  return typeof field === "string" ? field : "";
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    return isPrivateIpv4(lower.slice("::ffff:".length));
  }

  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  );
}
