import "server-only";

import type { ResolvedSession } from "@/lib/api/chat";
import { buildNewsDiscoveryIntent } from "@/lib/news-discovery/intent";
import { composeNewsDiscoveryCards } from "@/lib/news-discovery/card-composer";
import {
  EXCLUDED_NEWS_DISCOVERY_DOMAINS,
  PREFERRED_MARKET_NEWS_DOMAINS,
  filterPreferredMarketSources,
} from "@/lib/news-discovery/source-policy";
import {
  searchCompanyNewsEvents,
  searchMarketNewsEvents,
} from "@/lib/news-discovery/stock-news-client";
import type {
  NewsDiscoveryCardComposition,
  NewsDiscoverySearchResult,
} from "@/lib/news-discovery/types";

export async function discoverNewsCards(params: {
  question: string;
  session: ResolvedSession;
}): Promise<{
  discovery: NewsDiscoverySearchResult;
  composition: NewsDiscoveryCardComposition;
}> {
  const intent = await buildNewsDiscoveryIntent({
    question: params.question,
    session: params.session,
  });
  const rawSearchResult = intent.ticker
    ? await searchCompanyNewsEvents({
        question: intent.englishQuestion,
        ticker: intent.ticker,
        company: intent.companyName,
        lookback_hours: intent.lookbackHours,
        max_events: 8,
        mode: "market_narrative_discovery",
        exclude_official_sources: true,
        price_move_direction: intent.direction,
      })
    : await searchMarketNewsEvents({
        question: intent.englishQuestion,
        lookback_hours: intent.lookbackHours,
        max_events: 8,
        mode: "market_narrative_discovery",
        exclude_official_sources: true,
        price_move_direction: intent.direction,
      });
  const discovery: NewsDiscoverySearchResult = {
    intent,
    rawSearchResult: filterPreferredMarketSources(rawSearchResult),
    selectedSourcePolicy: {
      allowed_domains: PREFERRED_MARKET_NEWS_DOMAINS,
      excluded_domains: EXCLUDED_NEWS_DISCOVERY_DOMAINS,
      market_news_only: true,
    },
  };

  return {
    discovery,
    composition: await composeNewsDiscoveryCards(discovery),
  };
}
