import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { CompanyMarketNews } from "@/lib/market-issues/company-news";

type CompanyRecentMarketNewsProps = {
  locale: Locale;
  ticker: string;
  items: CompanyMarketNews[];
};

export default function CompanyRecentMarketNews({
  locale,
  ticker,
  items,
}: CompanyRecentMarketNewsProps) {
  const copy = locale === "ko"
    ? {
        eyebrow: "MARKET NEWS",
        heading: "연결된 시장 뉴스",
        description: "이 기업과 연결된 최근 시장 이슈입니다. 요약과 검토할 영향 경로를 확인하세요.",
        empty: "이 기업과 연결된 최근 시장 뉴스가 없습니다.",
        view: "뉴스 보기",
        impact: "영향 경로",
      }
    : {
        eyebrow: "MARKET NEWS",
        heading: "Linked market news",
        description: "Recent market issues linked to this company, with the summary and impact path to review.",
        empty: "There is no recent market news linked to this company.",
        view: "View news",
        impact: "Impact path",
      };

  return (
    <section
      className="border-b border-hairline py-7"
      aria-labelledby="company-recent-market-news-heading"
    >
      <div>
        <p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-primary">
          {copy.eyebrow}
        </p>
        <h2
          id="company-recent-market-news-heading"
          className="mt-2 text-[20px] font-black leading-7 text-ink sm:text-[22px]"
        >
          {copy.heading}
        </h2>
        <p className="mt-1 text-[13px] font-medium leading-5 text-muted">
          {copy.description}
        </p>
      </div>

      {items.length ? (
        <div className="mt-4 divide-y divide-hairline rounded-[8px] border border-hairline bg-canvas">
          {items.map((item) => {
            const href = `/news/${encodeURIComponent(item.id)}?${new URLSearchParams({
              source: "company",
              ticker,
            }).toString()}`;
            const publishedAt = item.publishedAt ?? item.updatedAt;

            return (
              <Link
                key={item.id}
                href={href}
                className="group flex min-h-24 items-center justify-between gap-4 px-sm py-3 transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <div className="min-w-0">
                  <h3 className="text-[14px] font-black leading-6 text-ink">
                    {item.title}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-5 text-muted">
                    {item.summary}
                  </p>
                  {item.impactPath[0] ? (
                    <p className="mt-2 truncate text-[11px] font-bold leading-4 text-primary">
                      {copy.impact} · {item.impactPath[0]}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1 text-[12px] font-extrabold text-primary">
                  {publishedAt ? <time dateTime={publishedAt}>{formatDate(publishedAt, locale)}</time> : null}
                  <span className="hidden sm:inline">{copy.view}</span>
                  <span aria-hidden="true" className="material-symbols-outlined text-[17px]">
                    arrow_forward
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 rounded-[8px] border border-dashed border-hairline px-sm py-3 text-[13px] font-medium leading-5 text-muted">
          {copy.empty}
        </p>
      )}
    </section>
  );
}

function formatDate(value: string, locale: Locale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}
