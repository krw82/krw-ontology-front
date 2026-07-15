import "server-only";

import { getCompanyLandingCopyForTicker } from "@/lib/companies/landing-copy";
import { normalizeCik } from "@/lib/sec-13f/parser";
import { fetchLatest13fFilingPackage } from "@/lib/sec-13f/sec-edgar";
import {
  getInstitutionalManager,
  listFilingsForManager,
  listHoldingsForFiling,
  listInstitutionalManagers,
  listPositionChangesForCusips,
  listPositionChangesForFiling,
  listPositionChangesForTicker,
  upsert13FFilingPackage,
} from "@/lib/sec-13f/repository";
import type {
  Institutional13FFilingRow,
  Institutional13FHoldingRow,
  InstitutionalManagerRow,
  Sec13FPositionChangeRow,
} from "@/types/database";
import type {
  InstitutionalHoldingView,
  InstitutionalHoldingShareTrend,
  InstitutionalHoldingsDashboard,
  InstitutionalTickerActivity,
  Known13FManager,
  PositionChangeType,
} from "./types";
import {
  DEFAULT_13F_MANAGER_CIK,
  INSTITUTIONAL_HOLDINGS_DISPLAY_LIMIT,
  KNOWN_13F_MANAGERS,
} from "./types";

const REBALANCING_LIST_LIMIT = 5;
const SHARE_TREND_LIMIT = 10;
const CUSIP_TICKER_OVERRIDES: Record<string, string> = {
  "037833100": "AAPL",
  "30231G102": "XOM",
};

function knownManagerForCik(cik: string): Known13FManager | null {
  return KNOWN_13F_MANAGERS.find((manager) => manager.cik === cik) ?? null;
}

function managerView(
  cik: string,
  row: InstitutionalManagerRow | null,
): InstitutionalHoldingsDashboard["manager"] {
  const knownManager = knownManagerForCik(cik);
  return {
    cik,
    name: row?.name ?? knownManager?.name ?? `CIK ${cik}`,
    displayName: row?.display_name ?? knownManager?.displayName ?? null,
    countryCode: row?.country_code ?? knownManager?.countryCode ?? null,
    notes: row?.notes ?? knownManager?.notes ?? null,
    latestRefreshAt: row?.latest_refresh_at ?? null,
  };
}

