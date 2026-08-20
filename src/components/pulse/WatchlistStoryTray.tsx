"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { trackClientEventSilently } from "@/lib/analytics/client";
import { easeOutExpo } from "@/lib/animation";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import CompanyLogo from "@/components/CompanyLogo";

interface TrayItem {
  ticker: string;
  company_name: string | null;
  is_watchlist: boolean;
  new_count: number;
  latest_issue_id: string | null;
}

interface TrayPayload {
  items?: TrayItem[] | null;
  overflow_count?: number;
}

/** Companies with a live sweep ring; beyond this the ring stays static. */
const MAX_SWEEP_ITEMS = 3;

function itemHref(item: TrayItem): string {
  if (item.latest_issue_id) {
    return `/news/${item.latest_issue_id}`;
  }
  return `/companies/${encodeURIComponent(item.ticker)}`;
}

/**
 * "관심 기업" story tray at the top of the Pulse feed: watchlist companies
 * plus recently-viewed ones, each a circular mark with a slow radar-sweep
 * ring when news published since the last engagement is waiting. Hidden
 * entirely when the resume API returns nothing.
 */
export default function WatchlistStoryTray() {
  const [payload, setPayload] = useState<TrayPayload | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    let stale = false;

    async function loadTray() {
      const response = await fetch("/api/pulse/resume", {
        cache: "no-store",
      }).catch(() => null);
      if (!response?.ok || stale) return;
      const data = (await response.json().catch(() => null)) as TrayPayload | null;
      if (stale) return;
      const items = data?.items ?? [];
      if (items.length > 0) {
        trackClientEventSilently("pulse_resume_viewed", {
          surface: "pulse",
          resume_count: items.length,
        });
      }
      setPayload({ items, overflow_count: data?.overflow_count ?? 0 });
    }

    void loadTray();
    return () => {
      stale = true;
    };
  }, []);

  const items = payload?.items ?? [];
  const overflowCount = payload?.overflow_count ?? 0;
  if (!payload || items.length === 0) return null;

  const totalNew = items.reduce((sum, item) => sum + item.new_count, 0);
  const sweepTickers = new Set(
    items
      .filter((item) => item.new_count > 0)
      .slice(0, MAX_SWEEP_ITEMS)
      .map((item) => item.ticker),
  );

  return (
    <motion.section
      aria-label="관심 기업"
      className="mb-base border-b border-hairline pb-base"
      initial={reducedMotion ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.24, ease: easeOutExpo }}
    >
      <div className="mb-xs flex items-baseline justify-between px-xs">
        <p className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-primary">
          관심 기업
        </p>
        {totalNew > 0 ? (
          <p className="text-[11px] font-semibold text-muted">새 소식 {totalNew}</p>
        ) : null}
      </div>
      <ul
        className="pulse-story-scroll -mx-xs flex list-none gap-sm overflow-x-auto px-xs pb-1"
        role="list"
      >
        {items.map((item, index) => {
          const hasNew = item.new_count > 0;
          const sweep = hasNew && !reducedMotion && sweepTickers.has(item.ticker);
          const href = itemHref(item);
          const label = item.company_name ?? item.ticker;
          return (
            <motion.li
              key={item.ticker}
              className="shrink-0 snap-start"
              initial={reducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: reducedMotion ? 0 : 0.22,
                delay: reducedMotion ? 0 : Math.min(index * 0.03, 0.15),
                ease: easeOutExpo,
              }}
            >
              <Link
                href={href}
                aria-label={
                  hasNew
                    ? `${label}, 새 소식 ${item.new_count}건, 최신 뉴스 열기`
                    : `${label}, 회사 페이지 열기`
                }
                className="group flex w-16 flex-col items-center gap-1 rounded-[8px] px-xs py-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-[72px]"
                onClick={() =>
                  trackClientEventSilently("cta_clicked", {
                    cta_id: "pulse_resume_banner",
                    surface: "pulse",
                    ticker: item.ticker,
                    destination: href,
                  })
                }
              >
                <span className="relative grid h-14 w-14 place-items-center transition-transform duration-150 group-hover:scale-[1.04] group-active:scale-95 sm:h-16 sm:w-16">
                  <span
                    aria-hidden="true"
                    className={`absolute inset-0 rounded-full ${
                      hasNew
                        ? "pulse-story-breathe bg-primary-fixed"
                        : "bg-surface-container-low"
                    }`}
                  />
                  {sweep ? (
                    <span
                      aria-hidden="true"
                      className="pulse-story-sweep absolute inset-0 rounded-full border-2 border-transparent border-t-primary-container"
                    />
                  ) : null}
                  <CompanyLogo
                    ticker={item.ticker}
                    companyName={label}
                    className="h-10 w-10 text-[10px] sm:h-12 sm:w-12"
                  />
                  {hasNew ? (
                    <span className="pulse-story-badge absolute -top-0.5 right-0 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-background bg-primary px-1 font-mono text-[10px] font-black leading-none text-on-primary">
                      {item.new_count}
                    </span>
                  ) : null}
                </span>
                <span
                  className={`max-w-full truncate text-[11px] font-bold leading-4 ${
                    hasNew ? "text-body-strong" : "text-muted"
                  }`}
                  title={label}
                >
                  {label}
                </span>
              </Link>
            </motion.li>
          );
        })}
        {overflowCount > 0 ? (
          <li className="shrink-0 snap-start">
            <Link
              href="/watchlist"
              aria-label={`관심 기업 ${overflowCount}개 더 보기`}
              className="flex w-16 flex-col items-center gap-1 rounded-[8px] px-xs py-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-[72px]"
              onClick={() =>
                trackClientEventSilently("cta_clicked", {
                  cta_id: "pulse_resume_banner",
                  surface: "pulse",
                  destination: "/watchlist",
                })
              }
            >
              <span className="grid h-14 w-14 place-items-center rounded-full bg-surface-container-low text-[12px] font-black text-muted sm:h-16 sm:w-16">
                +{overflowCount}
              </span>
              <span className="text-[11px] font-bold leading-4 text-muted">전체</span>
            </Link>
          </li>
        ) : null}
      </ul>
    </motion.section>
  );
}
