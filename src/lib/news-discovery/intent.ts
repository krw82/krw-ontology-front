import type { ResolvedSession } from "@/lib/api/chat";
import type {
  NewsDiscoveryIntent,
  NewsPriceMoveDirection,
} from "@/lib/news-discovery/types";
import { resolveNewsEntities } from "@/lib/news-discovery/stock-news-client";

const DEFAULT_LOOKBACK_HOURS = 168;

export async function buildNewsDiscoveryIntent(params: {
  question: string;
  session: ResolvedSession;
}): Promise<NewsDiscoveryIntent> {
  const originalQuestion = params.question.trim();
  const direction = inferPriceMoveDirection(originalQuestion);
  const defaultTickers = params.session.defaultTickers
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean);
  const resolved = await safeResolveNewsEntities({
    question: originalQuestion,
    tickers: defaultTickers,
  });
  const entity = findPrimaryResolvedEntity(resolved);
  const ticker = stringValue(entity?.ticker) ?? defaultTickers[0];
  const companyName =
    stringValue(entity?.company_name) ??
    stringValue(entity?.companyName) ??
    stringValue(entity?.coverage, "company_name");

  return {
    originalQuestion,
    englishQuestion: buildEnglishSearchQuestion({
      originalQuestion,
      direction,
      ticker,
      companyName,
    }),
    direction,
    ticker,
    companyName,
    resolvedEntities: readRecordArray(resolved.entities),
    lookbackHours: readLookbackHours(resolved) ?? DEFAULT_LOOKBACK_HOURS,
  };
}

export function inferPriceMoveDirection(
  question: string,
): NewsPriceMoveDirection {
  if (
    /떨어|하락|약세|급락|내려|빠졌|빠져|팔리|sell[-\s]?off|drop|fall|fell|down|weak/i.test(
      question,
    )
  ) {
    return "down";
  }
  if (
    /오르|상승|강세|급등|올랐|올라|rally|rise|rose|up|gain|jump/i.test(
      question,
    )
  ) {
    return "up";
  }
  return "unknown";
}

export function buildEnglishSearchQuestion(params: {
  originalQuestion: string;
  direction: NewsPriceMoveDirection;
  ticker?: string;
  companyName?: string;
}): string {
  const subject = [params.ticker, params.companyName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const directionPhrase =
    params.direction === "down"
      ? "why shares are falling stock drop negative market reaction"
      : params.direction === "up"
        ? "why shares are rising stock gain positive market reaction"
        : "latest stock market reaction material company news";
  const sourceHint =
    "Reuters Bloomberg CNBC WSJ MarketWatch AP Yahoo Finance Google News";
  const originalHint = sanitizeQuestionForSearch(params.originalQuestion);

  return [
    subject || originalHint,
    directionPhrase,
    "latest market news",
    sourceHint,
    originalHint && !subject ? "" : originalHint,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function safeResolveNewsEntities(params: {
  question: string;
  tickers: string[];
}): Promise<Record<string, unknown>> {
  try {
    return await resolveNewsEntities({
      question: params.question,
      tickers: params.tickers.length > 0 ? params.tickers : undefined,
    });
  } catch {
    return { entities: [] };
  }
}

function findPrimaryResolvedEntity(
  resolved: Record<string, unknown>,
): Record<string, unknown> | null {
  const entities = readRecordArray(resolved.entities);
  return entities[0] ?? null;
}

function readLookbackHours(resolved: Record<string, unknown>): number | null {
  const period = isRecord(resolved.period) ? resolved.period : null;
  const value = period?.lookback_hours;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

function sanitizeQuestionForSearch(question: string): string {
  return question
    .replace(/[^\p{Letter}\p{Number}\s.$%+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function stringValue(value: unknown, nestedKey?: string): string | undefined {
  const candidate =
    nestedKey && isRecord(value) ? value[nestedKey] : value;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : undefined;
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
