/**
 * Pure resume/tray logic for the Pulse feed: computes which companies belong
 * in the "관심 기업" story tray and which published issues are new per
 * company. Split in two phases so the route can query the candidate issues
 * between them: resolveResumeScan derives the union of watchlist tickers and
 * recently-seen tickers; buildPulseResumeItems turns fetched candidates into
 * the final tray items.
 *
 * Cutoff semantics: an issue is "new" for a company when it was published
 * after that company's lower bound AND the user has never opened it AND it is
 * not hidden. The lower bound is the watchlist follow time for watchlist
 * companies (reading one article must not swallow the other unread ones) and
 * the last news visit for recently-seen companies. Watchlist companies stay
 * in the tray even with nothing new; recently-seen companies only appear when
 * they have new issues.
 */

export const RESUME_MAX_SCAN_TICKERS = 12;
export const RESUME_MAX_ITEMS = 10;
export const RESUME_MAX_NEW_ITEMS = 8;

export interface ResumeWatchlistMarkRow {
  ticker: string | null;
  created_at: string | null;
}

export interface ResumeSeenStateRow {
  issue_id: string | null;
  last_seen_at: string | null;
}

export interface ResumeSeenIssueRow {
  id: string | null;
  title_ko: string | null;
}

export interface ResumeSeenEntityRow {
  issue_id: string | null;
  ticker: string | null;
  entity_name: string | null;
}

export interface ResumeCandidateIssueRow {
  id: string | null;
  title_ko: string | null;
  published_at: string | null;
}

export interface ResumeCandidateEntityRow {
  issue_id: string | null;
  ticker: string | null;
  entity_name: string | null;
}

export interface ResumeUserStateRow {
  issue_id: string | null;
  opened_at: string | null;
  is_hidden: boolean | null;
}

export interface ResumeScan {
  scan_tickers: string[];
  watchlist_tickers: Set<string>;
  /** Lower bound per ticker; null when it cannot be determined. */
  cutoff_by_ticker: Map<string, Date | null>;
  seen_company_names: Map<string, string>;
}

export interface ResumeNewIssueItem {
  issue_id: string;
  title_ko: string | null;
  published_at: string;
}

export interface PulseResumeItem {
  ticker: string;
  company_name: string | null;
  is_watchlist: boolean;
  new_count: number;
  new_items: ResumeNewIssueItem[];
}

export interface PulseResumeResult {
  items: PulseResumeItem[];
  overflow_count: number;
}

function normalizeResumeTicker(raw: string | null | undefined): string | null {
  const ticker = raw?.trim().toUpperCase();
  return ticker ? ticker : null;
}

