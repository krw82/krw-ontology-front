import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { filingEventTagLabel } from "@/lib/filing-notifications/classification";
import type { CompanyImportantFiling } from "@/lib/filing-notifications/company-important-filings";

type CompanyRecentImportantFilingsProps = {
  locale: Locale;
  ticker: string;
  items: CompanyImportantFiling[];
};

export default function CompanyRecentImportantFilings({
  locale,
  ticker,
  items,
}: CompanyRecentImportantFilingsProps) {
  const copy = locale === "ko"
    ? {
        eyebrow: "SEC CURRENT REPORTS",
        heading: "최근 8-K · 6-K 공시",
        description:
          "최근 90일간 제출된 수시공시입니다. 사건 유형과 SEC 원문을 바로 확인하세요.",
        empty: "최근 90일간 제출된 8-K 또는 6-K 공시가 없습니다.",
        amendment: "정정",
        view: "공시 보기",
        generic: "수시공시",
      }
    : {
        eyebrow: "SEC CURRENT REPORTS",
        heading: "Recent 8-K and 6-K filings",
        description:
          "Current reports filed in the last 90 days. Review the event type and the original SEC filing.",
        empty: "No 8-K or 6-K filing was retained in the last 90 days.",
        amendment: "Amendment",
        view: "View filing",
        generic: "Current report",
      };

  return (
    <section
      className="border-b border-hairline py-7"
      aria-labelledby="company-recent-important-filings-heading"
    >
      <div>
        <p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-primary">
          {copy.eyebrow}
        </p>
        <h2
          id="company-recent-important-filings-heading"
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
            const href = `/filings/${encodeURIComponent(item.filingEventId)}?${new URLSearchParams({
              source: "company",
              ticker,
            }).toString()}`;
            const eventLabel = eventLabelForLocale(
              item.primaryEventTag,
              locale,
              copy.generic,
            );
            const eventDetail = item.secItems.length
              ? `SEC Item ${item.secItems.join(", ")}`
              : eventLabel;

            return (
              <Link
                key={item.filingEventId}
                href={href}
                className="group flex min-h-20 items-center justify-between gap-4 px-sm py-3 transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="rounded-[5px] border border-primary/20 px-1.5 py-0.5 text-[11px] font-black leading-4 text-primary">
                      {item.formType}
                    </span>
                    {item.isAmendment ? (
                      <span className="rounded-full bg-surface-soft px-2 py-0.5 text-[10px] font-black leading-4 text-muted">
                        {copy.amendment}
                      </span>
                    ) : null}
                    <h3 className="text-[14px] font-black leading-6 text-ink">
                      {eventLabel}
                    </h3>
                  </div>
                  <p className="mt-1 truncate text-[12px] font-medium leading-5 text-muted">
                    {eventDetail}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1 text-[12px] font-extrabold text-primary">
                  <time dateTime={item.filingDate}>{formatDate(item.filingDate, locale)}</time>
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
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function eventLabelForLocale(
  tag: string | null,
  locale: Locale,
  fallback: string,
): string {
  if (locale === "ko") return filingEventTagLabel(tag) ?? fallback;

  const labels: Record<string, string> = {
    important_contract: "Material contract",
    contract_termination: "Contract termination",
    bankruptcy_or_receivership: "Bankruptcy or receivership",
    cybersecurity_incident: "Cybersecurity incident",
    acquisition_or_disposition: "Acquisition or disposition",
    earnings_or_financial_results: "Earnings or financial results",
    debt_or_obligation: "Debt or obligation",
    costs_associated_with_exit_or_disposal: "Exit or disposal costs",
    material_impairment: "Material impairment",
    listing_or_delisting: "Listing status",
    unregistered_securities_sale: "Securities sale",
    auditor_change: "Auditor change",
    financial_statement_nonreliance: "Financial statement non-reliance",
    change_in_control: "Change in control",
    leadership_or_board_change: "Leadership or board change",
    shareholder_vote: "Shareholder vote",
    other_material_event: "Other material event",
    foreign_issuer_report: "Foreign issuer report",
  };

  return (tag ? labels[tag] : null) ?? fallback;
}
