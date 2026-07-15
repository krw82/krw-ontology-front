import Link from "next/link";
import { localizedPath } from "@/i18n/routing";
import type { Locale } from "@/i18n/config";
import type {
  InstitutionalTickerActivity as InstitutionalTickerActivityItem,
  PositionChangeType,
} from "@/lib/sec-13f/types";

type InstitutionalTickerActivityProps = {
  locale: Locale;
  items: InstitutionalTickerActivityItem[];
};

const changeCopy: Record<
  Locale,
  Record<PositionChangeType, string>
> = {
  ko: {
    new: "신규 편입",
    increased: "비중 확대",
    decreased: "비중 축소",
    unchanged: "유지",
    sold: "보유 종료",
  },
  en: {
    new: "New position",
    increased: "Increased",
    decreased: "Reduced",
    unchanged: "Unchanged",
    sold: "Closed position",
  },
};

export default function InstitutionalTickerActivity({
  locale,
  items,
}: InstitutionalTickerActivityProps) {
  if (items.length === 0) return null;

  const copy = locale === "ko"
    ? {
        eyebrow: "SEC 13F",
        heading: "13F 기관 동향",
        description: "기관의 최근 분기 보유 변동",
        reportPeriod: "보고 기준일",
        viewAll: "전체 13F 보기",
        disclaimer:
          "13F 보고 운용사 기준이며 분기 말 이후 공개되어 현재 보유와 다를 수 있습니다.",
        holding: "보유",
        previousHolding: "직전 보유",
      }
    : {
        eyebrow: "SEC 13F",
        heading: "13F institutional activity",
        description: "Recent quarter-end position changes",
        reportPeriod: "Report period",
        viewAll: "View all 13F",
        disclaimer:
          "Based on reported 13F managers. Filings are delayed and may not reflect current holdings.",
        holding: "Holding",
        previousHolding: "Previous holding",
      };

  return (
    <section className="border-b border-hairline py-7" aria-labelledby="institutional-activity-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-primary">
            {copy.eyebrow}
          </p>
          <h2
            id="institutional-activity-heading"
            className="mt-2 text-[20px] font-black leading-7 text-ink sm:text-[22px]"
          >
            {copy.heading}
          </h2>
          <p className="mt-1 text-[13px] font-medium leading-5 text-muted">
            {copy.description}
          </p>
        </div>
        <Link
          href={localizedPath(locale, "/13f")}
          className="shrink-0 text-[13px] font-extrabold leading-5 text-primary hover:text-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          {copy.viewAll} →
        </Link>
      </div>

      <div className="mt-4 divide-y divide-hairline rounded-[8px] border border-hairline bg-canvas">
        {items.map((item, index) => (
          <article
            key={`${item.cik}-${item.reportPeriod}`}
            className={`px-sm py-3 ${index >= 3 ? "hidden md:block" : ""}`}
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-[14px] font-black leading-6 text-ink">
                  {item.managerDisplayName ?? item.managerName}
                </h3>
                <p className="mt-1 text-[12px] font-medium leading-5 text-muted">
                  {item.changeType === "sold" ? copy.previousHolding : copy.holding}{" "}
                  {formatUsd(
                    item.changeType === "sold"
                      ? (item.previousValueUsd ?? item.valueUsd)
                      : item.valueUsd,
                    locale,
                  )}
                  {item.shares === null ? null : ` · ${formatShares(item.shares, locale)}`}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <span className={changeClassName(item.changeType)}>
                  {changeCopy[locale][item.changeType]}
                </span>
                <p className="mt-1 font-mono text-[11px] font-bold leading-5 text-muted">
                  {copy.reportPeriod} {formatDate(item.reportPeriod, locale)}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>

      <p className="mt-3 text-[12px] font-medium leading-5 text-muted">
        {copy.disclaimer}
      </p>
    </section>
  );
}

function changeClassName(changeType: PositionChangeType): string {
  if (changeType === "new" || changeType === "increased") {
    return "inline-flex rounded-full bg-primary-fixed px-2 py-0.5 text-[11px] font-black leading-4 text-primary";
  }
  if (changeType === "sold" || changeType === "decreased") {
    return "inline-flex rounded-full bg-surface-soft px-2 py-0.5 text-[11px] font-black leading-4 text-body";
  }
  return "inline-flex rounded-full bg-surface-soft px-2 py-0.5 text-[11px] font-black leading-4 text-muted";
}

function formatDate(value: string, locale: Locale): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function formatUsd(value: number, locale: Locale): string {
  const absoluteValue = Math.abs(value);
  const numberLocale = locale === "ko" ? "ko-KR" : "en-US";
  if (absoluteValue >= 1_000_000_000) {
    return `$${(absoluteValue / 1_000_000_000).toLocaleString(numberLocale, { maximumFractionDigits: 1 })}B`;
  }
  if (absoluteValue >= 1_000_000) {
    return `$${(absoluteValue / 1_000_000).toLocaleString(numberLocale, { maximumFractionDigits: 1 })}M`;
  }
  return `$${absoluteValue.toLocaleString(numberLocale, { maximumFractionDigits: 0 })}`;
}

function formatShares(value: number, locale: Locale): string {
  return `${value.toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
    maximumFractionDigits: 0,
  })} ${locale === "ko" ? "주" : "shares"}`;
}
