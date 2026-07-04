type JsonRecord = Record<string, unknown>;

const SAFE_STRING_FIELDS = [
  "longName",
  "shortName",
  "symbol",
  "quoteType",
  "exchange",
  "market",
  "sector",
  "industry",
  "website",
] as const;

const SAFE_QUOTE_NUMBER_FIELDS = [
  "currentPrice",
  "regularMarketPrice",
  "regularMarketPreviousClose",
  "previousClose",
  "open",
  "regularMarketOpen",
  "dayLow",
  "regularMarketDayLow",
  "dayHigh",
  "regularMarketDayHigh",
  "regularMarketChange",
  "regularMarketChangePercent",
  "regularMarketVolume",
  "volume",
  "averageVolume",
  "averageDailyVolume10Day",
  "averageVolume10days",
] as const;

const SAFE_TECHNICAL_NUMBER_FIELDS = [
  "fiftyDayAverage",
  "twoHundredDayAverage",
  "fiftyTwoWeekLow",
  "fiftyTwoWeekHigh",
] as const;

const SAFE_SIZE_NUMBER_FIELDS = [
  "marketCap",
  "sharesOutstanding",
  "floatShares",
] as const;

export const YAHOO_STOCK_INFO_EXCLUDED_FIELD_POLICY =
  "Yahoo Finance get_stock_info is limited to quote, trading range, technical position, company identity, and size fields. Valuation, analyst consensus, target price, recommendation, and growth-estimate fields are excluded because Yahoo API values can be stale, opaque, or inconsistent with Yahoo web display.";

export function buildSafeYahooStockInfo(raw: JsonRecord): JsonRecord {
  return dropEmptyRecords({
    schema_version: "safe-yahoo-stock-info/v1",
    identity: pickStringFields(raw, SAFE_STRING_FIELDS),
    quote: pickNumberFields(raw, SAFE_QUOTE_NUMBER_FIELDS),
    technical: pickNumberFields(raw, SAFE_TECHNICAL_NUMBER_FIELDS),
    size: pickNumberFields(raw, SAFE_SIZE_NUMBER_FIELDS),
    policy: {
      excluded_fields_reason: YAHOO_STOCK_INFO_EXCLUDED_FIELD_POLICY,
    },
  });
}

function pickStringFields(
  source: JsonRecord,
  fields: readonly string[],
): JsonRecord {
  const result: JsonRecord = {};
  for (const field of fields) {
    const value = source[field];
    if (typeof value === "string" && value.trim()) {
      result[field] = value.trim();
    }
  }
  return result;
}

function pickNumberFields(
  source: JsonRecord,
  fields: readonly string[],
): JsonRecord {
  const result: JsonRecord = {};
  for (const field of fields) {
    const value = source[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      result[field] = value;
    }
  }
  return result;
}

function dropEmptyRecords(source: JsonRecord): JsonRecord {
  const result: JsonRecord = {};
  for (const [key, value] of Object.entries(source)) {
    if (
      isPlainRecord(value) &&
      Object.keys(value).length === 0
    ) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

function isPlainRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
