const SAFE_TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;
const BLOCKED_TICKERS = new Set(["UNKNOWN"]);

export function normalizeTicker(ticker: string): string | null {
  const normalized = ticker.trim().toUpperCase();
  return SAFE_TICKER_PATTERN.test(normalized) && !BLOCKED_TICKERS.has(normalized)
    ? normalized
    : null;
}

export function normalizeTickers(tickers: readonly string[]): string[] {
  return Array.from(
    new Set(
      tickers
        .map(normalizeTicker)
        .filter((ticker): ticker is string => Boolean(ticker)),
    ),
  );
}
