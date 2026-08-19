"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { trackClientEventSilently } from "@/lib/analytics/client";

interface PulseResumeItem {
  ticker: string;
  company_name: string | null;
  new_count: number;
  latest_issue_id: string | null;
}

/**
 * "Resume where you left off" banner for returning visitors: companies from
 * the user's most recently opened news issues, plus what's new since then.
 * Hidden entirely when there is nothing new (data from /api/pulse/resume).
 */
export default function PulseResumeBanner() {
  const [items, setItems] = useState<PulseResumeItem[] | null>(null);

  useEffect(() => {
    let stale = false;

    async function loadResume() {
      const response = await fetch("/api/pulse/resume", {
        cache: "no-store",
      }).catch(() => null);
      if (!response?.ok || stale) return;
      const payload = (await response.json().catch(() => null)) as {
        items?: PulseResumeItem[] | null;
      } | null;
      const resumeItems = (payload?.items ?? []).slice(0, 2);
      if (stale) return;
      if (resumeItems.length > 0) {
        trackClientEventSilently("pulse_resume_viewed", {
          surface: "pulse",
          resume_count: resumeItems.length,
        });
      }
      setItems(resumeItems);
    }

    void loadResume();
    return () => {
      stale = true;
    };
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <section
      aria-label="이어서 볼 소식"
      className="mb-base rounded-[12px] border border-hairline bg-surface-soft px-base py-sm"
    >
      <p className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-primary">
        이어보기
      </p>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item.ticker}>
            <Link
              href={`/news/${item.latest_issue_id}`}
              className="flex min-h-11 items-center justify-between gap-sm rounded-[8px] px-xs text-left transition-colors hover:bg-surface"
              onClick={() =>
                trackClientEventSilently("cta_clicked", {
                  cta_id: "pulse_resume_banner",
                  surface: "pulse",
                  ticker: item.ticker,
                  destination: `/news/${item.latest_issue_id}`,
                })
              }
            >
              <span className="min-w-0 text-[13px] font-black leading-5 text-ink">
                지난번에 본 {item.company_name ?? item.ticker}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-[12px] font-bold text-primary">
                새 소식 {item.new_count}건
                <span
                  aria-hidden="true"
                  className="material-symbols-outlined text-[16px]"
                >
                  arrow_forward
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
