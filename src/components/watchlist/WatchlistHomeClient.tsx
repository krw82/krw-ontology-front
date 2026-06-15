"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  ResearchInboxItem,
  WatchlistCompanySummary,
  WatchlistOverviewResponse,
} from "@/types/api-contracts";

interface WatchlistHomeClientProps {
  overview: WatchlistOverviewResponse;
  loadError?: string | null;
}

export default function WatchlistHomeClient({
  overview,
  loadError = null,
}: WatchlistHomeClientProps) {
  const [overviewState, setOverviewState] = useState(overview);
  const [dismissingQuestionId, setDismissingQuestionId] = useState<string | null>(
    null,
  );
  const companies = overviewState.companies;
  const [query, setQuery] = useState("");

  const researchInbox = overviewState.research_inbox;
  const filteredCompanies = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
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
  }, [companies, query]);
  const companySections = useMemo(() => {
    const holdingCompanies = filteredCompanies.filter(
      (company) => company.mark.is_holding,
    );
    const interestCompanies = filteredCompanies.filter(
      (company) => !company.mark.is_holding,
    );

    return [
      {
        key: "holding",
        title: "보유 중",
        emptyMessage: "보유로 표시한 리서치 노트북이 없습니다.",
        companies: holdingCompanies,
      },
      {
        key: "interest",
        title: "관심 중",
        emptyMessage: "관심으로 남은 리서치 노트북이 없습니다.",
        companies: interestCompanies,
      },
    ];
  }, [filteredCompanies]);
  const showEmptySections = query.trim().length === 0;

  async function handleDismissInboxQuestion(item: ResearchInboxItem) {
    if (!item.dismiss_question_id || dismissingQuestionId) return;

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

      const overviewResponse = await fetch("/api/watchlist", {
        cache: "no-store",
      });
      if (!overviewResponse.ok) throw new Error("Failed to refresh watchlist");

      setOverviewState((await overviewResponse.json()) as WatchlistOverviewResponse);
    } catch {
      setOverviewState((current) => ({
        ...current,
        research_inbox: current.research_inbox.filter(
          (existing) =>
            existing.ticker !== item.ticker ||
            existing.dismiss_question_id !== item.dismiss_question_id,
        ),
      }));
    } finally {
      setDismissingQuestionId(null);
    }
  }

  return (
    <main
      id="main-content"
      className="px-base pb-[112px] pt-xl sm:px-md md:px-xl md:pb-[96px] md:pt-[72px]"
    >
      <div className="mx-auto w-full max-w-[1200px]">
        <header className="border-b border-hairline pb-8">
          <p className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
            Personal Research
          </p>
          <div className="mt-3">
            <div className="min-w-0">
              <h1 className="text-balance text-[32px] font-black leading-[1.08] tracking-normal text-ink sm:text-[44px]">
                리서치 노트북
              </h1>
              <p className="mt-4 max-w-2xl text-[16px] leading-7 text-body sm:text-[18px]">
                관심종목과 보유종목을 공시 근거로 계속 점검합니다.
                매수·매도 추천이 아니라, 내가 왜 이 종목을 보는지와
                무엇을 확인해야 하는지 정리하는 공간입니다.
              </p>
            </div>
          </div>
        </header>

        {loadError && (
          <div className="mt-4 border border-error-container bg-error-container/40 px-sm py-xs text-[13px] font-bold leading-5 text-error">
            {loadError}
          </div>
        )}

        <ResearchInboxPanel
          dismissingQuestionId={dismissingQuestionId}
          inbox={researchInbox}
          onDismissQuestion={handleDismissInboxQuestion}
        />

        <section className="mt-6">
          <div className="grid gap-3">
            <div className="relative">
              <span
                aria-hidden="true"
                className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-muted"
              >
                search
              </span>
              <input
                className="h-11 w-full rounded-[8px] border border-hairline bg-surface pl-10 pr-sm text-[14px] font-semibold leading-5 text-ink placeholder:text-muted focus:border-primary focus:bg-canvas focus:outline-none"
                placeholder="티커, 회사명, 노트 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>

          {companies.length === 0 ? (
            <EmptyWatchlist />
          ) : filteredCompanies.length === 0 ? (
            <div className="mt-6 border border-hairline bg-surface-soft p-lg text-center text-[15px] font-bold leading-6 text-muted">
              조건에 맞는 종목이 없습니다.
            </div>
          ) : (
            <div className="mt-6 grid gap-7">
              {companySections
                .filter(
                  (section) => section.companies.length > 0 || showEmptySections,
                )
                .map((section) => (
                  <CompanySection
                    key={section.key}
                    title={section.title}
                    emptyMessage={section.emptyMessage}
                    companies={section.companies}
                  />
                ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function CompanySection({
  title,
  emptyMessage,
  companies,
}: {
  title: string;
  emptyMessage: string;
  companies: WatchlistCompanySummary[];
}) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-[20px] font-black leading-7 text-ink">{title}</h2>
        <span className="font-mono text-[13px] font-black leading-5 text-muted">
          {companies.length.toLocaleString()}개
        </span>
      </div>

      {companies.length === 0 ? (
        <div className="border border-hairline bg-surface-soft px-sm py-sm text-[13px] font-bold leading-5 text-muted">
          {emptyMessage}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[8px] border border-hairline bg-canvas">
          <div className="hidden grid-cols-[116px_minmax(220px,1fr)_120px] border-b border-hairline bg-surface px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted xl:grid">
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
      )}
    </section>
  );
}

function CompanyRow({ company }: { company: WatchlistCompanySummary }) {
  const companyName = visibleCompanyName(company);

  return (
    <Link
      href={`/watchlist/${encodeURIComponent(company.ticker)}`}
      className="grid gap-3 px-4 py-4 transition-colors hover:bg-surface-soft xl:grid-cols-[116px_minmax(220px,1fr)_120px] xl:items-center"
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
          <p className="truncate text-[15px] font-black leading-5 text-ink">
            {companyName}
          </p>
        )}
        <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-5 text-muted">
          {company.notebook_preview}
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
      <section className="mt-6 flex flex-wrap items-center justify-between gap-2 border border-hairline bg-canvas px-sm py-xs">
        <p className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-primary">
          Research Inbox
        </p>
        <p className="text-[14px] font-black leading-5 text-ink">
          오늘 처리할 리서치 없음
        </p>
      </section>
    );
  }

  return (
    <section className="mt-6 border border-hairline bg-canvas">
      <div className="border-b border-hairline px-sm py-sm md:px-md">
        <div>
          <p className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-primary">
            Research Inbox
          </p>
          <h2 className="mt-1 text-[22px] font-black leading-7 text-ink">
            오늘 처리할 리서치 {inbox.length.toLocaleString()}개
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
            className="flex h-11 w-full items-center justify-center gap-1 px-sm text-[13px] font-extrabold leading-5 text-muted transition-colors hover:bg-surface-soft hover:text-primary md:px-md"
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
            className="flex h-11 w-full items-center justify-center gap-1 px-sm text-[13px] font-extrabold leading-5 text-muted transition-colors hover:bg-surface-soft hover:text-primary md:px-md"
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

  return (
    <div className="grid gap-3 px-sm py-sm md:grid-cols-[116px_minmax(0,1fr)_auto] md:items-center md:px-md">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[18px] font-black leading-6 text-ink">
          {item.ticker}
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-[15px] font-black leading-5 text-ink">
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
          className="inline-flex h-10 items-center justify-center rounded-[8px] bg-surface-dark px-sm text-[13px] font-extrabold text-on-dark transition-colors hover:bg-primary-active"
        >
          {item.action_label}
        </Link>
        {item.secondary_action_href && item.secondary_action_label && (
          <Link
            href={item.secondary_action_href}
            className="inline-flex h-10 items-center justify-center rounded-[8px] border border-hairline bg-canvas px-sm text-[13px] font-extrabold text-ink transition-colors hover:border-primary hover:text-primary"
          >
            {item.secondary_action_label}
          </Link>
        )}
        {item.dismiss_question_id && (
          <button
            className="inline-flex h-10 items-center justify-center rounded-[8px] border border-hairline bg-canvas px-sm text-[13px] font-extrabold text-ink transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
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
    <div className="mt-6 border border-hairline bg-surface-soft p-lg">
      <p className="text-[18px] font-black leading-6 text-ink">
        아직 저장한 종목이 없습니다.
      </p>
      <p className="mt-3 max-w-2xl text-[14px] font-semibold leading-6 text-body">
        관심 있는 회사를 저장하면 종목별 Markdown 노트북에 리서치 기록을
        계속 정리할 수 있습니다.
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
          회사 탐색
        </Link>
        <a
          href="#watchlist-ticker"
          className="inline-flex h-11 items-center gap-1 rounded-[8px] border border-hairline bg-canvas px-sm text-[14px] font-extrabold text-ink transition-colors hover:border-primary hover:text-primary"
        >
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-[18px]"
          >
            add
          </span>
          티커로 추가
        </a>
      </div>
    </div>
  );
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
