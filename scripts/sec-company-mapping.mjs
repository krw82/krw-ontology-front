const SEC_COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

// Aliases are intentionally small and auditable. BK is the BNY Mellon issuer
// alias in the ontology catalog; its SEC mapping was manually verified against
// the SEC company_tickers source. Punctuation-only variants are handled below.
export const VERIFIED_SEC_TICKER_ALIASES = Object.freeze({
  BK: "BNY",
});

export function normalizeCatalogTicker(value) {
  const ticker = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker) ? ticker : null;
}

export function normalizeSecCik(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits && digits.length <= 10 ? digits.padStart(10, "0") : null;
}

export function buildSecTickerIndex(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("SEC company_tickers payload must be an object");
  }
  const index = new Map();
  for (const value of Object.values(payload)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const ticker = normalizeCatalogTicker(value.ticker);
    const cik = normalizeSecCik(value.cik_str);
    const title = typeof value.title === "string" ? value.title.trim() : "";
    if (!ticker || !cik || !title || index.has(ticker)) continue;
    index.set(ticker, { ticker, cik, title });
  }
  if (!index.size) throw new Error("SEC company_tickers payload contains no valid records");
  return index;
}

function lookupCandidates(ticker) {
  const candidates = [{ ticker, source: "exact" }];
  const punctuationVariants = [ticker.replaceAll(".", "-"), ticker.replaceAll("-", ".")];
  for (const candidate of punctuationVariants) {
    if (candidate !== ticker) candidates.push({ ticker: candidate, source: "verified_alias" });
  }
  const verifiedAlias = VERIFIED_SEC_TICKER_ALIASES[ticker];
  if (verifiedAlias) candidates.push({ ticker: verifiedAlias, source: "verified_alias" });
  return candidates;
}

export function resolveCatalogTicker(tickerInput, secTickerIndex) {
  const ticker = normalizeCatalogTicker(tickerInput);
  if (!ticker) return null;
  for (const candidate of lookupCandidates(ticker)) {
    const match = secTickerIndex.get(candidate.ticker);
    if (!match) continue;
    return {
      sec_cik: match.cik,
      sec_ticker: match.ticker,
      sec_mapping_source: candidate.source,
    };
  }
  return null;
}

export function enrichCatalogWithSecIdentifiers(catalog, secTickerIndex, checkedAt = new Date().toISOString()) {
  if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.companies)) {
    throw new Error("Catalog companies must be an array");
  }
  const missing = [];
  const companies = catalog.companies.map((company) => {
    if (!company || typeof company !== "object" || Array.isArray(company)) {
      missing.push("<invalid-company>");
      return company;
    }
    const ticker = normalizeCatalogTicker(company.ticker);
    const resolved = ticker ? resolveCatalogTicker(ticker, secTickerIndex) : null;
    if (!ticker || !resolved) {
      missing.push(String(company.ticker ?? "<missing-ticker>"));
      return company;
    }
    return {
      ...company,
      ...resolved,
      sec_mapping_checked_at: checkedAt,
    };
  });
  if (missing.length) {
    throw new Error(`SEC CIK mapping missing for ${missing.length} catalog company(s): ${missing.slice(0, 30).join(", ")}`);
  }
  return { ...catalog, companies };
}

export async function fetchSecTickerIndex({ userAgent, fetchImpl = fetch } = {}) {
  const normalizedUserAgent = String(userAgent ?? "").trim();
  if (!normalizedUserAgent) {
    throw new Error("SEC_USER_AGENT is required to map catalog companies to SEC CIKs");
  }
  const response = await fetchImpl(SEC_COMPANY_TICKERS_URL, {
    headers: {
      "User-Agent": normalizedUserAgent,
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    redirect: "error",
  });
  if (!response.ok) {
    throw new Error(`SEC company_tickers request failed (${response.status})`);
  }
  return buildSecTickerIndex(await response.json());
}
