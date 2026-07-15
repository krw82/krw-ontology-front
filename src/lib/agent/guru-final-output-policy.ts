/**
 * User-visible Guru answers are deliberately qualitative. The research and
 * evidence layers may retain exact figures, but this boundary prevents those
 * figures from reaching rendered consultation prose.
 */

export type GuruFinalOutputViolationCode =
  | "numeric_literal"
  | "numbered_list"
  | "quantitative_word";

export interface GuruFinalOutputViolation {
  code: GuruFinalOutputViolationCode;
  match: string;
  index: number;
}

export interface GuruFinalOutputPolicyOptions {
  /**
   * Proper names and tickers can legitimately contain digits (for example,
   * `3M`). These identifiers are masked before quantitative inspection.
   */
  allowedIdentifiers?: readonly string[];
}

export interface GuruFinalOutputInspection {
  inspectedText: string;
  violations: readonly GuruFinalOutputViolation[];
  requiresRewrite: boolean;
}

export interface GuruFinalOutputRewriteInspection {
  before: GuruFinalOutputInspection;
  after: GuruFinalOutputInspection;
  accepted: boolean;
}

const NUMERIC_LITERAL_PATTERN = /\d+(?:[,.]\d+)*/g;
const NUMBERED_LIST_PATTERN = /^\s*\d+[.)]\s+/gm;
const KOREAN_QUANTITATIVE_WORD_PATTERN =
  /(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|몇)\s*(?:배|번|가지|개|차례)|(?:첫|둘|셋|넷)\s*째|절반|반절|반으로|두세\s*(?:배|번|가지|개)/g;
const ENGLISH_QUANTITATIVE_WORD_PATTERN =
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|half|double|triple|first|second|third|fourth|fifth)\b/gi;

/**
 * Inspects only visible Markdown text. Link destinations and reference
 * definitions are intentionally removed so a filing URL containing a year or
 * accession number does not become a false quantitative violation.
 */
export function inspectGuruFinalOutput(
  content: string,
  options: GuruFinalOutputPolicyOptions = {},
): GuruFinalOutputInspection {
  const inspectedText = maskAllowedIdentifiers(
    stripNonVisibleMarkdown(content),
    options.allowedIdentifiers ?? [],
  );
  const violations = [
    ...findMatches(inspectedText, NUMBERED_LIST_PATTERN, "numbered_list"),
    ...findMatches(inspectedText, NUMERIC_LITERAL_PATTERN, "numeric_literal"),
    ...findMatches(
      inspectedText,
      KOREAN_QUANTITATIVE_WORD_PATTERN,
      "quantitative_word",
    ),
    ...findMatches(
      inspectedText,
      ENGLISH_QUANTITATIVE_WORD_PATTERN,
      "quantitative_word",
    ),
  ].sort((left, right) => left.index - right.index || left.code.localeCompare(right.code));

  return {
    inspectedText,
    violations,
    requiresRewrite: violations.length > 0,
  };
}

/**
 * Runs the same inspection on a rewrite result. The caller must not publish a
 * rewritten answer unless this returns accepted=true.
 */
export function inspectGuruFinalOutputRewrite(
  original: string,
  rewritten: string,
  options: GuruFinalOutputPolicyOptions = {},
): GuruFinalOutputRewriteInspection {
  const before = inspectGuruFinalOutput(original, options);
  const after = inspectGuruFinalOutput(rewritten, options);
  return { before, after, accepted: !after.requiresRewrite };
}

export function canPublishGuruFinalOutput(
  content: string,
  options: GuruFinalOutputPolicyOptions = {},
): boolean {
  return !inspectGuruFinalOutput(content, options).requiresRewrite;
}

function stripNonVisibleMarkdown(content: string): string {
  return content
    // Markdown reference definitions are not rendered in the answer body.
    .replace(/^\s*\[[^\]]+]:\s+\S+.*$/gm, "")
    // Preserve visible link/image labels while removing their destinations.
    .replace(/(!?\[[^\]]*])\((?:\\.|[^()])*\)/g, "$1")
    // Autolink and bare URL destinations are not quantitative prose.
    .replace(/<https?:\/\/[^>\s]+>/gi, "")
    .replace(/https?:\/\/[^\s<>)\]}]+/gi, "");
}

function maskAllowedIdentifiers(
  content: string,
  identifiers: readonly string[],
): string {
  const uniqueIdentifiers = Array.from(
    new Set(
      identifiers
        .map((identifier) => identifier.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => right.length - left.length);

  return uniqueIdentifiers.reduce(
    (masked, identifier) =>
      masked.replace(
        new RegExp(escapeRegExp(identifier), "gi"),
        "GURU_PROPER_IDENTIFIER",
      ),
    content,
  );
}

function findMatches(
  content: string,
  pattern: RegExp,
  code: GuruFinalOutputViolationCode,
): GuruFinalOutputViolation[] {
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const matches: GuruFinalOutputViolation[] = [];
  for (const match of content.matchAll(globalPattern)) {
    if (typeof match.index !== "number") continue;
    matches.push({ code, match: match[0], index: match.index });
  }
  return matches;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
