"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSessions } from "@/hooks/useSessions";
import { buildChatSessionHref } from "@/lib/chat/history-state";
import { localeSwitchHref, resolveRouteLocale } from "@/i18n/routing";
import {
  readDeviceWatchlistOverview,
  saveDeviceWatchlistOverview,
} from "@/lib/pwa/device-cache";
import type {
  ResearchInboxItem,
  SessionSummary,
  UserCompanyCoverageStatus,
  WatchlistCompanySummary,
  WatchlistOverviewResponse,
} from "@/types/api-contracts";

interface WatchlistHomeClientProps {
  overview: WatchlistOverviewResponse;
  cacheOwnerId?: string | null;
  loadOverview?: boolean;
}

let retainedWatchlistQuery = "";

export default function WatchlistHomeClient({
  overview,
  cacheOwnerId = null,
  loadOverview = false,
}: WatchlistHomeClientProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [overviewState, setOverviewState] = useState(overview);
  const [visibleLoadError, setVisibleLoadError] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(loadOverview);
  const [overviewReadyForCache, setOverviewReadyForCache] = useState(
    !loadOverview,
  );
  const [dismissingQuestionId, setDismissingQuestionId] = useState<string | null>(
    null,
  );
  const [dismissQuestionError, setDismissQuestionError] = useState<string | null>(
    null,
  );
  const companies = overviewState.companies;
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const locale = resolveRouteLocale(pathname, searchParams.get("locale"));
  const activeTab = searchParams.get("tab") === "history" ? "history" : "notebook";
  const notebookHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tab");
    params.delete("q");
    return localeSwitchHref(locale, "/watchlist", params.toString());
  }, [locale, searchParams]);
  const historyHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "history");
    params.delete("q");
    return localeSwitchHref(locale, "/watchlist", params.toString());
  }, [locale, searchParams]);
  const {
    sessions,
    loading: historyLoading,
    listError: historyError,
    listSessions,
  } = useSessions({ cacheOwnerId });

  const researchInbox = overviewState.research_inbox;

  useEffect(() => {
    if (!loadOverview || !cacheOwnerId) return;

    let active = true;
    let freshOverviewLoaded = false;
    let deviceOverviewLoaded = false;
    void readDeviceWatchlistOverview(cacheOwnerId)
      .then((snapshot) => {
        if (!active || !snapshot) return;
        if (freshOverviewLoaded) return;
        deviceOverviewLoaded = true;
        setOverviewState(snapshot.overview);
        setVisibleLoadError(null);
        setOverviewLoading(false);
        setOverviewReadyForCache(true);
      })
      .catch(() => undefined);

    void fetch("/api/watchlist", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load watchlist overview");
        const next = await response.json() as WatchlistOverviewResponse;
        if (!Array.isArray(next.companies) || !Array.isArray(next.research_inbox)) {
          throw new Error("Invalid watchlist overview response");
        }
        if (!active) return;
        freshOverviewLoaded = true;
        setOverviewState(next);
        setVisibleLoadError(null);
        setOverviewReadyForCache(true);
      })
      .catch(() => {
        if (active && !deviceOverviewLoaded) {
          setVisibleLoadError("리서치 노트북 데이터를 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (active) setOverviewLoading(false);
      });

    return () => {
      active = false;
    };
  }, [cacheOwnerId, loadOverview]);

  useEffect(() => {
    if (!cacheOwnerId || !overviewReadyForCache) return;
    void saveDeviceWatchlistOverview(cacheOwnerId, overviewState)
      .catch(() => undefined);
  }, [cacheOwnerId, overviewReadyForCache, overviewState]);
  const filteredSessions = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    if (!normalizedQuery) return sessions;

    return sessions.filter((session) =>
      [
        session.title,
        session.last_message_preview,
        session.default_tickers.join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [deferredQuery, sessions]);
  const filteredCompanies = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    return companies.filter((company) => {
      if (!normalizedQuery) return true;
      const haystack = [
        company.ticker,
        company.name,
        company.companyNameKo,
        company.sector,
        company.notebook_preview,
        company.mark.interest_reason,
        company.mark.tags.join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [companies, deferredQuery]);
  const companySections = useMemo(() => {
    return [
      { key: "holding", title: "보유 중" },
      { key: "watching", title: "관찰 중" },
      { key: "exploring", title: "탐색 중" },
      { key: "closed", title: "종료" },
    ].map((section) => ({
      ...section,
      companies: filteredCompanies.filter(
        (company) => coverageStatusOf(company) === section.key,
      ),
    }));
  }, [filteredCompanies]);

  useEffect(() => {
    const legacyUrlQuery = searchParams.get("q");
    const restoredQuery = legacyUrlQuery ?? retainedWatchlistQuery;
    retainedWatchlistQuery = restoredQuery;
    const restoreTimer = window.setTimeout(() => {
      if (restoredQuery) setQuery(restoredQuery);
    }, 0);

    if (legacyUrlQuery !== null) {
      const params = new URLSearchParams(window.location.search);
      params.delete("q");
      const nextSearch = params.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`,
      );
    }

    return () => window.clearTimeout(restoreTimer);
  }, [searchParams]);

  useEffect(() => {
    if (activeTab !== "history") return;
    void listSessions(1, 60);
  }, [activeTab, listSessions]);

  function updateQuery(nextQuery: string) {
    retainedWatchlistQuery = nextQuery;
    setQuery(nextQuery);
  }

  async function handleDismissInboxQuestion(item: ResearchInboxItem) {
    if (!item.dismiss_question_id || dismissingQuestionId) return;

    setDismissQuestionError(null);
    setDismissingQuestionId(item.dismiss_question_id);
    try {
      const response = await fetch(
        `/api/watchlist/${encodeURIComponent(item.ticker)}/questions/${encodeURIComponent(
          item.dismiss_question_id,
        )}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "dismissed" }),
        },
      );
      if (!response.ok) throw new Error("Failed to dismiss question");

      setOverviewState((current) => ({
        ...current,
        research_inbox: current.research_inbox.filter(
          (existing) =>
            existing.ticker !== item.ticker ||
            existing.dismiss_question_id !== item.dismiss_question_id,
        ),
      }));
    } catch {
      setDismissQuestionError(
        "질문을 닫지 못했습니다. 질문은 그대로 유지되며, 다시 시도할 수 있습니다.",
      );
    } finally {
      setDismissingQuestionId(null);
    }
  }

  return (
    <main
      id="main-content"
      className="px-base pb-xl pt-lg sm:px-md md:px-xl md:pb-[96px] md:pt-xl"
    >
      <div className="mx-auto w-full max-w-[1200px]">
        <header className="grid gap-5 border-b border-hairline pb-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)] lg:items-end">
          <div>
            <p className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-primary">
              Personal Research
            </p>
            <div className="min-w-0">
              <h1 className="mt-2 text-balance text-[30px] font-black leading-[1.08] tracking-normal text-ink sm:text-[40px]">
                기업 커버리지
              </h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-6 text-body sm:text-[16px]">
                {activeTab === "history"
                  ? "이전 질문과 분석 결과를 찾아, 같은 맥락에서 바로 이어서 볼 수 있습니다."
                  : "회사별로 무엇이 변했는지, 내 판단은 무엇인지, 다음에 무엇을 할지 한곳에서 이어봅니다."}
              </p>
              <nav className="mt-4 flex items-center gap-1" aria-label="기업 커버리지 보기">
                <Link
                  href={notebookHref}
                  className={[
                    "rounded-[8px] px-sm py-xs text-[13px] font-extrabold leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    activeTab === "notebook"
                      ? "bg-surface text-ink"
                      : "text-muted hover:bg-surface-soft hover:text-ink",
                  ].join(" ")}
                  aria-current={activeTab === "notebook" ? "page" : undefined}
                >
                  커버리지
                </Link>
                <Link
                  href={historyHref}
                  className={[
                    "rounded-[8px] px-sm py-xs text-[13px] font-extrabold leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    activeTab === "history"
                      ? "bg-surface text-ink"
                      : "text-muted hover:bg-surface-soft hover:text-ink",
                  ].join(" ")}
                  aria-current={activeTab === "history" ? "page" : undefined}
                >
                  채팅 기록
                </Link>
              </nav>
            </div>
          </div>
          <div className="relative min-w-0">
            <p className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
              Coverage search
            </p>
            <span
              aria-hidden="true"
              className="material-symbols-outlined absolute bottom-[12px] left-3 text-[20px] text-muted"
            >
              search
            </span>
            <input
              className="h-11 w-full rounded-[8px] border border-hairline bg-canvas pl-10 pr-sm text-[14px] font-semibold leading-5 text-ink shadow-sm placeholder:text-muted focus:border-outline focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/25"
              placeholder={activeTab === "history" ? "티커, 질문, 대화 검색" : "티커, 회사명, 판단 노트 검색"}
              aria-label="기업 커버리지 검색"
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
            />
          </div>
        </header>

        {activeTab === "notebook" && visibleLoadError && (
          <div className="mt-4 border border-error-container bg-error-container/40 px-sm py-xs text-[13px] font-bold leading-5 text-error">
            {visibleLoadError}
          </div>
        )}

        {activeTab === "history" ? (
          <ChatHistoryTab
            locale={locale}
            loading={historyLoading}
            error={historyError}
            sessions={filteredSessions}
            query={query}
            onRetry={() => void listSessions(1, 60)}
          />
        ) : (
          <>
            {dismissQuestionError && (
              <p
                aria-live="assertive"
                className="mt-5 rounded-[8px] border border-error-container bg-error-container/40 px-sm py-xs text-[13px] font-bold leading-5 text-error"
                role="alert"
              >
                {dismissQuestionError}
              </p>
            )}
            {overviewLoading ? (
              <WatchlistOverviewSkeleton />
            ) : (
              <>
                <ResearchInboxPanel
                  dismissingQuestionId={dismissingQuestionId}
                  inbox={researchInbox}
                  onDismissQuestion={handleDismissInboxQuestion}
                />

                <section className="mt-5">
                  {companies.length === 0 ? (
                    <EmptyWatchlist />
                  ) : filteredCompanies.length === 0 ? (
                    <div className="mt-5 rounded-[8px] border border-hairline bg-surface-soft p-lg text-center text-[15px] font-bold leading-6 text-muted">
                      조건에 맞는 종목이 없습니다.
                    </div>
                  ) : (
                    <div className="grid gap-6">
                      {companySections
                        .filter((section) => section.companies.length > 0)
                        .map((section) => (
                          <CompanySection
                            key={section.key}
                            title={section.title}
                            companies={section.companies}
                          />
                        ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function WatchlistOverviewSkeleton() {
  return (
    <section
      className="mt-5 overflow-hidden rounded-[8px] border border-hairline bg-canvas"
      aria-busy="true"
      aria-label="리서치 노트북을 불러오는 중"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="grid min-h-[94px] grid-cols-[104px_minmax(0,1fr)] gap-4 border-b border-hairline px-4 py-3.5 last:border-b-0 xl:grid-cols-[104px_minmax(220px,1fr)_120px]"
        >
          <div className="h-5 w-16 animate-pulse rounded bg-surface-soft" />
          <div className="space-y-2">
            <div className="h-5 w-36 animate-pulse rounded bg-surface-soft" />
            <div className="h-4 w-4/5 animate-pulse rounded bg-surface-soft" />
          </div>
          <div className="hidden h-4 w-14 animate-pulse rounded bg-surface-soft xl:block" />
        </div>
      ))}
    </section>
  );
}

function ChatHistoryTab({
  locale,
  loading,
  error,
  sessions,
  query,
  onRetry,
}: {
  locale: "ko" | "en";
  loading: boolean;
  error: string | null;
  sessions: SessionSummary[];
  query: string;
  onRetry: () => void;
}) {
  return (
    <section className="mt-5 overflow-hidden rounded-[8px] border border-hairline bg-canvas">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-hairline px-sm py-3 md:px-md">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
            Chat history
          </p>
          <h2 className="mt-0.5 text-[18px] font-black leading-7 text-ink">
            이전 질문과 분석
          </h2>
        </div>
        {!loading && !error && (
          <span className="font-mono text-[12px] font-bold leading-5 text-muted">
            {sessions.length.toLocaleString()}개
          </span>
        )}
      </div>

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-sm py-sm text-[13px] font-bold leading-5 text-error md:px-md">
          <span>{error}</span>
          <button
            type="button"
            className="rounded-[8px] border border-current px-sm py-xs text-[12px] font-extrabold transition-colors hover:bg-error-container/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={onRetry}
          >
            다시 시도
          </button>
        </div>
      ) : loading && sessions.length === 0 ? (
        <div className="space-y-1 p-sm md:p-md" aria-label="채팅 기록을 불러오는 중">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-[78px] animate-pulse rounded-[8px] bg-surface-strong" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="px-sm py-xl text-center md:px-md">
          <span aria-hidden="true" className="material-symbols-outlined text-[28px] text-muted">history</span>
          <p className="mt-2 text-[14px] font-black leading-5 text-ink">
            {query.trim() ? "조건에 맞는 대화가 없습니다." : "아직 저장된 대화가 없습니다."}
          </p>
          <p className="mt-1 text-[13px] font-semibold leading-5 text-muted">
            질문을 시작하면 여기에서 언제든 이어서 볼 수 있습니다.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-hairline">
          {sessions.map((session) => (
            <Link
              key={session.id}
              href={buildChatSessionHref(session.id, {
                locale,
                ticker: session.default_tickers[0],
              })}
              className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-sm py-3 transition-colors hover:bg-surface-soft md:px-md"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  {session.default_tickers[0] && (
                    <span className="font-mono text-[12px] font-black text-primary">
                      {session.default_tickers[0]}
                    </span>
                  )}
                  <p className="truncate text-[14px] font-black leading-5 text-ink">
                    {session.title || "제목 없는 대화"}
                  </p>
                </div>
                <p className="mt-1 line-clamp-2 text-[13px] font-semibold leading-5 text-muted">
                  {session.last_message_preview || "최근 메시지 없음"}
                </p>
                <p className="mt-1 font-mono text-[11px] font-bold leading-4 text-muted">
                  {formatChatDateTime(session.last_message_at ?? session.updated_at, locale)}
                </p>
              </div>
              <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-muted transition-colors group-hover:text-ink">
                arrow_forward
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function formatChatDateTime(value: string, locale: "ko" | "en"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function CompanySection({
  title,
  companies,
}: {
  title: string;
  companies: WatchlistCompanySummary[];
}) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-[18px] font-black leading-7 text-ink">{title}</h2>
        <span className="font-mono text-[12px] font-bold leading-5 text-muted">
          {companies.length.toLocaleString()}개
        </span>
      </div>

      <div className="overflow-hidden rounded-[8px] border border-hairline bg-canvas">
          <div className="hidden grid-cols-[104px_minmax(220px,1fr)_120px] border-b border-hairline bg-surface px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted xl:grid">
            <span>ticker</span>
            <span>research state</span>
            <span>activity</span>
          </div>
          <div className="divide-y divide-hairline">
            {companies.map((company) => (
              <CompanyRow key={company.ticker} company={company} />
            ))}
          </div>
      </div>
    </section>
  );
}

function CompanyRow({ company }: { company: WatchlistCompanySummary }) {
  const companyName = visibleCompanyName(company);

  return (
    <Link
      href={`/watchlist/${encodeURIComponent(company.ticker)}`}
      className="grid gap-3 px-4 py-3.5 transition-colors hover:bg-surface-soft xl:grid-cols-[104px_minmax(220px,1fr)_120px] xl:items-center"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[18px] font-black leading-6 text-ink">
          {company.ticker}
        </span>
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[18px] text-muted xl:hidden"
        >
          arrow_forward
        </span>
      </div>
      <div className="min-w-0">
        {companyName && (
          <p className="truncate text-[14px] font-black leading-5 text-ink">
            {companyName}
          </p>
        )}
        <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-5 text-muted">
          {company.notebook_preview}
        </p>
        <p className="mt-1 text-[11px] font-extrabold text-primary">
          {company.research_status_label}
        </p>
      </div>
      <div className="text-[12px] font-bold leading-5 text-muted">
        {formatDate(company.latest_activity_at)}
      </div>
    </Link>
  );
}

function visibleCompanyName(company: WatchlistCompanySummary): string | null {
  const name = (company.companyNameKo ?? company.name).trim();
  if (!name) return null;
  if (name.toUpperCase() === company.ticker.trim().toUpperCase()) return null;
  return name;
}

function ResearchInboxPanel({
  dismissingQuestionId,
  inbox,
  onDismissQuestion,
}: {
  dismissingQuestionId: string | null;
  inbox: ResearchInboxItem[];
  onDismissQuestion: (item: ResearchInboxItem) => void;
}) {
  const collapsedLimit = 3;
  const [isExpanded, setIsExpanded] = useState(false);
  const shouldCollapse = inbox.length > collapsedLimit;
  const visibleItems =
    shouldCollapse && !isExpanded ? inbox.slice(0, collapsedLimit) : inbox;
  const hiddenCount = Math.max(0, inbox.length - visibleItems.length);

  if (inbox.length === 0) {
    return (
      <section className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-hairline bg-canvas px-sm py-xs shadow-sm">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
          Judgment Queue
        </p>
        <p className="text-[13px] font-bold leading-5 text-ink">
          지금 판단을 기다리는 항목이 없습니다
        </p>
      </section>
    );
  }

  return (
    <section className="mt-5 overflow-hidden rounded-[8px] border border-hairline bg-canvas">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-hairline px-sm py-3 md:px-md">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
            Judgment Queue
          </p>
          <h2 className="mt-0.5 text-[18px] font-black leading-7 text-ink">
            다음 판단 {inbox.length.toLocaleString()}개
          </h2>
        </div>
      </div>

      <div className="divide-y divide-hairline">
        {visibleItems.map((item) => (
          <ResearchInboxRow
            key={`${item.ticker}:${item.reason}:${item.current_question_id ?? "none"}`}
            dismissingQuestionId={dismissingQuestionId}
            item={item}
            onDismissQuestion={onDismissQuestion}
          />
        ))}
        {hiddenCount > 0 && (
          <button
            className="flex h-11 w-full items-center justify-center gap-1 px-sm text-[13px] font-bold leading-5 text-muted transition-colors hover:bg-surface-soft hover:text-ink md:px-md"
            type="button"
            onClick={() => setIsExpanded(true)}
          >
            {hiddenCount.toLocaleString()}개 더보기
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-[18px]"
            >
              expand_more
            </span>
          </button>
        )}
        {shouldCollapse && isExpanded && (
          <button
            className="flex h-11 w-full items-center justify-center gap-1 px-sm text-[13px] font-bold leading-5 text-muted transition-colors hover:bg-surface-soft hover:text-ink md:px-md"
            type="button"
            onClick={() => setIsExpanded(false)}
          >
            접기
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-[18px]"
            >
              expand_less
            </span>
          </button>
        )}
      </div>
    </section>
  );
}

function ResearchInboxRow({
  dismissingQuestionId,
  item,
  onDismissQuestion,
}: {
  dismissingQuestionId: string | null;
  item: ResearchInboxItem;
  onDismissQuestion: (item: ResearchInboxItem) => void;
}) {
  const isDismissing =
    Boolean(item.dismiss_question_id) &&
    dismissingQuestionId === item.dismiss_question_id;

  if (item.reason !== "open_questions") {
    return (
      <Link
        href={item.action_href}
        className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-sm py-3 transition-colors hover:bg-surface-soft md:grid-cols-[104px_minmax(0,1fr)_auto] md:px-md"
        aria-label={`${item.ticker} 리서치 노트북 열기`}
      >
        <div className="min-w-0 md:contents">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[17px] font-black leading-6 text-ink">
              {item.ticker}
            </span>
          </div>
          <div className="mt-3 min-w-0 md:mt-0">
            <p className="text-[14px] font-black leading-5 text-ink">
              {item.title}
            </p>
            {item.description && (
              <p className="mt-1 line-clamp-2 text-[13px] font-semibold leading-5 text-muted">
                {item.description}
              </p>
            )}
          </div>
        </div>
        <span
          aria-hidden="true"
          className="material-symbols-outlined justify-self-end text-[22px] text-muted transition-colors group-hover:text-ink"
        >
          arrow_forward
        </span>
      </Link>
    );
  }

  return (
    <div className="grid gap-3 px-sm py-3 md:grid-cols-[104px_minmax(0,1fr)_auto] md:items-center md:px-md">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[17px] font-black leading-6 text-ink">
          {item.ticker}
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-[14px] font-black leading-5 text-ink">
          {item.title}
        </p>
        {item.description && (
          <p className="mt-1 line-clamp-2 text-[13px] font-semibold leading-5 text-muted">
            {item.description}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end">
        <Link
          href={item.action_href}
          className="inline-flex h-11 items-center justify-center rounded-[8px] bg-ink px-sm text-[12px] font-bold text-on-dark transition-colors hover:bg-primary-active"
        >
          {item.action_label}
        </Link>
        {item.secondary_action_href && item.secondary_action_label && (
          <Link
            href={item.secondary_action_href}
            className="inline-flex h-11 items-center justify-center rounded-[8px] border border-hairline bg-canvas px-sm text-[12px] font-bold text-ink transition-colors hover:bg-surface-soft"
          >
            {item.secondary_action_label}
          </Link>
        )}
        {item.dismiss_question_id && (
          <button
            className="inline-flex h-11 items-center justify-center rounded-[8px] border border-hairline bg-canvas px-sm text-[12px] font-bold text-ink transition-colors hover:bg-surface-soft disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isDismissing}
            type="button"
            onClick={() => onDismissQuestion(item)}
          >
            {isDismissing ? "닫는 중" : "닫기"}
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyWatchlist() {
  return (
    <div className="mt-5 rounded-[8px] border border-hairline bg-surface-soft p-lg">
      <p className="text-[18px] font-black leading-6 text-ink">
        아직 커버하는 회사가 없습니다.
      </p>
      <p className="mt-3 max-w-2xl text-[14px] font-semibold leading-6 text-body">
        회사 한 곳을 선택해 탐색·관찰·보유 상태를 정하고, 새 공시가 올 때마다 판단을 이어가세요.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/ko/companies"
          className="inline-flex h-11 items-center gap-1 rounded-[8px] bg-surface-dark px-sm text-[14px] font-extrabold text-on-dark transition-colors hover:bg-primary-active"
        >
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-[18px]"
          >
            business
          </span>
          첫 회사 선택
        </Link>
      </div>
    </div>
  );
}

type CoverageStatus = UserCompanyCoverageStatus;

function coverageStatusOf(company: WatchlistCompanySummary): CoverageStatus {
  return company.mark.coverage_status;
}

function formatDate(value: string | null): string {
  if (!value) return "미점검";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "미점검";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(date);
}
