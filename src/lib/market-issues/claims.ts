export type MarketIssueClaimEvidence = {
  evidenceId: string;
  text: string;
};

export type MarketIssueClaim = {
  id: string;
  textKo: string;
  sourceQuote: string;
  rawValue: string | null;
  evidenceIds: string[];
};

export type MarketIssueClaimValidation = {
  claims: MarketIssueClaim[];
  valid: boolean;
  reason: string | null;
};

export type MarketIssuePublicDraft = {
  titleKo: string;
  summaryKo: string;
  impactPath: string[];
  confirmedFacts: string[];
  unconfirmedFacts: string[];
};

type Row = Record<string, unknown>;

const NUMERIC_REFERENCE_RE = /(?:[$€£¥₩]\s*)?\d[\d,.]*(?:\s*(?:billion|million|thousand|trillion|seats?|usd|krw|bps|bp|bn|mn|percent(?:age)?(?:\s+points?)?|%|조|억|만|원|달러|분기|B|M|K|T))?/gi;
const ENGLISH_QUARTER_TO_KOREAN: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bfirst\s+quarter\b/i, "1분기"],
  [/\bsecond\s+quarter\b/i, "2분기"],
  [/\bthird\s+quarter\b/i, "3분기"],
  [/\bfourth\s+quarter\b/i, "4분기"],
];

/**
 * Accepts only claims whose quoted support is an exact substring of one of the
 * supplied source materials. The model may phrase the Korean claim freely, but
 * it cannot introduce a number or source quote that is absent from the input.
 */
export function validateMarketIssueClaims(
  value: unknown,
  evidence: readonly MarketIssueClaimEvidence[],
): MarketIssueClaimValidation {
  if (!Array.isArray(value)) {
    return { claims: [], valid: false, reason: "claims_missing" };
  }

  const evidenceById = new Map(
    evidence
      .filter((entry) => entry.evidenceId && normalize(entry.text, 20_000))
      .map((entry) => [entry.evidenceId, normalizeForMatch(entry.text)]),
  );
  const claims: MarketIssueClaim[] = [];
  const seen = new Set<string>();

  for (const [index, item] of value.slice(0, 5).entries()) {
    const row = asRow(item);
    if (!row) continue;
    const textKo = normalize(row.claim_ko ?? row.claim ?? row.text, 360);
    const sourceQuote = normalize(row.source_quote ?? row.sourceQuote ?? row.quote, 700);
    const rawValue = nullable(row.raw_value ?? row.rawValue);
    const evidenceIds = stringArray(row.evidence_ids ?? row.evidenceIds, 4, 120)
      .filter((id) => evidenceById.has(id));
    const id = normalizeClaimId(row.id, index + 1);
    const key = sourceQuote.toLocaleLowerCase("en-US") + "|" + evidenceIds.join(",");

    if (!textKo || !sourceQuote || evidenceIds.length === 0 || seen.has(key)) continue;
    if (rawValue && !normalizeForMatch(sourceQuote).includes(normalizeForMatch(rawValue))) continue;
    if (!evidenceIds.some((evidenceId) => (
      evidenceById.get(evidenceId)?.includes(normalizeForMatch(sourceQuote))
    ))) continue;

    seen.add(key);
    claims.push({ id, textKo, sourceQuote, rawValue, evidenceIds });
  }

  return claims.length > 0
    ? { claims, valid: true, reason: null }
    : { claims: [], valid: false, reason: "claims_not_source_grounded" };
}

/**
 * Public copy may use a number only when the exact numeric/unit expression is
 * present in a validated claim quote or raw value. This intentionally rejects
 * model-side conversions such as "$90 billion" -> "90억 달러".
 */