function filingView(
  row: Institutional13FFilingRow,
): NonNullable<InstitutionalHoldingsDashboard["filing"]> {
  return {
    id: row.id,
    accessionNumber: row.accession_number,
    form: row.form,
    reportPeriod: row.report_period,
    filingDate: row.filing_date,
    acceptedAt: row.accepted_at,
    filingDetailUrl: row.filing_detail_url,
    informationTableUrl: row.information_table_url,
    entryCount: row.entry_count,
    totalValueUsd: Number(row.total_value_usd),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function previousFilingView(
  row: Institutional13FFilingRow,
): NonNullable<InstitutionalHoldingsDashboard["previousFiling"]> {
  return {
    id: row.id,
    reportPeriod: row.report_period,
    filingDate: row.filing_date,
    totalValueUsd: Number(row.total_value_usd),
  };
}

function companyDisplayName(ticker: string | null, fallback: string) {
  if (!ticker) return fallback;
  return getCompanyLandingCopyForTicker(ticker).companyNameKo?.trim() || fallback;
}

function holdingTicker(ticker: string | null | undefined, cusip: string | null) {
  return (
    ticker?.trim().toUpperCase() ||
    (cusip ? CUSIP_TICKER_OVERRIDES[cusip.trim().toUpperCase()] : null) ||
    null
  );
}

function buildHoldingViews(
  positionChanges: Sec13FPositionChangeRow[],
  totalValue: number,
): InstitutionalHoldingView[] {
  return positionChanges.map((change) => {
    const currentValue = Number(change.current_value_usd);
    const ticker = holdingTicker(change.ticker, change.cusip);
    const portfolioWeight =
      change.current_weight === null
        ? totalValue > 0
          ? currentValue / totalValue
          : 0
        : Number(change.current_weight);
    return {
      id: change.id,
      issuerName: change.issuer_name,
      displayName: companyDisplayName(ticker, change.issuer_name),
      titleOfClass: change.title_of_class ?? "",
      cusip: change.cusip,
      ticker,
      valueUsd: currentValue,
      shares: change.current_shares === null ? null : Number(change.current_shares),
      sharesChange:
        change.shares_change === null ? null : Number(change.shares_change),
      sharesChangePct:
        change.shares_change_pct === null ? null : Number(change.shares_change_pct),
      portfolioWeight,
      previousPortfolioWeight:
        change.previous_weight === null ? null : Number(change.previous_weight),
      portfolioWeightChange:
        change.weight_change === null ? null : Number(change.weight_change),
      previousValueUsd:
        change.previous_value_usd === null ? null : Number(change.previous_value_usd),
      valueChangeUsd:
        change.value_change_usd === null ? null : Number(change.value_change_usd),
      valueChangePct:
        change.value_change_pct === null ? null : Number(change.value_change_pct),
      changeType: change.change_type as PositionChangeType,
      chatHref: ticker ? `/chat/new?ticker=${encodeURIComponent(ticker)}` : null,
    };
  });
}

function emptyStats(): InstitutionalHoldingsDashboard["stats"] {
  return {
    totalPositions: 0,
    totalValueUsd: 0,
    newPositions: 0,
    increasedPositions: 0,
    decreasedPositions: 0,
    unchangedPositions: 0,
    soldPositions: 0,
    top10Weight: 0,
  };
}

function buildStats(
  holdings: InstitutionalHoldingView[],
  allPositionChanges: Sec13FPositionChangeRow[],
): InstitutionalHoldingsDashboard["stats"] {
  const soldPositions = allPositionChanges.filter(
    (change) => change.change_type === "sold",
  ).length;

  return {
    totalPositions: holdings.length,
    totalValueUsd: holdings.reduce((sum, holding) => sum + holding.valueUsd, 0),
    newPositions: holdings.filter((holding) => holding.changeType === "new").length,
    increasedPositions: holdings.filter(
      (holding) => holding.changeType === "increased",
    ).length,
    decreasedPositions: holdings.filter(
      (holding) => holding.changeType === "decreased",
    ).length,
    unchangedPositions: holdings.filter(
      (holding) => holding.changeType === "unchanged",
    ).length,
    soldPositions,
    top10Weight: holdings
      .slice(0, 10)
      .reduce((sum, holding) => sum + holding.portfolioWeight, 0),
  };
}

function emptyRebalancing(): InstitutionalHoldingsDashboard["rebalancing"] {
  return { buys: [], sells: [] };
}

function emptyShareTrend(): InstitutionalHoldingsDashboard["shareTrend"] {
  return { filings: [], rows: [] };
}

function buildRebalancing(
  positionChanges: Sec13FPositionChangeRow[],
  totalValue: number,
): InstitutionalHoldingsDashboard["rebalancing"] {
  const comparableChanges = positionChanges.filter(
    (change) => change.weight_change !== null,
  );
  const buys = comparableChanges
    .filter((change) => Number(change.weight_change) > 0)
    .sort((left, right) => Number(right.weight_change) - Number(left.weight_change))
    .slice(0, REBALANCING_LIST_LIMIT);
  const sells = comparableChanges
    .filter((change) => Number(change.weight_change) < 0)
    .sort((left, right) => Number(left.weight_change) - Number(right.weight_change))
    .slice(0, REBALANCING_LIST_LIMIT);

  return {
    buys: buildHoldingViews(buys, totalValue),
    sells: buildHoldingViews(sells, totalValue),
  };
}

function buildShareTrend(
  topPositionChanges: Sec13FPositionChangeRow[],
  trendFilings: Institutional13FFilingRow[],
  holdingsByFilingId: Map<string, Institutional13FHoldingRow[]>,
): InstitutionalHoldingsDashboard["shareTrend"] {
  const filings = trendFilings.map((filing) => ({
    id: filing.id,
    reportPeriod: filing.report_period,
  }));

  const rows: InstitutionalHoldingShareTrend[] = topPositionChanges
    .filter((change) => change.change_type !== "sold")
    .slice(0, SHARE_TREND_LIMIT)
    .map((change) => {
      const sharesByReportPeriod: Record<string, number | null> = {};
      for (const filing of trendFilings) {
        const holding =
          holdingsByFilingId
            .get(filing.id)
            ?.find((item) => item.position_key === change.position_key) ?? null;
        sharesByReportPeriod[filing.report_period] =
          holding?.shares === undefined || holding.shares === null
            ? null
            : Number(holding.shares);
      }

      return {
        issuerName: change.issuer_name,
        displayName: companyDisplayName(
          holdingTicker(change.ticker, change.cusip),
          change.issuer_name,
        ),
        titleOfClass: change.title_of_class ?? "",
        cusip: change.cusip,
        ticker: holdingTicker(change.ticker, change.cusip),
        sharesByReportPeriod,
      };
    });

  return { filings, rows };
}

export async function refreshLatestInstitutionalHoldings(
  rawCik = DEFAULT_13F_MANAGER_CIK,
): Promise<InstitutionalHoldingsDashboard> {
  const cik = normalizeCik(rawCik);
  if (!cik) throw new Error("Invalid CIK");

  const filingPackage = await fetchLatest13fFilingPackage(cik);
  await upsert13FFilingPackage(filingPackage);
  return getInstitutionalHoldingsDashboard(cik);
}

export async function getInstitutionalManagerDirectory(): Promise<Known13FManager[]> {
  const managerRows = await listInstitutionalManagers().catch(() => []);
  const knownManagersByCik = new Map(
    KNOWN_13F_MANAGERS.map((item) => [item.cik, item]),
  );

  return [
    ...KNOWN_13F_MANAGERS,
    ...managerRows
      .filter((row) => !knownManagersByCik.has(row.cik))
      .map((row) => ({
        cik: row.cik,
        name: row.name,
        displayName: row.display_name ?? row.name,
        countryCode: row.country_code ?? "",
        notes: row.notes ?? "",
      })),
  ];
}

export async function getInstitutionalTickerActivity(
  ticker: string,
  limit = 5,
): Promise<InstitutionalTickerActivity[]> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const fallbackCusips = Object.entries(CUSIP_TICKER_OVERRIDES)
    .filter(([, mappedTicker]) => mappedTicker === normalizedTicker)
    .map(([cusip]) => cusip);
  const [tickerChanges, cusipChanges, managerRows] = await Promise.all([
    listPositionChangesForTicker(ticker),
    listPositionChangesForCusips(fallbackCusips),
    listInstitutionalManagers(),
  ]);
  const changes = Array.from(
    new Map(
      [...tickerChanges, ...cusipChanges].map((change) => [change.id, change]),
    ).values(),
  ).sort((left, right) => {
    const periodCompare = right.report_period.localeCompare(left.report_period);
    if (periodCompare !== 0) return periodCompare;
    return Number(right.current_value_usd) - Number(left.current_value_usd);
  });
  const managersByCik = new Map(managerRows.map((manager) => [manager.cik, manager]));
  const seenCiks = new Set<string>();

  return changes
    .filter((change) => {
      if (seenCiks.has(change.cik)) return false;
      seenCiks.add(change.cik);
      return true;
    })
    .slice(0, limit)
    .map((change) => {
      const manager = managerView(change.cik, managersByCik.get(change.cik) ?? null);
      return {
        cik: change.cik,
        managerName: manager.name,
        managerDisplayName: manager.displayName,
        reportPeriod: change.report_period,
        changeType: change.change_type as PositionChangeType,
        valueUsd: Number(change.current_value_usd),
        previousValueUsd:
          change.previous_value_usd === null
            ? null
            : Number(change.previous_value_usd),
        shares:
          change.current_shares === null ? null : Number(change.current_shares),
      };
    });
}

export async function getInstitutionalHoldingsDashboard(
  rawCik = DEFAULT_13F_MANAGER_CIK,
): Promise<InstitutionalHoldingsDashboard> {
  const cik = normalizeCik(rawCik) || DEFAULT_13F_MANAGER_CIK;
  const [managers, manager, filings] = await Promise.all([
    getInstitutionalManagerDirectory(),
    getInstitutionalManager(cik),
    listFilingsForManager(cik, 3),
  ]);

  const latestFiling = filings[0] ?? null;
  if (!latestFiling) {
    return {
      managers,
      selectedCik: cik,
      displayLimit: INSTITUTIONAL_HOLDINGS_DISPLAY_LIMIT,
      manager: managerView(cik, manager),
      filing: null,
      previousFiling: null,
      stats: emptyStats(),
      rebalancing: emptyRebalancing(),
      shareTrend: emptyShareTrend(),
      holdings: [],
    };
  }

  const previousFiling = filings[1] ?? null;
  const [displayedPositionChanges, allPositionChanges] = await Promise.all([
    listPositionChangesForFiling(latestFiling.id, {
      limit: INSTITUTIONAL_HOLDINGS_DISPLAY_LIMIT,
    }),
    listPositionChangesForFiling(latestFiling.id, { includeSold: true }),
  ]);
  const trendFilings = filings.slice(0, 3).reverse();
  const trendHoldings = await Promise.all(
    trendFilings.map((filing) => listHoldingsForFiling(filing.id)),
  );
  const holdingsByFilingId = new Map(
    trendFilings.map((filing, index) => [filing.id, trendHoldings[index] ?? []]),
  );
  const totalValue = Number(latestFiling.total_value_usd);
  const holdings = buildHoldingViews(displayedPositionChanges, totalValue);

  return {
    managers,
    selectedCik: cik,
    displayLimit: INSTITUTIONAL_HOLDINGS_DISPLAY_LIMIT,
    manager: managerView(cik, manager),
    filing: filingView(latestFiling),
    previousFiling: previousFiling ? previousFilingView(previousFiling) : null,
    stats: buildStats(holdings, allPositionChanges),
    rebalancing: buildRebalancing(allPositionChanges, totalValue),
    shareTrend: buildShareTrend(
      displayedPositionChanges,
      trendFilings,
      holdingsByFilingId,
    ),
    holdings,
  };
}
