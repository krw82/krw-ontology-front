import "server-only";

import { getIndexedCompanies } from "@/lib/ontology/catalog";
import { extractMentionedTickers } from "@/lib/market-move/intent";

export interface MarketMoveTarget {
  ticker: string;
  companyName: string | null;
}

export async function resolveMarketMoveTarget(params: {
  content: string;
  defaultTickers: string[];
}): Promise<MarketMoveTarget | null> {
  const defaultTicker = params.defaultTickers[0]?.trim().toUpperCase();
  if (defaultTicker) {
    const [company] = await getIndexedCompanies([defaultTicker]).catch(() => []);
    return {
      ticker: company?.ticker ?? defaultTicker,
      companyName: company?.name ?? null,
    };
  }

  const mentionedTickers = extractMentionedTickers(params.content);
  if (mentionedTickers.length === 0) return null;

  const indexedCompanies = await getIndexedCompanies(mentionedTickers).catch(
    () => [],
  );
  const indexedByTicker = new Map(
    indexedCompanies.map((company) => [company.ticker, company]),
  );

  for (const ticker of mentionedTickers) {
    const company = indexedByTicker.get(ticker);
    if (company) {
      return {
        ticker: company.ticker,
        companyName: company.name ?? null,
      };
    }
  }

  return null;
}
