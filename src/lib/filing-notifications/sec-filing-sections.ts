/**
 * Deterministic, in-memory SEC filing section extraction.
 *
 * This module deliberately does not write a document body anywhere.  It turns
 * a single fetched SEC document into small, addressable sections for the
 * lifetime of the request/cache entry only.
 */

export type FilingSectionKind = "sec_item" | "document_section" | "primary_document";

export type FilingSectionConfidence = "exact" | "heuristic" | "fallback";

export type FilingSection = {
  key: string;
  kind: FilingSectionKind;
  heading: string;
  itemCode: string | null;
  text: string;
  confidence: FilingSectionConfidence;
};

export type ParsedFilingSections = {
  /** Kept only in the caller's process; never written to the database. */
  normalizedText: string;
  sections: FilingSection[];
  normalizedTextLength: number;
  truncated: boolean;
};

export type ParseFilingSectionsOptions = {
  form: string;
  maxDocumentChars?: number;
};

const DEFAULT_MAX_DOCUMENT_CHARS = 1_500_000;

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  quot: '"',
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  bull: "•",
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, token) => {
    const normalized = String(token).toLowerCase();
    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return ENTITY_MAP[normalized] ?? entity;
  });
}

function normalizeLine(value: string): string {
  return value.replace(/[\t\f\v ]+/g, " ").trim();
}

/** Exported for fixtures and safe, deterministic source previews. */
export function normalizeSecHtmlToText(html: string, maxDocumentChars = DEFAULT_MAX_DOCUMENT_CHARS): {
  text: string;
  truncated: boolean;
} {
  const withoutNonContent = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|hr)\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6]|table|section|article|header|footer|td|th)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const normalized = decodeHtmlEntities(withoutNonContent)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean)
    .join("\n");

  return {
    text: normalized.slice(0, maxDocumentChars),
    truncated: normalized.length > maxDocumentChars,
  };
}

type SectionCandidate = FilingSection & { sourceIndex: number };

function makePrimaryDocument(text: string): FilingSection {
  return {
    key: "document:primary",
    kind: "primary_document",
    heading: "Primary filing document",
    itemCode: null,
    text,
    confidence: "fallback",
  };
}

function parseEightKSections(lines: string[]): FilingSection[] {
  const headings = lines
    .map((line, index) => {
      const match = line.match(/^item\s+(\d{1,2}\.\d{2})\b\s*[.\-–—:]*\s*(.*)$/i);
      if (!match) return null;

      const itemCode = match[1];
      const suffix = normalizeLine(match[2]);
      return {
        index,
        itemCode,
        heading: suffix ? `Item ${itemCode} — ${suffix}` : `Item ${itemCode}`,
      };
    })
    .filter((heading): heading is { index: number; itemCode: string; heading: string } => heading !== null);

  if (headings.length === 0) return [];

  const candidates: SectionCandidate[] = headings.map((heading, position) => {
    const nextIndex = headings[position + 1]?.index ?? lines.length;
    const text = lines.slice(heading.index + 1, nextIndex).join("\n").trim();
    return {
      key: `item:${heading.itemCode}`,
      kind: "sec_item",
      heading: heading.heading,
      itemCode: heading.itemCode,
      text,
      confidence: "exact",
      sourceIndex: heading.index,
    };
  });

  // SEC filing tables of contents often repeat the same Item headings. Keep
  // the longest candidate, which deterministically selects the body section.
  const byItem = new Map<string, SectionCandidate>();
  for (const candidate of candidates) {
    const existing = byItem.get(candidate.key);
    if (!existing || candidate.text.length > existing.text.length || (candidate.text.length === existing.text.length && candidate.sourceIndex > existing.sourceIndex)) {
      byItem.set(candidate.key, candidate);
    }
  }

  return [...byItem.values()]
    .sort((left, right) => left.sourceIndex - right.sourceIndex)
    .map((section) => ({
      key: section.key,
      kind: section.kind,
      heading: section.heading,
      itemCode: section.itemCode,
      text: section.text,
      confidence: section.confidence,
    }));
}

function isLikelySixKHeading(line: string): boolean {
  if (line.length < 3 || line.length > 180) return false;
  if (/[.!?;:]$/.test(line)) return false;
  if (/^(table of contents|signatures?|exhibits?)$/i.test(line)) return false;

  const letters = line.match(/[A-Za-z]/g) ?? [];
  if (letters.length < 3) return false;
  const uppercase = letters.filter((letter) => letter === letter.toUpperCase()).length;
  return uppercase / letters.length >= 0.72;
}

function sectionKeyFromHeading(heading: string, position: number): string {
  const normalized = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return `section:${normalized || "untitled"}:${position + 1}`;
}

function parseSixKSections(lines: string[]): FilingSection[] {
  const headings = lines
    .map((line, index) => (isLikelySixKHeading(line) ? { index, heading: line } : null))
    .filter((heading): heading is { index: number; heading: string } => heading !== null);

  if (headings.length === 0) return [];

  return headings
    .map((heading, position) => {
      const nextIndex = headings[position + 1]?.index ?? lines.length;
      return {
        key: sectionKeyFromHeading(heading.heading, position),
        kind: "document_section" as const,
        heading: heading.heading,
        itemCode: null,
        text: lines.slice(heading.index + 1, nextIndex).join("\n").trim(),
        confidence: "heuristic" as const,
      };
    })
    // A heading with no following content is not useful as an addressable section.
    .filter((section) => section.text.length > 0);
}

export function parseSecFilingSections(html: string, options: ParseFilingSectionsOptions): ParsedFilingSections {
  const { text, truncated } = normalizeSecHtmlToText(html, options.maxDocumentChars);
  const lines = text.split("\n").filter(Boolean);
  const normalizedForm = options.form.trim().toUpperCase().replace(/\s+/g, "");

  const sections = normalizedForm === "8-K" || normalizedForm === "8-K/A"
    ? parseEightKSections(lines)
    : normalizedForm === "6-K" || normalizedForm === "6-K/A"
      ? parseSixKSections(lines)
      : [];

  return {
    normalizedText: text,
    sections: sections.length > 0 ? sections : [makePrimaryDocument(text)],
    normalizedTextLength: text.length,
    truncated,
  };
}

export function findFilingSection(sections: FilingSection[], sectionKey: string): FilingSection | null {
  return sections.find((section) => section.key === sectionKey) ?? null;
}
