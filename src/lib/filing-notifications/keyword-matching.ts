export type FilingKeywordRuleCandidate = {
  id: string;
  userId: string;
  phrase: string;
};

export type FilingKeywordMatchCandidate = FilingKeywordRuleCandidate & {
  matchedContext: string;
};

export function findFilingKeywordMatches(
  html: string,
  rules: FilingKeywordRuleCandidate[],
): FilingKeywordMatchCandidate[] {
  const text = toSearchableText(html);
  const lowerText = text.toLocaleLowerCase("en-US");
  const matches: FilingKeywordMatchCandidate[] = [];
  for (const rule of rules) {
    const phrase = rule.phrase.trim();
    if (!phrase) continue;
    const index = lowerText.indexOf(phrase.toLocaleLowerCase("en-US"));
    if (index < 0) continue;
    matches.push({ ...rule, matchedContext: contextAround(text, index, phrase.length) });
  }
  return matches;
}

export function toSearchableText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim().slice(0, 500_000);
}

function contextAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 120);
  const end = Math.min(text.length, index + length + 180);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`.slice(0, 600);
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
