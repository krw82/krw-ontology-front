"use client";

import Link from "next/link";
import BottomSheet from "@/components/ui/BottomSheet";
import CompanyLogo from "@/components/CompanyLogo";
import { formatIssueRelativeTime } from "@/components/news/news-model";
import { trackClientEventSilently } from "@/lib/analytics/client";

interface SheetNewsItem {
  issue_id: string;
  title_ko: string | null;
  published_at: string;
}

export interface WatchlistNewsSheetItem {
  ticker: string;
  company_name: string | null;
  new_count: number;
  new_items: SheetNewsItem[];
}

/**
 * "새 소식" 목록 시트: 관심 기업 동그라미를 눌렀을 때 안 읽은 기사를
 * 최신순으로 전부 보여준다. 기사를 하나 열어도 나머지는 읽을 때까지
 * 남아 있어야 해서(집계가 기사 단위) 착지를 최신 한 건 점프가 아니라
 * 이 목록으로 뒀다.
 */
export default function WatchlistNewsSheet({
  item,
  open,
  onClose,
}: {
  item: WatchlistNewsSheetItem;
  open: boolean;
  onClose: () => void;
}) {
  const label = item.company_name ?? item.ticker;
  const companyHref = `/companies/${encodeURIComponent(item.ticker)}`;
  const overflowCount = Math.max(0, item.new_count - item.new_items.length);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabel={`${label} 새 소식 ${item.new_count}건 목록`}
      presentation="responsive-dialog"
      panelClassName="sm:max-w-[480px]"
      contentClassName="px-base pb-base pt-sm sm:p-lg"
      testId="watchlist-news-sheet"
    >
      <section aria-label={`${label} 새 소식`}>
        <header className="flex items-center gap-sm">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary-fixed">
            <CompanyLogo
              ticker={item.ticker}
              companyName={label}
              className="h-8 w-8 text-[10px]"
            />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-black leading-5 text-ink" title={label}>
              {label}
            </h2>
            <p className="mt-0.5 flex items-baseline gap-1">
              <span className="font-mono text-[22px] font-black leading-none text-primary">
                {item.new_count}
              </span>
              <span className="text-[12px] font-bold text-muted">새 소식</span>
            </p>
          </div>
        </header>

        <ul role="list" className="mt-sm divide-y divide-hairline">
          {item.new_items.map((news) => (
            <li key={news.issue_id}>
              <Link
                href={`/news/${encodeURIComponent(news.issue_id)}`}
                onClick={() => {
                  trackClientEventSilently("cta_clicked", {
                    cta_id: "pulse_resume_banner",
                    surface: "pulse",
                    ticker: item.ticker,
                    destination: `/news/${news.issue_id}`,
                  });
                  onClose();
                }}
                className="group flex items-start justify-between gap-sm rounded-[8px] py-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[14px] font-bold leading-5 text-ink [text-wrap:pretty]">
                    {news.title_ko ?? "제목 없는 뉴스"}
                  </span>
                  <time className="sr-only">{formatIssueRelativeTime(news.published_at)}</time>
                </span>
                <span
                  className="material-symbols-outlined shrink-0 text-[18px] text-muted transition-transform duration-150 group-hover:translate-x-0.5"
                  aria-hidden="true"
                >
                  arrow_forward
                </span>
              </Link>
            </li>
          ))}
          <li>
            <Link
              href={companyHref}
              onClick={() => {
                trackClientEventSilently("cta_clicked", {
                  cta_id: "pulse_resume_banner",
                  surface: "pulse",
                  ticker: item.ticker,
                  destination: companyHref,
                });
                onClose();
              }}
              className="flex items-center justify-between rounded-[8px] py-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="text-[13px] font-bold text-muted">
                {overflowCount > 0
                  ? `+${overflowCount}개 더 보기`
                  : "회사 페이지 보기"}
              </span>
              <span
                className="material-symbols-outlined shrink-0 text-[18px] text-muted"
                aria-hidden="true"
              >
                arrow_forward
              </span>
            </Link>
          </li>
        </ul>
      </section>
    </BottomSheet>
  );
}
