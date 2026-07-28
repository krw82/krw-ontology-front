import { defaultLocalizedPath } from "@/i18n/routing";
import type { PulseItem } from "@/types/api-contracts";

export function pulseCompanyName(
  item: Pick<PulseItem, "ticker" | "metadata">,
): string {
  const localizedName = item.metadata.company_name_ko;
  if (typeof localizedName === "string" && localizedName.trim()) {
    return localizedName.trim();
  }

  return item.ticker?.trim() || "KRW.O";
}

export function pulseCompanyHref(ticker: string | null): string | null {
  const normalizedTicker = ticker?.trim().toUpperCase();
  if (!normalizedTicker) return null;

  return defaultLocalizedPath(`/companies/${encodeURIComponent(normalizedTicker)}`);
}
