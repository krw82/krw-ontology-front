"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import { trackClientEventWithTimeout } from "@/lib/analytics/client";
import { cn } from "@/lib/utils";
import CompanyFilingSubscriptionControl from "@/components/filings/CompanyFilingSubscriptionControl";
import { signalPwaInstallEngagement } from "@/components/pwa/lifecycle";
import type { Locale } from "@/i18n/config";
import type { CoverageOnboardingFiling } from "@/lib/onboarding/coverage-flow";
import type { UserCompanyCoverageLevel } from "@/types/api-contracts";

type CoverageLevel = UserCompanyCoverageLevel;

type CompanyWatchlistActionsProps = {
  ticker: string;
  isAuthenticated: boolean;
  loginHref: string;
  destinationHref: string;
  initialCoverageLevel?: CoverageLevel | null;
  labels: {
    watchlist: string;
    holding: string;
    savedWatchlist: string;
    savedHolding: string;
    saving: string;
    error: string;
  };
  analyticsProperties?: Record<string, unknown>;
  onboarding?: {
    locale: Locale;
    latestImportantFiling: CoverageOnboardingFiling | null;
    memoryHref: string;
    continuePath: string | null;
  } | null;
};

export default function CompanyWatchlistActions({
  ticker,
  isAuthenticated,
  loginHref,
  destinationHref,
  initialCoverageLevel,
  labels,
  analyticsProperties,
  onboarding = null,
}: CompanyWatchlistActionsProps) {
  const [pending, setPending] = useState(false);
  const [coverageLevel, setCoverageLevel] = useState<CoverageLevel | null>(
    initialCoverageLevel ?? null,
  );
  const [error, setError] = useState<string | null>(null);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row">
        <WatchlistLink href={loginHref} icon="radar" emphasis>
          커버리지에 추가
        </WatchlistLink>
        <CompanyFilingSubscriptionControl ticker={ticker} loginHref={loginHref} isAuthenticated={false} />
      </div>
    );
  }

  const saveCoverageLevel = async (nextLevel: CoverageLevel | null) => {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/watchlist/${encodeURIComponent(ticker)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          coverage_level: nextLevel,
        }),
      });

      if (!response.ok) {
        throw new Error((await readErrorMessage(response)) ?? labels.error);
      }

      void trackClientEventWithTimeout("cta_clicked", {
        cta_id: "company_coverage_level_changed",
        cta_label: coverageLevelLabel(nextLevel),
        surface: "company_hero",
        ticker,
        coverage_level: nextLevel ?? "none",
        destination: destinationHref,
        ...analyticsProperties,
      });
      if (coverageLevel === null && nextLevel !== null) {
        void trackClientEventWithTimeout("company_followed", {
          ticker,
          surface: "company_hero",
        });
      }
      if (nextLevel !== null) {
        signalPwaInstallEngagement("watch_added", "company_hero");
      }

      setCoverageLevel(nextLevel);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : labels.error);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="min-w-0">
      {onboarding ? (
        <CoverageOnboardingBanner
          ticker={ticker}
          coverageLevel={coverageLevel}
          locale={onboarding.locale}
          latestImportantFiling={onboarding.latestImportantFiling}
          memoryHref={onboarding.memoryHref}
          continuePath={onboarding.continuePath}
        />
      ) : null}
      <div className="flex flex-wrap gap-2 sm:items-center" role="group" aria-label="커버리지 수준">
        <button type="button" disabled={pending} onClick={() => void saveCoverageLevel("interest")} className={actionClassName(false, coverageLevel === "interest")}>
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">radar</span>
          {labels.watchlist}
        </button>
        <button type="button" disabled={pending} onClick={() => void saveCoverageLevel("holding")} className={actionClassName(false, coverageLevel === "holding")}>
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">account_balance_wallet</span>
          {labels.holding}
        </button>
        {coverageLevel !== null ? (
          <button type="button" disabled={pending} onClick={() => void saveCoverageLevel(null)} className="inline-flex min-h-12 items-center rounded-[8px] px-3 py-3 text-[13px] font-extrabold text-muted transition-colors hover:text-error disabled:cursor-not-allowed disabled:opacity-60">
            커버리지 해제
          </button>
        ) : null}
      </div>
      <CompanyFilingSubscriptionControl ticker={ticker} loginHref={loginHref} isAuthenticated />
      {error ? (
        <p className="mt-2 text-[13px] font-bold leading-5 text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CoverageOnboardingBanner({
  ticker,
  coverageLevel,
  locale,
  latestImportantFiling,
  memoryHref,
  continuePath,
}: {
  ticker: string;
  coverageLevel: CoverageLevel | null;
  locale: Locale;
  latestImportantFiling: CoverageOnboardingFiling | null;
  memoryHref: string;
  continuePath: string | null;
}) {
  const hasActiveCoverage = Boolean(
    coverageLevel !== null,
  );
  const filingHref = latestImportantFiling
      ? `/filings/${encodeURIComponent(latestImportantFiling.id)}?${new URLSearchParams({
        onboarding: "coverage",
        source: "onboarding",
        locale,
        ticker,
        ...(continuePath ? { continue: continuePath } : {}),
      }).toString()}`
    : null;
  const copy = locale === "ko"
    ? {
        eyebrow: "첫 판단 준비 · 1/3",
        pendingTitle: "이 회사를 어떤 상태로 볼까요?",
        pendingDescription:
          "관심 또는 보유 중 하나를 고르면, 이 회사에서 먼저 확인할 실제 근거로 이어집니다.",
        savedTitle: `${ticker} 커버리지 상태를 저장했습니다`,
        filingDescription: latestImportantFiling
          ? `${formatOnboardingDate(latestImportantFiling.filing_date, locale)} ${latestImportantFiling.form_type} · ${latestImportantFiling.label}`
          : "지금 열 수 있는 중요 공시가 없어, 먼저 회사별 가설과 확인 조건을 남깁니다.",
        filingCta: "최신 중요 공시로 계속",
        memoryCta: "커버리지 메모 만들기",
      }
    : {
        eyebrow: "First judgment · 1 of 3",
        pendingTitle: "How are you following this company?",
        pendingDescription:
          "Choose Interest or Holding, then continue to the first real piece of evidence.",
        savedTitle: `${ticker} coverage status saved`,
        filingDescription: latestImportantFiling
          ? `${formatOnboardingDate(latestImportantFiling.filing_date, locale)} ${latestImportantFiling.form_type} · ${latestImportantFiling.label}`
          : "No accessible important filing is available yet, so start with the company's coverage memory.",
        filingCta: "Continue to the latest filing",
        memoryCta: "Create coverage memory",
      };

  return (
    <section
      className="mb-3 rounded-[10px] border border-primary/25 bg-primary-fixed/45 p-sm"
      aria-live="polite"
    >
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((step) => (
          <span
            key={step}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              step === 0 ? "bg-primary" : "bg-primary/15",
            )}
          />
        ))}
      </div>
      <p className="mt-3 font-mono text-[10px] font-black uppercase tracking-[0.14em] text-primary">
        {copy.eyebrow}
      </p>
      <p className="mt-1 text-[14px] font-black leading-5 text-ink">
        {hasActiveCoverage ? copy.savedTitle : copy.pendingTitle}
      </p>
      <p className="mt-1 text-[12px] font-semibold leading-5 text-muted">
        {hasActiveCoverage ? copy.filingDescription : copy.pendingDescription}
      </p>
      {hasActiveCoverage ? (
        <Link
          href={filingHref ?? memoryHref}
          onClick={() => {
            void trackClientEventWithTimeout("cta_clicked", {
              cta_id: filingHref
                ? "coverage_onboarding_latest_filing"
                : "coverage_onboarding_memory",
              cta_label: filingHref ? copy.filingCta : copy.memoryCta,
              surface: "company_hero",
              ticker,
              destination: filingHref ?? memoryHref,
            });
          }}
          className="mt-3 inline-flex min-h-11 items-center rounded-[7px] bg-primary px-sm text-[13px] font-extrabold text-on-primary transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {filingHref ? copy.filingCta : copy.memoryCta}
          <span className="material-symbols-outlined ml-1 text-[17px]" aria-hidden="true">
            arrow_forward
          </span>
        </Link>
      ) : null}
    </section>
  );
}

