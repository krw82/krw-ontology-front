"use client";

import Link from "next/link";
import { trackClientEventSilently } from "@/lib/analytics/client";
import type { PulseFeedSummary } from "@/types/api-contracts";

interface PulseSummaryBarProps {
  summary: PulseFeedSummary;
}

export default function PulseSummaryBar({ summary }: PulseSummaryBarProps) {
  const parts = [
    summary.counts.filing ? `새 공시 ${summary.counts.filing}` : null,
    summary.counts.analysis ? `결과 ${summary.counts.analysis}` : null,
    summary.counts.question ? `이어볼 질문 ${summary.counts.question}` : null,
    summary.counts.resurface ? `다시 볼 리서치 ${summary.counts.resurface}` : null,
    summary.active_analysis_count ? `분석 진행 ${summary.active_analysis_count}` : null,
  ].filter((value): value is string => Boolean(value));

  if (parts.length === 0) return null;

  return (
    <section className="mb-lg rounded-[16px] border border-hairline bg-white px-base py-base shadow-[0_8px_24px_rgba(16,24,40,0.04)] sm:px-lg" aria-label="현재 피드 요약">
      <div className="flex flex-wrap items-center justify-between gap-base">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.15em] text-primary">지금 확인할 항목</p>
          <p className="mt-1 text-[14px] font-extrabold text-ink">{parts.join(" · ")}</p>
        </div>
        {summary.primary_action ? (
          <Link
            href={summary.primary_action.href}
            className="inline-flex min-h-10 items-center gap-xs rounded-[10px] bg-ink px-base text-[13px] font-extrabold text-white hover:bg-primary"
            onClick={() => trackClientEventSilently("pulse_summary_actioned", { action: summary.primary_action?.analytics_name ?? "primary" })}
          >
            {summary.primary_action.label}
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">arrow_forward</span>
          </Link>
        ) : null}
      </div>
    </section>
  );
}
