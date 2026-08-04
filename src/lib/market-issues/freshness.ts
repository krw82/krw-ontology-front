type SourceRecord = Record<string, unknown>;

export type MarketIssueFreshnessDecision = {
  eligible: boolean;
  maxAgeDays: number;
  reason: "fresh" | "missing_published_at" | "inferred_published_at" | "outside_window";
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function maxAgeDaysFor(source: SourceRecord): number {
  if (text(source.source_type) === "x") return 7;
  if (text(source.source_type) === "sec") return 30;

  const sourceClass = text(source.source_class);
  if (["government", "regulator", "company_official", "exchange"].includes(sourceClass)) {
    return 30;
  }
  return 14;
}

/**
 * Keeps historical source material for audit and research while preventing an
 * initial source backfill from being treated as a current market event.
 */
export function assessMarketIssueFreshness(
  source: SourceRecord,
  sourceItem: SourceRecord,
  now = Date.now(),
): MarketIssueFreshnessDecision {
  const maxAgeDays = maxAgeDaysFor(source);
  if (sourceItem.published_at_is_inferred === true) {
    return { eligible: false, maxAgeDays, reason: "inferred_published_at" };
  }

  const publishedAt = Date.parse(text(sourceItem.published_at));
  if (!Number.isFinite(publishedAt)) {
    return { eligible: false, maxAgeDays, reason: "missing_published_at" };
  }

  if (publishedAt < now - maxAgeDays * 24 * 60 * 60 * 1000) {
    return { eligible: false, maxAgeDays, reason: "outside_window" };
  }
  return { eligible: true, maxAgeDays, reason: "fresh" };
}
