export type FilingDocumentCandidate = {
  sequence: number | null;
  documentName: string;
  documentType: string | null;
  description: string | null;
  documentUrl: string;
  sizeBytes: number | null;
  isPrimary: boolean;
  recommendationScore: number;
};

/**
 * SEC exposes Form 4's browser-rendered XSL view beside the source ownership
 * XML. The primary-document metadata can encode the XSL path separator as
 * `%2F`, which otherwise looks like an ordinary XML URL.
 */
export function isSecXslRenderedDocumentUrl(value: string): boolean {
  return /\/xsl[^/%]*(?:\/|%2f)/i.test(value);
}

export function parseFilingIndexDocuments(params: {
  html: string;
  filingDetailUrl: string;
  primaryDocumentName: string | null;
}): FilingDocumentCandidate[] {
  const candidates: FilingDocumentCandidate[] = [];
  const rows = params.html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const cells = row.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi) ?? [];
    if (cells.length < 3) continue;
    const documentCell = cells[2];
    if (!documentCell) continue;
    const href = firstHref(documentCell);
    if (!href || !isDocumentHref(href)) continue;
    const documentUrl = toDocumentUrl(href, params.filingDetailUrl);
    if (!documentUrl) continue;
    const documentName = documentUrl.pathname.split("/").pop();
    if (!documentName) continue;
    const sequence = asSequence(textContent(cells[0] ?? ""));
    const description = nullableText(textContent(cells[1] ?? ""));
    const documentType = nullableText(textContent(cells[3] ?? ""));
    const sizeBytes = asSize(textContent(cells[4] ?? ""));
    const isPrimary = Boolean(params.primaryDocumentName && documentName === params.primaryDocumentName);
    candidates.push({
      sequence,
      documentName,
      documentType,
      description,
      documentUrl: documentUrl.href,
      sizeBytes,
      isPrimary,
      recommendationScore: recommendationScore({ documentType, description, isPrimary }),
    });
  }
  return dedupeDocuments(candidates);
}

function firstHref(value: string): string | null {
  const match = value.match(/href\s*=\s*["']([^"']+)["']/i);
  return match?.[1] ?? null;
}

function isDocumentHref(value: string): boolean {
  return !value.startsWith("#") && !/^https?:\/\/www\.sec\.gov\/ixviewer/i.test(value);
}

function toDocumentUrl(value: string, base: string): URL | null {
  try {
    const url = new URL(value.replaceAll("&amp;", "&"), base);
    if (url.protocol !== "https:" || url.hostname !== "www.sec.gov") return null;
    return url;
  } catch {
    return null;
  }
}

function textContent(value: string): string {
  return decodeHtml(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function nullableText(value: string): string | null {
  return value ? value.slice(0, 1000) : null;
}

function asSequence(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null;
}

function asSize(value: string): number | null {
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const size = Number(digits);
  return Number.isSafeInteger(size) ? size : null;
}

function recommendationScore(params: {
  documentType: string | null;
  description: string | null;
  isPrimary: boolean;
}): number {
  const type = params.documentType?.toUpperCase() ?? "";
  const description = params.description?.toLowerCase() ?? "";
  if (/^EX-99(?:\.1)?$/.test(type) && /(earnings|results|release|financial)/.test(description)) return 100;
  if (/^EX-99/.test(type)) return 85;
  if (/^EX-10/.test(type)) return 80;
  if (/^EX-2/.test(type)) return 75;
  if (params.isPrimary) return 60;
  return 0;
}

function dedupeDocuments(candidates: FilingDocumentCandidate[]): FilingDocumentCandidate[] {
  // The SEC index can list an XSL-rendered Form 4 XML and the underlying
  // ownership XML with the same basename. They are distinct documents for
  // selection purposes, so only dedupe an identical canonical URL.
  const byUrl = new Map<string, FilingDocumentCandidate>();
  for (const candidate of candidates) {
    const existing = byUrl.get(candidate.documentUrl);
    if (!existing || candidate.recommendationScore > existing.recommendationScore) {
      byUrl.set(candidate.documentUrl, candidate);
    }
  }
  return [...byUrl.values()].sort(
    (left, right) => right.recommendationScore - left.recommendationScore || (left.sequence ?? Infinity) - (right.sequence ?? Infinity),
  );
}
