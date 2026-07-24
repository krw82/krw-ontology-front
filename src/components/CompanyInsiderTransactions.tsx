import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { CompanyInsiderTransaction } from "@/lib/filing-notifications/company-insider-transactions";

type CompanyInsiderTransactionsProps = {
  locale: Locale;
  ticker: string;
  items: CompanyInsiderTransaction[];
};

export default function CompanyInsiderTransactions({
  locale,
  ticker,
  items,
}: CompanyInsiderTransactionsProps) {
  const copy =
    locale === "ko"
      ? {
          eyebrow: "SEC FORM 4",
          heading: "최근 내부자 거래",
          description:
            "최근 90일 SEC Form 4 중 공개시장 매수·매도만 보여줍니다.",
          transactionDate: "거래일",
          filingDate: "신고일",
          amendment: "정정",
          reportedPurchase: "매수",
          reportedSale: "매도",
          reportedMarketTrade: "공개시장 P/S 거래",
          reportedTransaction: "거래 신고",
          noReportedValue: "공개시장 P/S 거래 금액 없음",
          planYes: "10b5-1 표시",
          planNo: "10b5-1 미표시",
          noOwner: "신고된 내부자 거래",
          otherOwners: (count: number) => `외 ${count}명`,
          allFilings: "SEC에서 전체 Form 4 보기",
          disclaimer:
            "금액은 SEC에 P/S로 신고된 공개시장 거래만 표시하며, 그 외 거래는 추정하지 않습니다.",
        }
      : {
          eyebrow: "SEC FORM 4",
          heading: "Recent insider transactions",
          description:
            "Open-market purchases and sales from retained SEC Form 4 records in the last 90 days.",
          transactionDate: "Trade date",
          filingDate: "Filed",
          amendment: "Amendment",
          reportedPurchase: "Purchase",
          reportedSale: "Sale",
          reportedMarketTrade: "Reported P/S transaction",
          reportedTransaction: "Reported transaction",
          noReportedValue: "No reported open-market P/S value",
          planYes: "10b5-1 indicated",
          planNo: "No 10b5-1 indicated",
          noOwner: "Reported insider transaction",
          otherOwners: (count: number) => `+${count} more`,
          allFilings: "View all Form 4 filings at SEC",
          disclaimer:
            "Values reflect only SEC-reported open-market P/S transactions. Other transactions are not estimated.",
        };

  if (items.length === 0) return null;

  const secBrowseHref = `https://www.sec.gov/edgar/browse/?${new URLSearchParams(
    { CIK: ticker, type: "4", owner: "include" },
  ).toString()}`;

  return (
    <section
      className="border-b border-hairline py-7"
      aria-labelledby="company-insider-transactions-heading"
    >
      <div>
        <p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-primary">
          {copy.eyebrow}
        </p>
        <h2
          id="company-insider-transactions-heading"
          className="mt-2 text-[20px] font-black leading-7 text-ink sm:text-[22px]"
        >
          {copy.heading}
        </h2>
        <p className="mt-1 text-[13px] font-medium leading-5 text-muted">
          {copy.description}
        </p>
      </div>

      <div className="mt-4 divide-y divide-hairline rounded-[8px] border border-hairline bg-canvas">
        {items.map((item) => {
            const owners = ownerDisplay(item, locale, copy);
            const roles = ownerRoles(item, locale);
            const trade = tradeDisplay(item, locale, copy);
            const meta = [
              `${item.formType}`,
              item.tenb5OneStatus === "yes" ? copy.planYes : null,
              item.tenb5OneStatus === "no" ? copy.planNo : null,
            ].filter((value): value is string => Boolean(value));
            const href = `/filings/${encodeURIComponent(item.filingEventId)}?${new URLSearchParams(
              {
                source: "company",
                ticker,
              },
            ).toString()}`;

            return (
              <Link
                key={item.filingEventId}
                href={href}
                className="group block px-sm py-3 transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="truncate text-[14px] font-black leading-6 text-ink">
                        {owners}
                      </h3>
                      {item.isAmendment ? (
                        <span className="rounded-full bg-surface-soft px-2 py-0.5 text-[10px] font-black leading-4 text-muted">
                          {copy.amendment}
                        </span>
                      ) : null}
                    </div>
                    {roles ? (
                      <p className="mt-0.5 truncate text-[12px] font-semibold leading-5 text-muted">
                        {roles}
                      </p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-[11px] font-bold leading-5 text-muted">
                      {copy.transactionDate} {formatDate(item.transactionDate ?? item.filingDate, locale)}
                    </p>
                    {item.transactionDate ? (
                      <p className="font-mono text-[10px] font-bold leading-4 text-muted">
                        {copy.filingDate} {formatDate(item.filingDate, locale)}
                      </p>
                    ) : null}
                    <span
                      className={`mt-1 inline-block text-[12px] font-black leading-5 ${trade.tone}`}
                    >
                      {trade.label}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex min-w-0 items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-[12px] font-semibold leading-5 text-body">
                    {trade.detail}
                  </p>
                  <span
                    className="shrink-0 text-[18px] leading-5 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                    aria-hidden="true"
                  >
                    →
                  </span>
                </div>
                {meta.length > 0 ? (
                  <p className="mt-1 text-[11px] font-semibold leading-5 text-muted">
                    {meta.join(" · ")}
                  </p>
                ) : null}
              </Link>
            );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-medium leading-5 text-muted">
          {copy.disclaimer}
        </p>
        <a
          href={secBrowseHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center text-[12px] font-black text-primary underline underline-offset-4"
        >
          {copy.allFilings} <span aria-hidden="true">↗</span>
        </a>
      </div>
    </section>
  );
}

function ownerDisplay(
  item: CompanyInsiderTransaction,
  locale: Locale,
  copy: { noOwner: string; otherOwners: (count: number) => string },
): string {
  const names = item.owners
    .map((owner) => owner.name.trim())
    .filter((name) => Boolean(name));
  if (names.length === 0) return copy.noOwner;
  const visible = names.slice(0, 2).join(locale === "ko" ? " · " : ", ");
  return names.length > 2
    ? `${visible} ${copy.otherOwners(names.length - 2)}`
    : visible;
}

function ownerRoles(
  item: CompanyInsiderTransaction,
  locale: Locale,
): string | null {
  const roles = item.owners.slice(0, 2).flatMap((owner) => {
    const ownerRoles: string[] = [];
    if (owner.isOfficer) {
      ownerRoles.push(
        owner.officerTitle?.trim() || (locale === "ko" ? "임원" : "Officer"),
      );
    }
    if (owner.isDirector)
      ownerRoles.push(locale === "ko" ? "이사" : "Director");
    if (owner.isTenPercentOwner) {
      ownerRoles.push(locale === "ko" ? "10% 보유자" : "10% owner");
    }
    if (owner.isOther)
      ownerRoles.push(locale === "ko" ? "기타 관계자" : "Other relationship");
    return ownerRoles;
  });
  const uniqueRoles = [...new Set(roles)];
  return uniqueRoles.length ? uniqueRoles.join(" · ") : null;
}

function tradeDisplay(
  item: CompanyInsiderTransaction,
  locale: Locale,
  copy: {
    reportedPurchase: string;
    reportedSale: string;
    reportedMarketTrade: string;
    reportedTransaction: string;
    noReportedValue: string;
  },
): { label: string; detail: string; tone: string } {
  const purchase = item.reportedPurchaseValue ?? 0;
  const sale = item.reportedSaleValue ?? 0;
  if (purchase > 0 && sale > 0) {
    return {
      label: `${copy.reportedPurchase} · ${copy.reportedSale}`,
      detail: `${copy.reportedPurchase} ${formatUsd(purchase, locale)} · ${copy.reportedSale} ${formatUsd(sale, locale)}`,
      tone: "text-[#8a5a00]",
    };
  }
  if (purchase > 0) {
    return {
      label: copy.reportedPurchase,
      detail: `${copy.reportedPurchase} ${formatUsd(purchase, locale)}`,
      tone: "text-[#137357]",
    };
  }
  if (sale > 0) {
    return {
      label: copy.reportedSale,
      detail: `${copy.reportedSale} ${formatUsd(sale, locale)}`,
      tone: "text-[#b83b25]",
    };
  }
  return {
    label: item.hasReportedOpenMarketTrade
      ? copy.reportedMarketTrade
      : copy.reportedTransaction,
    detail: copy.noReportedValue,
    tone: "text-muted",
  };
}

function formatDate(value: string, locale: Locale): string {
  const date = new Date(`${value}T00:00:00Z`);
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
    return `$${(absoluteValue / 1_000_000_000).toLocaleString(numberLocale, {
      maximumFractionDigits: 1,
    })}B`;
  }
  if (absoluteValue >= 1_000_000) {
    return `$${(absoluteValue / 1_000_000).toLocaleString(numberLocale, {
      maximumFractionDigits: 1,
    })}M`;
  }
  return `$${absoluteValue.toLocaleString(numberLocale, {
    maximumFractionDigits: 0,
  })}`;
}
