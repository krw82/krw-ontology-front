const SAFE_TICKER_PATTERN = /^[A-Z0-9]{1,12}$/;

export function normalizeTicker(ticker: string): string | null {
  const normalized = ticker.trim().toUpperCase();
  return SAFE_TICKER_PATTERN.test(normalized) ? normalized : null;
}