export function resolveResumeScan(input: {
  watchlistMarks: ResumeWatchlistMarkRow[];
  seenStates: ResumeSeenStateRow[];
  seenIssues: ResumeSeenIssueRow[];
  seenEntities: ResumeSeenEntityRow[];
}): ResumeScan {
  const lastSeenByIssueId = new Map<string, Date>();
  for (const state of input.seenStates) {
    const issueId = state?.issue_id;
    const lastSeenAt = state?.last_seen_at ? new Date(state.last_seen_at) : null;
    if (!issueId || !lastSeenAt || Number.isNaN(lastSeenAt.getTime())) continue;
    const existing = lastSeenByIssueId.get(issueId);
    if (!existing || lastSeenAt > existing) {
      lastSeenByIssueId.set(issueId, lastSeenAt);
    }
  }

  const activeSeenIssueIds = new Set(
    input.seenIssues
      .map((issue) => issue?.id)
      .filter((id): id is string => Boolean(id)),
  );

  // Latest seen-issue visit per ticker wins as the cutoff; the company name
  // comes from the most recently seen issue carrying that ticker.
  const seenCutoffByTicker = new Map<string, Date>();
  const seenCompanyNames = new Map<string, string>();
  for (const entity of input.seenEntities) {
    const ticker = normalizeResumeTicker(entity?.ticker);
    const issueId = entity?.issue_id;
    if (!ticker || !issueId || !activeSeenIssueIds.has(issueId)) continue;
    const lastSeenAt = lastSeenByIssueId.get(issueId);
    if (!lastSeenAt) continue;
    const existing = seenCutoffByTicker.get(ticker);
    if (!existing || lastSeenAt > existing) {
      seenCutoffByTicker.set(ticker, lastSeenAt);
      if (entity.entity_name) {
        seenCompanyNames.set(ticker, entity.entity_name);
      }
    }
  }

  const watchlistTickers = new Set<string>();
  const followedAtByTicker = new Map<string, Date>();
  for (const mark of input.watchlistMarks) {
    const ticker = normalizeResumeTicker(mark?.ticker);
    if (!ticker) continue;
    watchlistTickers.add(ticker);
    const followedAt = mark?.created_at ? new Date(mark.created_at) : null;
    if (followedAt && !Number.isNaN(followedAt.getTime())) {
      const existing = followedAtByTicker.get(ticker);
      followedAtByTicker.set(
        ticker,
        !existing || followedAt > existing ? followedAt : existing,
      );
    }
  }

  // Watchlist companies are bounded by the follow time only — unread issues
  // stay new regardless of when the user last visited the company.
  const cutoffByTicker = new Map<string, Date | null>();
  const watchlistSorted = [...watchlistTickers].sort((a, b) => {
    const followedA = followedAtByTicker.get(a)?.getTime() ?? 0;
    const followedB = followedAtByTicker.get(b)?.getTime() ?? 0;
    if (followedA !== followedB) return followedB - followedA;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  for (const ticker of watchlistSorted) {
    cutoffByTicker.set(ticker, followedAtByTicker.get(ticker) ?? null);
  }

  const recentOnlySorted = [...seenCutoffByTicker.keys()]
    .filter((ticker) => !watchlistTickers.has(ticker))
    .sort((a, b) => {
      const cutoffA = seenCutoffByTicker.get(a)?.getTime() ?? 0;
      const cutoffB = seenCutoffByTicker.get(b)?.getTime() ?? 0;
      if (cutoffA !== cutoffB) return cutoffB - cutoffA;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  for (const ticker of recentOnlySorted) {
    cutoffByTicker.set(ticker, seenCutoffByTicker.get(ticker) ?? null);
  }

  const scanTickers = [...watchlistSorted, ...recentOnlySorted].slice(
    0,
    RESUME_MAX_SCAN_TICKERS,
  );

  return {
    scan_tickers: scanTickers,
    watchlist_tickers: watchlistTickers,
    cutoff_by_ticker: cutoffByTicker,
    seen_company_names: seenCompanyNames,
  };
}

export function buildPulseResumeItems(input: {
  scan: ResumeScan;
  candidateIssues: ResumeCandidateIssueRow[];
  candidateEntities: ResumeCandidateEntityRow[];
  userStates: ResumeUserStateRow[];
}): PulseResumeResult {
  const { scan } = input;
  const scanSet = new Set(scan.scan_tickers);

  const tickersByIssueId = new Map<string, Set<string>>();
  const candidateNameByTicker = new Map<string, string>();
  for (const entity of input.candidateEntities) {
    const issueId = entity?.issue_id;
    const ticker = normalizeResumeTicker(entity?.ticker);
    if (!issueId || !ticker || !scanSet.has(ticker)) continue;
    const set = tickersByIssueId.get(issueId) ?? new Set<string>();
    set.add(ticker);
    tickersByIssueId.set(issueId, set);
    if (entity.entity_name && !candidateNameByTicker.has(ticker)) {
      candidateNameByTicker.set(ticker, entity.entity_name);
    }
  }

  const openedIssueIds = new Set<string>();
  const hiddenIssueIds = new Set<string>();
  for (const state of input.userStates) {
    const issueId = state?.issue_id;
    if (!issueId) continue;
    if (state.is_hidden === true) hiddenIssueIds.add(issueId);
    const openedAt = state?.opened_at ? new Date(state.opened_at) : null;
    if (openedAt && !Number.isNaN(openedAt.getTime())) {
      openedIssueIds.add(issueId);
    }
  }

  const newIssuesByTicker = new Map<string, ResumeNewIssueItem[]>();
  const sortedIssues = input.candidateIssues
    .flatMap((issue) => {
      const id = issue?.id;
      const publishedAt = issue?.published_at ? new Date(issue.published_at) : null;
      if (!id || !publishedAt || Number.isNaN(publishedAt.getTime())) return [];
      return [{
        id,
        titleKo: issue.title_ko ?? null,
        publishedAt,
      }];
    })
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  for (const issue of sortedIssues) {
    if (openedIssueIds.has(issue.id) || hiddenIssueIds.has(issue.id)) continue;
    for (const ticker of tickersByIssueId.get(issue.id) ?? []) {
      const cutoff = scan.cutoff_by_ticker.get(ticker);
      if (!cutoff || issue.publishedAt <= cutoff) continue;
      const list = newIssuesByTicker.get(ticker) ?? [];
      list.push({
        issue_id: issue.id,
        title_ko: issue.titleKo,
        published_at: issue.publishedAt.toISOString(),
      });
      newIssuesByTicker.set(ticker, list);
    }
  }

  const included = scan.scan_tickers
    .filter(
      (ticker) =>
        scan.watchlist_tickers.has(ticker) ||
        (newIssuesByTicker.get(ticker)?.length ?? 0) > 0,
    )
    .map((ticker) => ({
      ticker,
      company_name:
        scan.seen_company_names.get(ticker) ??
        candidateNameByTicker.get(ticker) ??
        null,
      is_watchlist: scan.watchlist_tickers.has(ticker),
      new_count: newIssuesByTicker.get(ticker)?.length ?? 0,
      new_items: newIssuesByTicker.get(ticker)?.slice(0, RESUME_MAX_NEW_ITEMS) ?? [],
    }));

  const compareItems = (
    a: { ticker: string; new_count: number },
    b: { ticker: string; new_count: number },
    groupOf: (ticker: string) => number,
  ): number => {
    const groupA = groupOf(a.ticker);
    const groupB = groupOf(b.ticker);
    if (groupA !== groupB) return groupA - groupB;
    if (a.new_count !== b.new_count) return b.new_count - a.new_count;
    return a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0;
  };
  const watchlistGroup = (ticker: string) =>
    scan.watchlist_tickers.has(ticker) ? 0 : 1;
  const ordered = [...included].sort((a, b) => compareItems(a, b, watchlistGroup));

  return {
    items: ordered.slice(0, RESUME_MAX_ITEMS),
    overflow_count: Math.max(0, ordered.length - RESUME_MAX_ITEMS),
  };
}
