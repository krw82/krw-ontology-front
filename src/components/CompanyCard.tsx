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
      <article className="bg-canvas border border-hairline rounded-[24px] p-lg hover:shadow-md transition-all group relative overflow-hidden flex flex-col cursor-pointer">
        <div className="flex justify-between items-start mb-md">
          <div>
            <h2 className="text-[36px] leading-[1.11] tracking-[-0.5px] font-normal text-ink group-hover:text-primary-container transition-colors">
              {company.ticker}
            </h2>
            <span className="font-mono text-[12px] leading-[1.4] font-medium text-muted">
              {company.name}
            </span>
          </div>
          <div className="w-[40px] h-[40px] bg-surface-strong rounded-full flex items-center justify-center text-ink">
            <span className="material-symbols-outlined">{icon}</span>
          </div>
        </div>
        <p className="text-[16px] leading-[1.5] font-normal text-body mb-lg flex-grow">
          {company.description}
        </p>
        <div className="space-y-sm pt-base border-t border-hairline-soft">
          {company.coverage && (
            <div className="flex flex-col gap-xxs">
              <span className="text-[16px] leading-[1.5] font-bold text-ink">
                Coverage
              </span>
              <p className="text-[14px] leading-[1.5] font-normal text-muted">
                {company.coverage}
              </p>
            </div>
          )}
          {company.core_strength && (
            <div className="flex flex-col gap-xxs">
              <span className="text-[16px] leading-[1.5] font-bold text-ink">
                Business Activity
              </span>
              <p className="text-[14px] leading-[1.5] font-normal text-muted">
                {company.core_strength}
              </p>
            </div>
          )}
          {company.critical_risk && (
            <div className="flex flex-col gap-xxs">
              <span className="text-[16px] leading-[1.5] font-bold text-ink">
                Key Factors
              </span>
              <p className="text-[14px] leading-[1.5] font-normal text-muted">
                {company.critical_risk}
              </p>
            </div>
          )}
        </div>
      </article>
    </Link>
  );
}
