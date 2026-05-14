"use client";

import Link from "next/link";
import type { ReactNode } from "react";

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

function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-[6px] border border-hairline bg-surface px-2 py-1 font-mono text-[11px] font-bold leading-none text-body">
      {children}
    </span>
  );
}

export default function CompanyCard({ company }: CompanyCardProps) {
  const documentTypes = company.document_types?.slice(0, 3) ?? [];
  const periods = company.periods?.slice(0, 3) ?? [];

  return (
    <Link
      href={`/chat?ticker=${encodeURIComponent(company.ticker)}`}
      className="group block"
    >
      <article className="grid min-h-full gap-4 rounded-[8px] border border-hairline bg-[#fffaf0] p-4 shadow-sm transition-colors hover:border-tertiary-container hover:bg-[#fff4df] sm:p-5">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-mono text-[30px] font-black leading-none tracking-[-0.02em] text-ink transition-colors group-hover:text-tertiary sm:text-[34px]">
                {company.ticker}
              </h2>
              {company.latest_period && (
                <span className="rounded-[6px] bg-surface-dark px-2 py-1 font-mono text-[11px] font-bold text-accent-yellow">
                  {company.latest_period}
                </span>
              )}
            </div>
            <p className="mt-2 truncate text-[13px] font-bold uppercase tracking-[0.08em] text-muted">
              {company.name}
            </p>
          </div>
          <span className="material-symbols-outlined text-[22px] text-tertiary-container transition-transform group-hover:translate-x-1">
            arrow_forward
          </span>
        </div>

        <p className="line-clamp-3 text-[15px] leading-6 text-body">
          {company.description}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-[8px] border border-hairline-soft bg-canvas/75 px-3 py-3">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
              filings
            </p>
            <p className="mt-2 text-[22px] font-black leading-none text-ink">
              {company.document_count ?? periods.length}
            </p>
          </div>
          <div className="rounded-[8px] border border-hairline-soft bg-canvas/75 px-3 py-3">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
              document type
            </p>
            <p className="mt-2 truncate text-[14px] font-extrabold leading-none text-ink">
              {documentTypes.length ? documentTypes.join(", ") : "Indexed"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {periods.map((period) => (
            <MetaPill key={period}>{period}</MetaPill>
          ))}
          {documentTypes.map((type) => (
            <MetaPill key={type}>{type}</MetaPill>
          ))}
        </div>

        <div className="space-y-3 border-t border-hairline-soft pt-4">
          {company.core_strength && (
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-tertiary">
                business activity
              </p>
              <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-body">
                {company.core_strength}
              </p>
            </div>
          )}
          {company.critical_risk && (
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-error">
                watch variable
              </p>
              <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-body">
                {company.critical_risk}
              </p>
            </div>
          )}
        </div>
      </article>
    </Link>
  );
}
