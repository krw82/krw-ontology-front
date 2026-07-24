/**
 * Persist an explicit interest choice before entering company-context chat.
 * Authorization, limits, idempotency, and analytics remain owned by the
 * existing watchlist route.
 */
export async function saveInterestCoverage(ticker: string): Promise<void> {
  const response = await fetch(`/api/watchlist/${encodeURIComponent(ticker)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coverage_level: "interest" }),
  });

  if (!response.ok) throw new Error("interest_coverage_save_failed");
}