export function validateMarketIssuePublicDraftNumbers(
  draft: MarketIssuePublicDraft,
  claims: readonly MarketIssueClaim[],
  evidence: readonly MarketIssueClaimEvidence[] = [],
): { valid: boolean; unsupportedReferences: string[] } {
  const allowedStrict = new Set<string>();
  const allowedPlainNumbers = new Set<string>();

  for (const claim of claims) {
    for (const value of [claim.sourceQuote, claim.rawValue || ""]) {
      for (const reference of numericReferences(value)) {
        if (reference.strict) allowedStrict.add(reference.normalized);
        else allowedPlainNumbers.add(reference.numberOnly);
      }
      for (const [pattern, koreanQuarter] of ENGLISH_QUARTER_TO_KOREAN) {
        if (pattern.test(value)) allowedStrict.add(koreanQuarter);
      }
    }
  }
  // Period labels such as FY26 and Q4 may be copied verbatim from the source
  // without becoming standalone fact cards. Financial units still require a
  // validated claim because only non-strict references are added here.
  for (const entry of evidence) {
    for (const reference of numericReferences(entry.text)) {
      if (!reference.strict) allowedPlainNumbers.add(reference.numberOnly);
    }
  }

  const unsupported = new Set<string>();
  const publicText = [
    draft.titleKo,
    draft.summaryKo,
    ...draft.impactPath,
    ...draft.confirmedFacts,
    ...draft.unconfirmedFacts,
  ].join("\n");
  for (const reference of numericReferences(publicText)) {
    const allowed = reference.strict
      ? allowedStrict.has(reference.normalized)
      : allowedPlainNumbers.has(reference.numberOnly);
    if (!allowed) unsupported.add(reference.raw);
  }

  return {
    valid: unsupported.size === 0,
    unsupportedReferences: [...unsupported].slice(0, 12),
  };
}

export function buildMarketIssueSafeFallback(input: {
  publisher: string;
  sourceText: string;
}): { titleKo: string; summaryKo: string } {
  const publisher = normalize(input.publisher, 120) || "공식 출처";
  const sourceText = input.sourceText.toLocaleLowerCase("en-US");
  let titleKo = publisher + ", 공식 X 게시물 업데이트";

  if (/(earnings|reported\s+.*results|quarter(?:ly)?\s+results|financial results)/i.test(sourceText)) {
    titleKo = publisher + ", 실적 발표";
  } else if (/(fomc|press conference)/i.test(sourceText)) {
    titleKo = publisher + ", FOMC 관련 공식 게시물";
  } else if (/(fees? and expenses|mutual fund|exchange-traded fund|\betf\b)/i.test(sourceText)) {
    titleKo = publisher + ", 펀드·ETF 비용 관련 안내";
  } else if (/(alliance|announc|introduc|launch|unveil|release)/i.test(sourceText)) {
    titleKo = publisher + ", 공식 발표 게시물";
  }

  return {
    titleKo,
    summaryKo: "공식 X 원문과 이미지에서 확인 가능한 내용은 리서치 패킷에 보관했습니다. 세부 수치와 해석은 원문 확인이 필요합니다.",
  };
}

function numericReferences(value: string): Array<{
  raw: string;
  normalized: string;
  numberOnly: string;
  strict: boolean;
}> {
  const references: Array<{
    raw: string;
    normalized: string;
    numberOnly: string;
    strict: boolean;
  }> = [];
  for (const match of value.matchAll(NUMERIC_REFERENCE_RE)) {
    const raw = normalize(match[0], 120);
    const digits = raw.match(/\d[\d,.]*/)?.[0]?.replace(/[,.]/g, "") || "";
    if (!raw || !digits) continue;
    references.push({
      raw,
      normalized: raw.replace(/[\s,]+/g, "").toLocaleLowerCase("en-US"),
      numberOnly: digits,
      strict: /[$€£¥₩%]|(?:billion|million|thousand|trillion|seats?|usd|krw|bps|bp|bn|mn|percent(?:age)?(?:\s+points?)?|조|억|만|원|달러|분기|[BMKT])$/i.test(raw),
    });
  }
  return references;
}

function normalizeClaimId(value: unknown, fallbackIndex: number): string {
  const normalized = normalize(value, 80)
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "claim-" + fallbackIndex;
}

function normalizeForMatch(value: string): string {
  return normalize(value, 20_000).replace(/\s+/g, "").toLocaleLowerCase("en-US");
}

function stringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalize(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function nullable(value: unknown): string | null {
  const normalized = normalize(value, 160);
  return normalized || null;
}

function normalize(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function asRow(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}
