import { normalizeTicker } from "@/lib/ontology/ticker";

export type MarketMoveDirection = "down" | "up" | "unknown";

const DOWN_PATTERNS = [
  /빠졌|빠진|빠져|하락|급락|조정|떨어졌|떨어진|내렸|내린|약세|매도|손절/u,
  /\b(?:fall|falls|falling|fell|drop|drops|dropped|decline|declines|declined|down|sell[-\s]?off|pullback|weakness)\b/i,
];

const UP_PATTERNS = [
  /올랐|오른|상승|급등|반등|강세|뛰었|랠리/u,
  /\b(?:rise|rises|rising|rose|jump|jumps|jumped|rally|rallied|gain|gains|gained|up|surge|surged)\b/i,
];

const MARKET_MOVE_CONTEXT_PATTERNS = [
  /주가|주식|가격\s*변동|시간외|장전|장후|프리마켓|애프터마켓|시총|조정|급락|급등|하락|상승/u,
  /\b(?:stock|share|shares|price|market|premarket|pre-market|after-hours|after hours|rally|sell-off|pullback)\b/i,
];

const NEUTRAL_MOVE_PATTERNS = [
  /가격\s*변동|주가\s*변동|왜\s*(?:움직|변동)|움직였|움직임|무슨\s*일/u,
  /\b(?:why|what).*(?:move|moved|moving|happen|happened)|price\s+move/i,
];

const TICKER_PATTERN = /\$?\b[A-Z][A-Z0-9.-]{0,11}\b/g;
const TICKER_STOP_WORDS = new Set([
  "AI",
  "API",
  "CEO",
  "CFO",
  "COO",
  "CTO",
  "SEC",
  "IR",
  "US",
  "USA",
  "NYSE",
  "NASDAQ",
  "Q",
  "QOQ",
  "YOY",
]);

export function isMarketMoveQuestion(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  const hasDirection =
    DOWN_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    UP_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasNeutralMove = NEUTRAL_MOVE_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  if (!hasDirection && !hasNeutralMove) return false;
  return MARKET_MOVE_CONTEXT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function inferMarketMoveDirection(text: string): MarketMoveDirection {
  const normalized = text.trim();
  const hasDown = DOWN_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasUp = UP_PATTERNS.some((pattern) => pattern.test(normalized));
  if (hasDown && !hasUp) return "down";
  if (hasUp && !hasDown) return "up";
  return "unknown";
}

export function extractMentionedTickers(text: string): string[] {
  const tickers = new Set<string>();
  for (const match of text.matchAll(TICKER_PATTERN)) {
    const raw = match[0]?.replace(/^\$/, "");
    if (!raw || TICKER_STOP_WORDS.has(raw)) continue;
    const normalized = normalizeTicker(raw);
    if (normalized) tickers.add(normalized);
  }
  return Array.from(tickers);
}

export function extractMentionedPercentMove(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:%|퍼센트|퍼|프로)/u);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}
