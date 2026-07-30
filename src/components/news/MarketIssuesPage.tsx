"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatIssueRelativeTime,
  normalizeMarketIssueList,
  normalizeMarketIssuesStatus,
  type MarketIssueCard,
  type MarketIssueScope,
  type MarketIssuesStatus,
} from "@/components/news/news-model";

const SCOPE_COPY: Record<MarketIssueScope, { label: string; description: string }> = {
  mine: {
    label: "내 기업",
    description: "관심종목으로 지정한 기업과 연결된 변화만 모았습니다.",
  },
  market: {
    label: "시장 전체",
    description: "시장 변화 중 원문을 다시 확인할 수 있는 이슈를 차분히 모았습니다.",
  },
};

function getInitialScope(): MarketIssueScope {
  if (typeof window === "undefined") return "market";
  return new URLSearchParams(window.location.search).get("scope") === "mine"
    ? "mine"
    : "market";
}

function mergeIssues(current: readonly MarketIssueCard[], next: readonly MarketIssueCard[]): MarketIssueCard[] {
  const byId = new Map(current.map((issue) => [issue.id, issue]));
  for (const issue of next) byId.set(issue.id, issue);
  return Array.from(byId.values());
}

export default function MarketIssuesPage() {
  const [scope, setScope] = useState<MarketIssueScope>(getInitialScope);
  const [issues, setIssues] = useState<MarketIssueCard[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<MarketIssuesStatus>({ label: null, updatedAt: null });
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const loadIssues = useCallback(async (targetScope: MarketIssueScope, cursor?: string) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const append = Boolean(cursor);

    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);

    try {
      const query = new URLSearchParams({ scope: targetScope });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/news/issues?${query.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("market_issues_failed");

      const payload = normalizeMarketIssueList(await response.json());
      if (requestId !== requestRef.current || controller.signal.aborted) return;

      setIssues((current) => append ? mergeIssues(current, payload.issues) : payload.issues);
      setNextCursor(payload.nextCursor);
    } catch (loadError) {
      if (controller.signal.aborted || requestId !== requestRef.current) return;
      setError(
        navigator.onLine
          ? "시장 이슈를 불러오지 못했습니다. 잠시 후 다시 시도해주세요."
          : "오프라인 상태입니다. 연결되면 다시 시도해주세요.",
      );
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/news/status", { cache: "no-store" });
      if (!response.ok) return;
      setStatus(normalizeMarketIssuesStatus(await response.json()));
    } catch {
      // The status stamp is supplemental and must not block the issue list.
    }
  }, []);

  useEffect(() => {
    void loadIssues(scope);
  }, [loadIssues, scope]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const changeScope = (nextScope: MarketIssueScope) => {
    if (nextScope === scope) return;
    setScope(nextScope);
    const url = new URL(window.location.href);
    if (nextScope === "mine") url.searchParams.delete("scope");
    else url.searchParams.set("scope", nextScope);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const retry = () => {
    void loadIssues(scope);
    void loadStatus();
  };

  return (
    <main id="main-content" className="mx-auto w-full max-w-5xl px-base pb-3xl pt-xl sm:px-xl sm:pt-2xl">
      <header className="relative overflow-hidden rounded-[28px] border border-[#dbe5f7] bg-[linear-gradient(135deg,#f6f9ff_0%,#f8fbff_47%,#edf5ff_100%)] px-lg py-xl shadow-[0_18px_50px_rgba(37,83,157,0.07)] sm:px-2xl sm:py-2xl">
        <div className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-[#d9e8ff] blur-3xl" aria-hidden="true" />
        <div className="relative max-w-2xl">
          <p className="flex items-center gap-xs text-[12px] font-extrabold uppercase tracking-[0.15em] text-primary">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">newspaper</span>
            RESEARCH INBOX
          </p>
          <h1 className="mt-sm text-[32px] font-black tracking-[-0.05em] text-ink sm:text-[42px]">시장 이슈</h1>
          <p className="mt-sm max-w-[36rem] text-[15px] leading-7 text-body sm:text-[16px]">
            시끄러운 속보를 더하기보다, 기업과 산업에 연결되는 변화를 원문과 함께 살펴봅니다.
          </p>
          <p className="mt-base text-[12px] leading-5 text-muted">
            종목 추천이나 매매 신호가 아닌 리서치 검토용 정보입니다.
          </p>
        </div>
      </header>

      <section className="mt-xl" aria-labelledby="market-issues-heading">
        <div className="flex flex-col gap-base border-b border-hairline pb-base sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="market-issues-heading" className="text-[20px] font-extrabold tracking-[-0.03em] text-ink">
              오늘 확인할 변화
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-muted">{SCOPE_COPY[scope].description}</p>
          </div>
          <div className="flex items-center justify-between gap-sm sm:justify-end">
            {status.updatedAt ? (
              <p className="text-[11px] font-medium text-muted">
                {status.label ? `${status.label} · ` : ""}{formatIssueRelativeTime(status.updatedAt)}
              </p>
            ) : null}
            <button
              type="button"
              onClick={retry}
              disabled={loading || loadingMore}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-hairline bg-white px-sm text-[12px] font-bold text-body transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-[16px] ${loading ? "animate-spin" : ""}`} aria-hidden="true">refresh</span>
              새로고침
            </button>
          </div>
        </div>

        <div className="sticky top-0 z-10 -mx-base mt-base border-y border-hairline bg-canvas/95 px-base py-sm backdrop-blur sm:relative sm:top-auto sm:mx-0 sm:border-x-0 sm:px-0">
          <div className="inline-flex rounded-[14px] border border-hairline bg-white p-1" role="tablist" aria-label="시장 이슈 범위">
            {(Object.keys(SCOPE_COPY) as MarketIssueScope[]).map((itemScope) => {
              const active = scope === itemScope;
              return (
                <button
                  key={itemScope}
                  id={`market-issues-${itemScope}-tab`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls="market-issues-panel"
                  onClick={() => changeScope(itemScope)}
                  className={`min-h-10 rounded-[10px] px-base text-[13px] font-extrabold transition ${
                    active
                      ? "bg-ink text-white shadow-sm"
                      : "text-muted hover:bg-surface-soft hover:text-ink"
                  }`}
                >
                  {SCOPE_COPY[itemScope].label}
                </button>
              );
            })}
          </div>
        </div>

        <div id="market-issues-panel" role="tabpanel" aria-labelledby={`market-issues-${scope}-tab`} className="mt-lg">
          {loading ? <IssueListSkeleton /> : null}
          {!loading && error && issues.length === 0 ? <IssueLoadError onRetry={retry} /> : null}
          {!loading && !error && issues.length === 0 ? <MarketIssuesEmpty scope={scope} onMarketScope={() => changeScope("market")} /> : null}
          {!loading && issues.length > 0 ? (
            <>
              {error ? (
                <div className="mb-base flex items-center justify-between gap-base rounded-[14px] border border-[#f0d7b0] bg-[#fffaf0] px-base py-sm text-[12px] leading-5 text-[#805719]" role="status">
                  <span>{error}</span>
                  <button type="button" onClick={retry} className="shrink-0 font-extrabold underline underline-offset-4">다시 시도</button>
                </div>
              ) : null}
              <div className="grid gap-base lg:grid-cols-2">
                {issues.map((issue) => <MarketIssueCard key={issue.id} issue={issue} />)}
              </div>
              {nextCursor ? (
                <div className="mt-xl flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadIssues(scope, nextCursor)}
                    disabled={loadingMore}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full border border-hairline bg-white px-lg text-[13px] font-bold text-ink transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingMore ? <span className="material-symbols-outlined animate-spin text-[17px]" aria-hidden="true">progress_activity</span> : null}
                    {loadingMore ? "이슈를 불러오는 중" : "더 보기"}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function MarketIssueCard({ issue }: { issue: MarketIssueCard }) {
  const href = `/news/${encodeURIComponent(issue.id)}`;
  const impactPath = issue.impactPath.slice(0, 3);
  const visibleCompanies = issue.companies.slice(0, 4);

  return (
    <article className="group flex min-h-full flex-col rounded-[22px] border border-hairline bg-white p-base shadow-[0_5px_22px_rgba(30,50,85,0.035)] transition duration-200 hover:-translate-y-0.5 hover:border-[#bdcff0] hover:shadow-[0_14px_34px_rgba(34,70,136,0.09)] sm:p-lg">
      <div className="flex justify-end">
        <time className="shrink-0 text-[11px] font-medium text-muted" dateTime={issue.updatedAt ?? issue.publishedAt ?? undefined}>
          {formatIssueRelativeTime(issue.updatedAt ?? issue.publishedAt)}
        </time>
      </div>

      <Link href={href} className="mt-base block rounded-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4">
        <h3 className="text-[19px] font-extrabold leading-[1.42] tracking-[-0.035em] text-ink transition group-hover:text-primary sm:text-[21px]">
          {issue.title}
        </h3>
        <div className="mt-sm border-l-2 border-[#bcd2fa] pl-sm">
          <p className="text-[11px] font-extrabold tracking-[0.01em] text-primary">AI가 정리한 한국어 맥락</p>
          <p className="mt-1 line-clamp-3 text-[14px] leading-6 text-body">{issue.summary}</p>
        </div>
      </Link>

      {impactPath.length > 0 ? (
        <div className="mt-base">
          <p className="text-[11px] font-extrabold text-muted">검토할 영향 경로</p>
          <ol className="mt-2 flex flex-wrap items-center gap-1.5">
            {impactPath.map((step, index) => (
              <li key={`${step}-${index}`} className="flex items-center gap-1.5">
                <span className="rounded-full bg-surface-soft px-sm py-1 text-[11px] font-semibold text-body">{step}</span>
                {index < impactPath.length - 1 ? <span className="material-symbols-outlined text-[13px] text-muted" aria-hidden="true">arrow_forward</span> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {visibleCompanies.length > 0 ? (
        <div className="mt-auto flex flex-wrap gap-1.5 pt-base" aria-label="관련 기업">
            {visibleCompanies.map((company) => (
              <span key={`${company.id ?? company.name}-${company.ticker ?? ""}`} className="inline-flex items-center gap-1 rounded-full border border-hairline bg-white px-sm py-1 text-[11px] font-bold text-body">
                {company.ticker ? <span className="text-primary">{company.ticker}</span> : null}
                <span>{company.name}</span>
              </span>
            ))}
            {issue.companies.length > visibleCompanies.length ? <span className="px-sm py-1 text-[11px] font-semibold text-muted">+{issue.companies.length - visibleCompanies.length}</span> : null}
        </div>
      ) : null}
    </article>
  );
}

function IssueListSkeleton() {
  return (
    <div className="grid gap-base lg:grid-cols-2" aria-label="시장 이슈를 불러오는 중" role="status">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="h-[278px] animate-pulse rounded-[22px] border border-hairline bg-white p-base">
          <div className="h-7 w-20 rounded-full bg-surface-soft" />
          <div className="mt-base h-7 w-4/5 rounded bg-surface-soft" />
          <div className="mt-sm h-5 w-full rounded bg-surface-soft" />
          <div className="mt-2 h-5 w-3/4 rounded bg-surface-soft" />
          <div className="mt-xl h-8 w-2/3 rounded-full bg-surface-soft" />
        </div>
      ))}
    </div>
  );
}

function IssueLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-[22px] border border-[#efd7b3] bg-[#fffaf2] px-lg py-xl text-center">
      <span className="material-symbols-outlined text-[28px] text-[#ae7521]" aria-hidden="true">cloud_off</span>
      <h3 className="mt-sm text-[17px] font-extrabold text-ink">시장 이슈를 불러오지 못했습니다.</h3>
      <p className="mt-1 text-[13px] leading-6 text-body">연결 상태를 확인한 뒤 다시 시도해주세요.</p>
      <button type="button" onClick={onRetry} className="mt-base min-h-10 rounded-full bg-ink px-base text-[13px] font-bold text-white transition hover:bg-primary">
        다시 시도
      </button>
    </div>
  );
}

function MarketIssuesEmpty({ scope, onMarketScope }: { scope: MarketIssueScope; onMarketScope: () => void }) {
  const mine = scope === "mine";
  return (
    <div className="rounded-[22px] border border-dashed border-[#cbd7ea] bg-[#fbfcff] px-lg py-2xl text-center">
      <span className="material-symbols-outlined text-[32px] text-primary" aria-hidden="true">travel_explore</span>
      <h3 className="mt-sm text-[18px] font-extrabold tracking-[-0.03em] text-ink">
        {mine ? "내 기업과 연결된 이슈가 아직 없습니다." : "지금 표시할 시장 이슈가 없습니다."}
      </h3>
      <p className="mx-auto mt-2 max-w-[28rem] text-[13px] leading-6 text-body">
        {mine
          ? "회사 리서치를 시작하거나 관심 기업을 확인하면, 연결된 시장 변화를 이곳에서 다시 볼 수 있습니다."
          : "새 이슈가 확인되면 원문과 함께 이 화면에 정리됩니다."}
      </p>
      {mine ? (
        <button type="button" onClick={onMarketScope} className="mt-base min-h-10 rounded-full border border-hairline bg-white px-base text-[13px] font-bold text-primary transition hover:border-primary hover:text-ink">
          시장 전체 보기
        </button>
      ) : null}
    </div>
  );
}
