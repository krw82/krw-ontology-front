export const PREFERRED_MARKET_NEWS_DOMAINS = [
  "reuters.com",
  "bloomberg.com",
  "cnbc.com",
  "wsj.com",
  "marketwatch.com",
  "apnews.com",
  "finance.yahoo.com",
  "yahoo.com",
  "news.google.com",
  "barrons.com",
  "ft.com",
  "investors.com",
];

export const EXCLUDED_NEWS_DISCOVERY_DOMAINS = [
  "sec.gov",
  "annualreports.com",
  "tradingview.com",
  "barchart.com",
];

export function filterPreferredMarketSources<T extends Record<string, unknown>>(
  rawResult: T,
): T {
  const cloned = jsonClone(rawResult) as T;
  filterRecordInPlace(cloned);
  return cloned;
}

export function isPreferredMarketNewsUrl(value: unknown): boolean {
  const domain = domainFromUnknown(value);
  if (!domain) return false;
  if (EXCLUDED_NEWS_DISCOVERY_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))) {
    return false;
  }
  return PREFERRED_MARKET_NEWS_DOMAINS.some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
  );
}

export function isPreferredMarketNewsSource(value: unknown): boolean {
  if (!isRecord(value)) return isPreferredMarketNewsUrl(value);
  const url = value.url ?? value.canonical_url ?? value.link;
  if (isPreferredMarketNewsUrl(url)) return true;
  if (!isFinnhubProxyUrl(url)) return false;

  const publisher = [
    value.publisher,
    value.source_name,
    value.source,
    value.domain,
  ]
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .toLowerCase();
  return /reuters|bloomberg|cnbc|wsj|wall street journal|marketwatch|ap news|associated press|yahoo|barron|financial times|ft\.com/.test(
    publisher,
  );
}

export function displayableMarketNewsUrl(value: unknown): string | undefined {
  return isPreferredMarketNewsUrl(value) && typeof value === "string"
    ? value
    : undefined;
}

export function extractPreferredSourceUrls(
  event: Record<string, unknown>,
  limit = 2,
): string[] {
  const urls: string[] = [];
  const add = (value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return;
    if (!isPreferredMarketNewsUrl(value)) return;
    if (!urls.includes(value)) urls.push(value);
  };

  const primarySource = isRecord(event.primary_source)
    ? event.primary_source
    : null;
  add(primarySource?.url);

  for (const source of readRecordArray(event.source_previews)) {
    add(source.url);
  }
  for (const value of readStringArray(event.major_news_urls)) add(value);
  for (const value of readStringArray(event.reader_urls)) add(value);

  return urls.slice(0, limit);
}

function filterRecordInPlace(record: Record<string, unknown>) {
  for (const key of [
    "articles",
    "source_previews",
    "primary_sources",
    "secondary_sources",
  ]) {
    const value = record[key];
    if (Array.isArray(value)) {
      record[key] = value.filter((item) => {
        if (!isRecord(item)) return false;
        return isPreferredMarketNewsSource(item);
      });
    }
  }

  for (const key of ["cards", "events", "atomic_events", "event_candidates"]) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    record[key] = value
      .filter(isRecord)
      .map((item) => {
        filterRecordInPlace(item);
        return item;
      })
      .filter((item) => {
        const previews = readRecordArray(item.source_previews);
        const primary = isRecord(item.primary_source) ? item.primary_source : null;
        const directUrls = [
          primary?.url,
          ...readStringArray(item.major_news_urls),
          ...readStringArray(item.reader_urls),
        ];
        return (
          previews.some(isPreferredMarketNewsSource) ||
          (primary ? isPreferredMarketNewsSource(primary) : false) ||
          directUrls.some((url) => isPreferredMarketNewsUrl(url))
        );
      });
  }

  if (isRecord(record.results)) {
    filterRecordInPlace(record.results);
  }
}

function isFinnhubProxyUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.hostname.replace(/^www\./, "").toLowerCase() === "finnhub.io" &&
      parsed.pathname === "/api/news"
    );
  } catch {
    return false;
  }
}

function domainFromUnknown(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    const clean = value.trim().replace(/^www\./, "").toLowerCase();
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean) ? clean : null;
  }
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonClone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
