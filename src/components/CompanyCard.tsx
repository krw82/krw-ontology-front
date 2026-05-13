"use client";

import Link from "next/link";

export interface CompanyCardData {
  ticker: string;
  name: string;
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
}

export default function CompanyCard({ company }: CompanyCardProps) {
  const icon = company.icon || "business";

  return (
    <Link href={`/chat?ticker=${encodeURIComponent(company.ticker)}`}>
      <article className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-hairline bg-canvas p-base transition-all hover:shadow-md sm:p-lg">
        <div className="mb-md flex items-start justify-between gap-base">
          <div className="min-w-0">
            <h2 className="text-[32px] font-normal leading-[1.11] tracking-normal text-ink transition-colors group-hover:text-primary-container sm:text-[36px]">
              {company.ticker}
            </h2>
            <span className="block truncate font-mono text-[12px] font-medium leading-[1.4] text-muted">
              {company.name}
            </span>
          </div>
          <div className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-surface-strong text-ink">
            <span className="material-symbols-outlined">{icon}</span>
          </div>
        </div>
        <p className="mb-lg flex-grow text-[15px] font-normal leading-[1.5] text-body sm:text-[16px]">
          {company.description}
        </p>
        <div className="space-y-sm border-t border-hairline-soft pt-base">
          {company.coverage && (
            <div className="flex flex-col gap-xxs">
              <span className="text-[15px] font-bold leading-[1.5] text-ink sm:text-[16px]">
                인덱싱 범위
              </span>
              <p className="text-[14px] font-normal leading-[1.5] text-muted">
                {company.coverage}
              </p>
            </div>
          )}
          {company.core_strength && (
            <div className="flex flex-col gap-xxs">
              <span className="text-[15px] font-bold leading-[1.5] text-ink sm:text-[16px]">
                주요 사업 활동
              </span>
              <p className="text-[14px] font-normal leading-[1.5] text-muted">
                {company.core_strength}
              </p>
            </div>
          )}
          {company.critical_risk && (
            <div className="flex flex-col gap-xxs">
              <span className="text-[15px] font-bold leading-[1.5] text-ink sm:text-[16px]">
                핵심 변수
              </span>
              <p className="text-[14px] font-normal leading-[1.5] text-muted">
                {company.critical_risk}
              </p>
            </div>
          )}
        </div>
      </article>
    </Link>
  );
}
