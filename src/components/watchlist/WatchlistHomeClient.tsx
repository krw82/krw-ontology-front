"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  WatchlistCompanySummary,
  WatchlistOverviewResponse,
} from "@/types/api-contracts";

type FilterKey = "all" | "watchlisted" | "holding" | "questions" | "notes";

interface WatchlistHomeClientProps {
  overview: WatchlistOverviewResponse;
  loadError?: string | null;
}

const FILTERS: Array<{ key: FilterKey; label: string; icon: string }> = [
  { key: "all", label: "전체", icon: "apps" },
  { key: "watchlisted", label: "관심", icon: "bookmark" },
  { key: "holding", label: "보유", icon: "inventory_2" },
  { key: "questions", label: "열린 질문", icon: "help" },
  { key: "notes", label: "최근 노트", icon: "edit_note" },
];

export default function WatchlistHomeClient({
  overview,
  loadError = null,
}: WatchlistHomeClientProps) {
  const router = useRouter();
  const tickerInputRef = useRef<HTMLInputElement | null>(null);
  const [companies, setCompanies] = useState(overview.companies);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [ticker, setTicker] = useState("");
  const [interestReason, setInterestReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const stats = useMemo(() => buildStats(companies), [companies]);
  const filteredCompanies = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return companies.filter((company) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "holding" && company.mark.is_holding) ||
        (filter === "watchlisted" && company.mark.is_watchlisted) ||
        (filter === "questions" && company.open_question_count > 0) ||
        (filter === "notes" && company.note_count > 0);
      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        company.ticker,
        company.name,
        company.companyNameKo,
        company.sector,
        company.description,
        company.mark.interest_reason,
        company.mark.tags.join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [companies, filter, query]);

  const handleAddCompany = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const nextTicker = ticker.trim().toUpperCase();
    if (!nextTicker) {
      setError("티커를 입력해주세요.");
      return;
    }

    startTransition(async () => {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: nextTicker,
          is_watchlisted: true,
          interest_reason: interestReason,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(
          payload?.error?.message ?? "종목을 내 종목장에 추가하지 못했습니다.",
        );
        return;
      }
      const savedTicker = payload?.mark?.ticker ?? nextTicker;
      setCompanies((current) => {
        if (current.some((company) => company.ticker === savedTicker)) {
          return current;
        }
        return current;
      });
      router.push(`/watchlist/${encodeURIComponent(savedTicker)}`);
    });
  };

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
          <div className="mt-3 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
            <div className="min-w-0">
              <h1 className="text-balance text-[32px] font-black leading-[1.08] tracking-normal text-ink sm:text-[44px]">
                내 종목장
              </h1>
              <p className="mt-4 max-w-2xl text-[16px] leading-7 text-body sm:text-[18px]">
                관심종목과 보유종목을 공시 근거로 계속 점검합니다.
                매수·매도 추천이 아니라, 내가 왜 이 종목을 보는지와
                무엇을 확인해야 하는지 정리하는 공간입니다.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex h-11 items-center gap-1 rounded-[8px] bg-surface-dark px-sm text-[14px] font-extrabold text-on-dark transition-colors hover:bg-primary-active"
                  onClick={() => tickerInputRef.current?.focus()}
                >
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-[18px]"
                  >
                    add
                  </span>
                  회사 추가
                </button>
                <Link
                  href="/chat/new"
                  className="inline-flex h-11 items-center gap-1 rounded-[8px] border border-hairline bg-canvas px-sm text-[14px] font-extrabold text-ink transition-colors hover:border-primary hover:text-primary"
                >
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-[18px]"
                  >
                    chat_bubble
                  </span>
                  공시 기준으로 질문하기
                </Link>
              </div>
            </div>
            <form
              className="grid gap-2 border border-hairline bg-surface-soft p-sm"
              onSubmit={handleAddCompany}
            >
              <label
                htmlFor="watchlist-ticker"
                className="text-[12px] font-extrabold leading-4 text-muted"
              >
                종목 추가
              </label>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_112px]">
                <input
                  id="watchlist-ticker"
                  ref={tickerInputRef}
                  className="h-11 min-w-0 rounded-[8px] border border-hairline bg-canvas px-sm font-mono text-[15px] font-bold uppercase text-ink placeholder:normal-case placeholder:text-muted focus:border-primary focus:outline-none"
                  placeholder="AAPL"
                  value={ticker}
                  onChange={(event) => setTicker(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="submit"
                  className="inline-flex h-11 items-center justify-center gap-1 rounded-[8px] bg-surface-dark px-sm text-[14px] font-extrabold text-on-dark transition-colors hover:bg-primary-active disabled:cursor-not-allowed disabled:opacity-55"
                  disabled={isPending}
                >
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-[18px]"
                  >
                    add
                  </span>
                  추가
                </button>
              </div>
              <textarea
                className="min-h-16 resize-y rounded-[8px] border border-hairline bg-canvas px-sm py-xs text-[13px] font-semibold leading-5 text-ink placeholder:text-muted focus:border-primary focus:outline-none"
                placeholder="관심 이유"
                value={interestReason}
                onChange={(event) => setInterestReason(event.target.value)}
                maxLength={1200}
              />
              {error && (
                <p className="text-[12px] font-bold leading-4 text-error">
                  {error}
                </p>
              )}
            </form>
          </div>
        </header>

        <section className="grid border-b border-hairline md:grid-cols-5">
          <Metric label="관심종목" value={stats.watchlisted} />
          <Metric label="보유종목" value={stats.holding} />
          <Metric label="열린 질문" value={stats.open_questions} />
          <Metric label="리서치 노트" value={stats.notes} />
          <Metric label="최근 점검" value={stats.recent_activity} />
        </section>

        {loadError && (
          <div className="mt-4 border border-error-container bg-error-container/40 px-sm py-xs text-[13px] font-bold leading-5 text-error">
            {loadError}
          </div>
        )}

        <section className="mt-6">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="relative">
              <span
                aria-hidden="true"
                className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-muted"
              >
                search
              </span>
              <input
                className="h-11 w-full rounded-[8px] border border-hairline bg-surface pl-10 pr-sm text-[14px] font-semibold leading-5 text-ink placeholder:text-muted focus:border-primary focus:bg-canvas focus:outline-none"
                placeholder="티커, 회사명, 태그 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={[
                    "inline-flex h-10 items-center gap-1 rounded-[8px] border px-sm text-[13px] font-extrabold leading-4 transition-colors",
                    filter === item.key
                      ? "border-primary bg-primary-fixed text-on-primary-fixed"
                      : "border-hairline bg-canvas text-muted hover:border-primary hover:text-primary",
                  ].join(" ")}
                  aria-pressed={filter === item.key}
                  onClick={() => setFilter(item.key)}
                >
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-[17px]"
                  >
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {companies.length === 0 ? (
            <EmptyWatchlist />
          ) : filteredCompanies.length === 0 ? (
            <div className="mt-6 border border-hairline bg-surface-soft p-lg text-center text-[15px] font-bold leading-6 text-muted">
              조건에 맞는 종목이 없습니다.
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-[8px] border border-hairline bg-canvas">
              <div className="hidden grid-cols-[116px_minmax(220px,1fr)_128px_116px_116px_120px] border-b border-hairline bg-surface px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted xl:grid">
                <span>ticker</span>
                <span>research state</span>
                <span>status</span>
                <span>questions</span>
                <span>notes</span>
                <span>activity</span>
              </div>
              <div className="divide-y divide-hairline">
                {filteredCompanies.map((company) => (
                  <CompanyRow key={company.ticker} company={company} />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function buildStats(companies: WatchlistCompanySummary[]) {
  return {
    total: companies.length,
    watchlisted: companies.filter((company) => company.mark.is_watchlisted).length,
    holding: companies.filter((company) => company.mark.is_holding).length,
    open_questions: companies.reduce(
      (sum, company) => sum + company.open_question_count,
      0,
    ),
    notes: companies.reduce((sum, company) => sum + company.note_count, 0),
    recent_activity: companies.filter((company) => company.latest_activity_at).length,
  };
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-hairline py-5 md:border-r md:px-5 md:last:border-r-0">
      <p className="text-[12px] font-extrabold leading-4 text-muted">{label}</p>
      <p className="mt-2 font-mono text-[28px] font-black leading-8 text-ink">
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function CompanyRow({ company }: { company: WatchlistCompanySummary }) {
  return (
    <Link
      href={`/watchlist/${encodeURIComponent(company.ticker)}`}
      className="grid gap-3 px-4 py-4 transition-colors hover:bg-surface-soft xl:grid-cols-[116px_minmax(220px,1fr)_128px_116px_116px_120px] xl:items-center"
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
        <p className="truncate text-[15px] font-black leading-5 text-ink">
          {company.companyNameKo ?? company.name}
        </p>
        <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-5 text-muted">
          {company.mark.interest_reason || company.description}
        </p>
      </div>
      <StatusChips company={company} />
      <MobileMetric label="질문" value={company.open_question_count} />
      <MobileMetric label="노트" value={company.note_count} />
      <div className="text-[12px] font-bold leading-5 text-muted">
        {formatDate(company.latest_activity_at)}
      </div>
    </Link>
  );
}

function StatusChips({ company }: { company: WatchlistCompanySummary }) {
  const chips = [
    company.mark.is_holding ? "보유" : null,
    company.mark.is_watchlisted ? "관심" : null,
  ].filter(Boolean);

  if (chips.length === 0) {
    return <span className="text-[12px] font-bold text-muted">미지정</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-[8px] border border-hairline bg-surface px-2 py-1 text-[12px] font-extrabold leading-4 text-ink"
        >
          {chip}
        </span>
      ))}
    </div>
  );
}

function MobileMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2 xl:block">
      <span className="text-[12px] font-bold text-muted xl:hidden">{label}</span>
      <span className="font-mono text-[14px] font-black text-ink">
        {value.toLocaleString()}
      </span>
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
        관심 있는 회사를 저장하면 공시 근거로 투자 가설과 확인 질문을 계속
        정리할 수 있습니다.
      </p>
      <div className="mt-5 border-y border-hairline py-4">
        <p className="text-[12px] font-extrabold leading-4 text-muted">
          예시: AAPL을 저장하면
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {[
            "내가 왜 보는지 기록",
            "서비스 매출과 중국 수요를 열린 질문으로 관리",
            "공시 기준으로 thesis 점검",
            "채팅 답변을 리서치 노트로 저장",
          ].map((item) => (
            <div key={item} className="flex gap-2">
              <span
                aria-hidden="true"
                className="material-symbols-outlined mt-[2px] text-[17px] text-primary"
              >
                check
              </span>
              <p className="text-[13px] font-bold leading-5 text-ink">{item}</p>
            </div>
          ))}
        </div>
      </div>
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
