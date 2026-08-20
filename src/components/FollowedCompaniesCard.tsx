"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import CompanyLogo from "@/components/CompanyLogo";
import type { FollowedCompanySummary } from "@/lib/follow/company-follow";
import { useCompanyFollow } from "@/lib/follow/use-company-follow";

interface FollowedCompaniesCardProps {
  initialCompanies: FollowedCompanySummary[];
  /** 무료 플랜의 관심 한도. 유료 플랜은 null(무제한). */
  activeLimit: number | null;
  /** Pro 여부 — 리서치 노트북 안내 링크 노출 근거. */
  hasNotebook: boolean;
}

export default function FollowedCompaniesCard({
  initialCompanies,
  activeLimit,
  hasNotebook,
}: FollowedCompaniesCardProps) {
  const [companies, setCompanies] = useState(initialCompanies);

  const handleRemoved = useCallback((ticker: string) => {
    setCompanies((current) =>
      current.filter((company) => company.ticker !== ticker),
    );
  }, []);

  const atLimit = activeLimit !== null && companies.length >= activeLimit;

  return (
    <section
      className="rounded-[10px] border border-hairline bg-canvas p-lg shadow-sm"
      aria-labelledby="followed-companies-heading"
    >
      <div className="flex items-baseline justify-between gap-sm">
        <h1
          id="followed-companies-heading"
          className="text-[22px] font-black tracking-[-0.035em] text-ink"
        >
          관심 기업
        </h1>
        <p className="text-[13px] font-extrabold text-muted">
          {companies.length}
          {activeLimit === null ? "개" : ` / ${activeLimit}개`}
        </p>
      </div>
      <p className="mt-xs text-sm font-medium leading-6 text-muted">
        관심 기업의 새 공시·뉴스를 이 기기로 알려드려요.
      </p>

      {activeLimit !== null && !atLimit && companies.length > 0 ? (
        <p className="mt-sm text-[12px] font-semibold leading-5 text-muted">
          무료 플랜은 {activeLimit}개까지 저장할 수 있어요.
        </p>
      ) : null}

      {atLimit ? (
        <div
          className="mt-sm flex flex-wrap items-center gap-x-sm gap-y-xs rounded-[10px] border border-hairline bg-surface-soft px-sm py-sm"
          aria-live="polite"
        >
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-[18px] text-primary"
          >
            lock
          </span>
          <p className="min-w-0 flex-1 text-[13px] font-extrabold leading-[1.4] text-ink">
            관심 기업이 가득 찼어요 · 무료 플랜은 {activeLimit}개까지
            <span className="ml-xs text-[12px] font-medium text-muted">
              무제한 관심·알림은 유료 플랜
            </span>
          </p>
          <Link
            href="/pricing"
            className="text-[12px] font-bold text-primary underline-offset-2 hover:underline"
          >
            플랜 보기
          </Link>
        </div>
      ) : null}

      {companies.length === 0 ? (
        <div className="mt-md">
          <p className="rounded-[8px] border border-hairline px-sm py-sm text-sm leading-6 text-muted">
            아직 관심 기업이 없어요. 채팅이나 기업 페이지에서 관심을 추가하면
            새 소식을 알려드려요.
          </p>
          <Link
            href="/companies"
            className="mt-sm inline-flex min-h-11 items-center text-[13px] font-bold text-primary underline-offset-2 hover:underline"
          >
            회사 둘러보기
          </Link>
        </div>
      ) : (
        <ul className="mt-md divide-y divide-hairline">
          {companies.map((company) => (
            <FollowedCompanyRow
              key={company.ticker}
              company={company}
              onRemoved={handleRemoved}
            />
          ))}
        </ul>
      )}

      {hasNotebook ? (
        <Link
          href="/watchlist"
          className="mt-md flex min-h-11 items-center justify-between gap-sm rounded-[8px] px-sm text-[13px] font-bold text-body transition-colors hover:bg-surface-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span>리서치 노트북에서 노트·질문까지 관리</span>
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-[18px]"
          >
            arrow_forward
          </span>
        </Link>
      ) : null}
    </section>
  );
}

function FollowedCompanyRow({
  company,
  onRemoved,
}: {
  company: FollowedCompanySummary;
  onRemoved: (ticker: string) => void;
}) {
  const followState = useCompanyFollow(company.ticker, {
    surface: "settings_companies",
    initialFollowing: true,
  });
  const [removing, setRemoving] = useState(false);

  const handleUnfollow = useCallback(async () => {
    if (removing) return;
    setRemoving(true);
    const result = await followState.unfollow();
    if (result.ok) {
      onRemoved(company.ticker);
      return;
    }
    setRemoving(false);
  }, [company.ticker, followState, onRemoved, removing]);

  return (
    <li className="flex items-center gap-sm py-xs">
      <Link
        href={`/companies/${encodeURIComponent(company.ticker)}`}
        className="flex min-w-0 flex-1 items-center gap-sm rounded-[8px] py-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <CompanyLogo
          ticker={company.ticker}
          companyName={company.name}
          className="h-10 w-10 text-[11px]"
        />
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-bold leading-[1.35] text-ink">
            {company.name}
          </span>
          <span className="block truncate text-[12px] font-medium leading-[1.35] text-muted">
            {company.ticker}
            {company.sector ? ` · ${company.sector}` : ""}
          </span>
        </span>
      </Link>
      {followState.error && !removing ? (
        <span className="text-[12px] font-semibold text-primary">
          해제하지 못했어요
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => void handleUnfollow()}
        disabled={removing}
        className="inline-flex min-h-11 items-center rounded-[8px] px-sm text-[13px] font-bold text-muted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-55"
      >
        {removing ? "해제 중…" : "해제"}
      </button>
    </li>
  );
}