function WatchlistLink({
  href,
  icon,
  emphasis = false,
  children,
}: {
  href: string;
  icon: string;
  emphasis?: boolean;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={actionClassName(emphasis)}>
      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
        {icon}
      </span>
      {children}
    </Link>
  );
}

function actionClassName(emphasis: boolean, selected = false) {
  return cn(
    "inline-flex min-h-12 items-center justify-center gap-1 rounded-[8px] px-5 py-3 text-[15px] font-extrabold leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60",
    selected
      ? "border border-primary bg-primary-fixed text-on-primary-fixed hover:border-primary hover:bg-primary-fixed"
      : null,
    !selected && emphasis
      ? "border border-hairline bg-canvas text-ink hover:border-primary hover:text-primary"
      : null,
    !selected && !emphasis
      ? "border border-hairline bg-canvas text-ink hover:border-primary hover:text-primary"
      : null,
  );
}

function coverageLevelLabel(level: CoverageLevel | null): string {
  if (level === "interest") return "관심";
  if (level === "holding") return "보유 중";
  return "커버리지 해제";
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: unknown };
    };
    return typeof payload.error?.message === "string"
      ? payload.error.message
      : null;
  } catch {
    return null;
  }
}

function formatOnboardingDate(value: string, locale: Locale): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}
