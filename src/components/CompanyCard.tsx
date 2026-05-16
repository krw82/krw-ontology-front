"use client";

import Link from "next/link";

export interface CompanyCardData {
  ticker: string;
  name: string;
  sector?: string | null;
  description: string;
  latest_period?: string | null;
  coverage?: string | null;
  core_strength?: string;
  critical_risk?: string;
  icon?: string;
  document_count?: number;
  document_types?: string[];
  periods?: string[];
  generated_at?: string | null;
}

interface CompanyCardProps {
  company: CompanyCardData;
  motionDelay?: number;
}

function readableText(value: string): string {
  return value
    .replace(/^Primary activities:\s*/i, "주요 활동: ")
    .replace(/^Key external factors:\s*/i, "핵심 변수: ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function CompanyCard({
  company,
  motionDelay = 0,
}: CompanyCardProps) {
  const coreStrength = company.core_strength
    ? readableText(company.core_strength)
    : null;
  const criticalRisk = company.critical_risk
    ? readableText(company.critical_risk)
    : null;
  const companyLabel =
    company.name && company.name !== company.ticker ? company.name : "";
  const accessibleSummary = [
    company.ticker,
    company.name && company.name !== company.ticker ? company.name : null,
    company.sector ? `${company.sector} 섹터` : null,
    company.coverage,
    coreStrength,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <Link
      href={`/chat?ticker=${encodeURIComponent(company.ticker)}`}
      className="group block cursor-pointer animate-fade-in-up border-b border-hairline-soft last:border-b-0 opacity-0"
      style={{
        animationDelay: `${motionDelay}ms`,
        animationDuration: "150ms",
      }}
      aria-label={`${accessibleSummary}. 이 회사 리서치 채팅 열기`}
    >
      <article className="grid gap-3 px-4 py-4 transition-[transform,color,background-color] duration-150 ease-out hover:-translate-y-[1px] hover:bg-surface 2xl:grid-cols-[116px_minmax(220px,1.1fr)_minmax(260px,1.5fr)_minmax(220px,1fr)] 2xl:items-start active:scale-[0.995] active:bg-surface-soft">
        <div className="flex min-w-0 items-start justify-between gap-4 2xl:block">
          <div>
            <h2 className="font-mono text-[22px] font-black leading-none text-ink transition-colors group-hover:text-primary sm:text-[24px] 2xl:text-[22px]">
              {company.ticker}
            </h2>
          </div>
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-[22px] text-muted transition-colors group-hover:text-primary 2xl:hidden"
          >
            arrow_forward
          </span>
        </div>

        <div className="min-w-0">
          {companyLabel ? (
            <p className="truncate text-[15px] font-extrabold leading-5 text-ink">
              {companyLabel}
            </p>
          ) : (
            <span aria-hidden="true" className="block h-5" />
          )}
          {company.sector && (
            <p className="mt-1 truncate text-[12px] font-semibold leading-4 text-muted">
              {company.sector}
            </p>
          )}
          <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted 2xl:hidden">
            {coreStrength ?? company.description}
          </p>
        </div>

        <p className="hidden min-w-0 text-[13px] leading-5 text-body 2xl:line-clamp-2">
          {coreStrength ?? company.description}
        </p>

        <p className="hidden min-w-0 text-[13px] leading-5 text-muted 2xl:line-clamp-2">
          {criticalRisk ?? "추적 변수 미등록"}
        </p>
      </article>
    </Link>
  );
}
