"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import CompanyLogo from "@/components/CompanyLogo";
import type { InstitutionalHoldingsDashboard } from "@/lib/sec-13f/types";

interface InstitutionalHoldingsClientProps {
  managers: InstitutionalHoldingsDashboard["managers"];
  initialDashboard: InstitutionalHoldingsDashboard | null;
  initialLoadError?: string | null;
}

type HoldingView = InstitutionalHoldingsDashboard["holdings"][number];

export default function InstitutionalHoldingsClient({
  managers,
  initialDashboard,
  initialLoadError = null,
}: InstitutionalHoldingsClientProps) {
  const dashboard = initialDashboard;
  const loadError = initialLoadError;
  const [query, setQuery] = useState("");

  const filteredHoldings = useMemo(() => {
    if (!dashboard) return [];
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return dashboard.holdings;
    return dashboard.holdings.filter((holding) =>
      [
        holding.displayName,
        holding.issuerName,
        holding.titleOfClass,
        holding.cusip,
        holding.ticker,
        holding.changeType,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [dashboard, query]);
  const heading = dashboard
    ? dashboard.manager.displayName ?? dashboard.manager.name
    : "기관 목록";

  return (
    <main
      id="main-content"
      className="px-base pb-xl pt-lg sm:px-md md:px-xl md:pb-[96px] md:pt-xl"
    >
      <div className="mx-auto w-full max-w-[1240px]">
        <header className="border-b border-hairline pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-primary">
                SEC 13F
              </p>
              <h1 className="mt-2 text-balance text-[30px] font-black leading-[1.08] tracking-normal text-ink sm:text-[40px]">
                {heading}
              </h1>
              <p className="mt-3 max-w-3xl text-[15px] leading-6 text-body sm:text-[16px]">
                {dashboard
                  ? `보유 시가 기준 상위 ${dashboard.displayLimit}개 공시 종목과 분기 리밸런싱을 확인합니다.`
                  : "유명 투자자와 운용사의 최신 13F 보유 공시를 모아봅니다."}
              </p>
            </div>
          </div>
        </header>

        {loadError ? (
          <div className="mt-4 border border-error-container bg-error-container/40 px-sm py-xs text-[13px] font-bold leading-5 text-error">
            {loadError}
          </div>
        ) : null}

        {dashboard ? (
          <>
            <SummaryDisclosure dashboard={dashboard} />

            {dashboard.rebalancing.buys.length > 0 ||
            dashboard.rebalancing.sells.length > 0 ? (
              <RebalancingSection dashboard={dashboard} />
            ) : null}

            <section className="mt-5">
              <div className="mb-3 grid gap-3 border-b border-hairline pb-3 md:grid-cols-[minmax(0,1fr)_320px] md:items-end">
                <div>
                  <h2 className="text-[19px] font-black leading-7 text-ink">
                    주요 보유 현황
                  </h2>
                  <p className="mt-1 text-[13px] font-bold leading-5 text-muted">
                    보유 시가 기준 상위 {dashboard.displayLimit}개이며 현재 보유와
                    다를 수 있습니다.
                  </p>
                </div>
                <div className="relative min-w-0">
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-muted"
                  >
                    search
                  </span>
                  <input
                    aria-label="13F 보유 종목 검색"
                    className="h-11 w-full rounded-[8px] border border-hairline bg-canvas pl-10 pr-sm text-[14px] font-semibold leading-5 text-ink shadow-sm placeholder:text-muted focus:border-outline focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/25"
                    placeholder="회사명, 티커, CUSIP, 변화 검색"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
              </div>

              {dashboard.filing ? (
                <HoldingsTable holdings={filteredHoldings} />
              ) : (
                <EmptyHoldings />
              )}
            </section>
          </>
        ) : (
          <ManagerGrid managers={managers} />
        )}
      </div>
    </main>
  );
}

function ManagerGrid({
  managers,
}: {
  managers: InstitutionalHoldingsDashboard["managers"];
}) {
  return (
    <section className="mt-5">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="text-[19px] font-black leading-7 text-ink">기관 선택</h2>
        <p className="font-mono text-[11px] font-bold leading-4 text-muted">
          {managers.length.toLocaleString()} FILERS
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {managers.map((manager) => (
          <ManagerCard key={manager.cik} manager={manager} />
        ))}
      </div>
    </section>
  );
}

function ManagerCard({
  manager,
}: {
  manager: InstitutionalHoldingsDashboard["managers"][number];
}) {
  const { primary, secondary } = splitManagerName(manager.displayName ?? manager.name);
  const description = managerDescription(manager);

  return (
    <Link
      href={`/institutional-holdings?cik=${encodeURIComponent(manager.cik)}`}
      className="group flex aspect-square min-w-0 flex-col rounded-[8px] border border-hairline bg-canvas p-3 text-left text-ink transition-[background-color,border-color,color,transform] hover:border-outline hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-fixed-dim/35 sm:p-4"
    >
      <span className="font-mono text-[10px] font-black uppercase leading-4 tracking-[0.12em] text-primary">
        {manager.countryCode || "13F"} · 13F
      </span>
      <span className="mt-3 block min-w-0 text-[15px] font-black leading-5 text-ink sm:text-[16px]">
        {primary}
      </span>
      <span className="mt-1 line-clamp-2 min-w-0 text-[11px] font-bold leading-4 text-muted sm:text-[12px]">
        {secondary}
      </span>
      <span className="mt-2 line-clamp-3 min-w-0 text-[11px] font-semibold leading-4 text-body">
        {description}
      </span>
      <span className="mt-auto flex items-center justify-between pt-3 text-[11px] font-black leading-4 text-muted">
        <span>상세 보기</span>
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[18px] transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
        >
          arrow_forward
        </span>
      </span>
    </Link>
  );
}

function SummaryDisclosure({
  dashboard,
}: {
  dashboard: InstitutionalHoldingsDashboard;
}) {
  return (
    <details className="group mt-5 rounded-[8px] border border-hairline bg-canvas">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-fixed-dim/35">
        <span className="min-w-0">
          <span className="block text-[15px] font-black leading-5 text-ink">
            공시 요약
          </span>
          <span className="mt-1 block text-[12px] font-bold leading-4 text-muted">
            {dashboard.filing
              ? `${formatDate(dashboard.filing.reportPeriod)} · ${formatUsd(
                  dashboard.stats.totalValueUsd,
                )}`
              : "스냅샷 없음"}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[18px] text-muted transition-transform group-open:rotate-180"
        >
          expand_more
        </span>
      </summary>
      <div className="border-t border-hairline p-3">
        <section className="grid gap-3 md:grid-cols-4">
          <MetricTile
            label="보고 기준일"
            value={dashboard.filing ? formatDate(dashboard.filing.reportPeriod) : "-"}
            detail={dashboard.filing ? `${dashboard.filing.form}` : "스냅샷 없음"}
          />
          <MetricTile
            label={`상위 ${dashboard.displayLimit} 보유 시가`}
            value={formatUsd(dashboard.stats.totalValueUsd)}
            detail={`${dashboard.stats.totalPositions.toLocaleString()}개 표시`}
          />
          <MetricTile
            label="Top 10 비중"
            value={formatPercent(dashboard.stats.top10Weight)}
            detail="현재 filing 기준"
          />
          <MetricTile
            label="직전 비교"
            value={
              dashboard.previousFiling
                ? formatDate(dashboard.previousFiling.reportPeriod)
                : "-"
            }
            detail={dashboard.previousFiling ? "직전 filing" : "비교 데이터 없음"}
          />
        </section>

        <section className="mt-3 grid gap-3 md:grid-cols-5">
          <ChangeTile label="신규" value={dashboard.stats.newPositions} />
          <ChangeTile label="증가" value={dashboard.stats.increasedPositions} />
          <ChangeTile label="감소" value={dashboard.stats.decreasedPositions} />
          <ChangeTile label="유지" value={dashboard.stats.unchangedPositions} />
          <ChangeTile label="보유 종료" value={dashboard.stats.soldPositions} />
        </section>
      </div>
    </details>
  );
}

function MetricTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[8px] border border-hairline bg-canvas p-4 shadow-sm">
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
        {label}
      </p>
      <p className="mt-2 text-[22px] font-black leading-7 text-ink">{value}</p>
      <p className="mt-1 text-[12px] font-bold leading-5 text-muted">{detail}</p>
    </div>
  );
}

function ChangeTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[8px] border border-hairline bg-surface-soft px-4 py-3">
      <p className="text-[13px] font-bold leading-5 text-muted">{label}</p>
      <p className="mt-1 font-mono text-[20px] font-black leading-7 text-ink">
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function HoldingsTable({
  holdings,
}: {
  holdings: InstitutionalHoldingsDashboard["holdings"];
}) {
  if (holdings.length === 0) {
    return (
      <div className="rounded-[8px] border border-hairline bg-surface-soft p-lg text-center text-[14px] font-bold leading-6 text-muted">
        조건에 맞는 보유 종목이 없습니다.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[8px] border border-hairline bg-canvas">
      <div className="hidden grid-cols-[minmax(300px,1.35fr)_112px_165px_150px_28px] border-b border-hairline bg-surface px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted xl:grid">
        <span>종목</span>
        <span className="text-right">weight</span>
        <span className="text-right">shares</span>
        <span className="text-right">value</span>
        <span aria-hidden="true" />
      </div>
      <div className="divide-y divide-hairline">
        {holdings.slice(0, 500).map((holding) => (
          <HoldingTableRow key={holding.id} holding={holding} />
        ))}
      </div>
    </div>
  );
}

function HoldingTableRow({ holding }: { holding: HoldingView }) {
  const displayName = holdingDisplayName(holding);
  const rowClassName = [
    "group grid gap-3 px-4 py-4 transition-colors xl:grid-cols-[minmax(300px,1.35fr)_112px_165px_150px_28px] xl:items-center",
    holding.chatHref
      ? "cursor-pointer hover:bg-surface-soft focus-visible:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-fixed-dim/35"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        <HoldingIdentity holding={holding} />
        <HoldingArrow
          visible={Boolean(holding.chatHref)}
          className="ml-auto xl:hidden"
        />
      </div>
      <div className="grid min-w-0 grid-cols-3 divide-x divide-hairline xl:contents xl:divide-x-0">
        <HoldingMetric
          label="비중"
          value={formatWeightPercent(holding.portfolioWeight)}
          detail={
            holding.portfolioWeightChange === null
              ? "-"
              : formatSignedPercentagePoints(holding.portfolioWeightChange)
          }
          tone={changeToneClass(holding.portfolioWeightChange)}
        />
        <HoldingMetric
          label="수량"
          value={formatShares(holding.shares)}
          detail={
            holding.sharesChange === null
              ? "-"
              : `${formatSignedNumber(holding.sharesChange)}${
                  holding.sharesChangePct === null
                    ? ""
                    : ` (${formatSignedPercent(holding.sharesChangePct)})`
                }`
          }
          tone={changeToneClass(holding.sharesChange)}
        />
        <HoldingMetric
          label="평가액"
          value={formatUsd(holding.valueUsd)}
          detail={
            holding.valueChangeUsd === null
              ? "-"
              : formatSignedUsd(holding.valueChangeUsd)
          }
          tone={changeToneClass(holding.valueChangeUsd)}
        />
      </div>
      <HoldingArrow
        visible={Boolean(holding.chatHref)}
        className="hidden justify-self-end xl:inline-flex"
      />
    </>
  );

  if (holding.chatHref) {
    return (
      <Link
        href={holding.chatHref}
        className={rowClassName}
        aria-label={`${holding.ticker ?? displayName} 리서치 열기`}
        title={`${holding.ticker ?? displayName} 리서치 열기`}
      >
        {content}
      </Link>
    );
  }

  return <div className={rowClassName}>{content}</div>;
}

function HoldingIdentity({ holding }: { holding: HoldingView }) {
  const displayName = holdingDisplayName(holding);

  return (
    <div className="flex min-w-0 items-center gap-3">
      {holding.ticker ? (
        <CompanyLogo
          ticker={holding.ticker}
          companyName={displayName}
          imageSize={72}
          className="h-9 w-9 rounded-[8px] border border-hairline bg-surface text-[10px]"
        />
      ) : null}
      <HoldingTitle holding={holding} />
    </div>
  );
}

function HoldingMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0 xl:px-0 xl:text-right">
      <p className="mb-1 text-[10px] font-black leading-3 text-muted xl:hidden">
        {label}
      </p>
      <p className="truncate font-mono text-[13px] font-black leading-5 text-ink">
        {value}
      </p>
      <p className={`truncate font-mono text-[11px] font-bold leading-4 ${tone}`}>
        {detail}
      </p>
    </div>
  );
}

function HoldingArrow({
  visible,
  className = "",
}: {
  visible: boolean;
  className?: string;
}) {
  if (!visible) {
    return <span aria-hidden="true" className={["h-7 w-7", className].join(" ")} />;
  }

  return (
    <span
      aria-hidden="true"
      className={[
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas text-muted transition-colors group-hover:border-primary group-hover:text-primary",
        className,
      ].join(" ")}
    >
      <span className="material-symbols-outlined text-[17px]">arrow_forward</span>
    </span>
  );
}

function HoldingTitle({
  holding,
}: {
  holding: HoldingView;
}) {
  const displayName = holdingDisplayName(holding);

  return (
    <div className="min-w-0">
      <p className="min-w-0 max-w-full truncate text-[14px] font-black leading-5 text-ink transition-colors group-hover:text-primary">
        {displayName}
      </p>
    </div>
  );
}

function RebalancingSection({
  dashboard,
}: {
  dashboard: InstitutionalHoldingsDashboard;
}) {
  return (
    <section className="mt-5">
      <div className="mb-3 border-b border-hairline pb-3">
        <h2 className="text-[19px] font-black leading-7 text-ink">
          분기 리밸런싱 추적
        </h2>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <RebalancingList title="보유 비중 증가" holdings={dashboard.rebalancing.buys} />
        <RebalancingList
          title="보유 비중 감소"
          holdings={dashboard.rebalancing.sells}
        />
      </div>
    </section>
  );
}

function RebalancingList({
  title,
  holdings,
}: {
  title: string;
  holdings: InstitutionalHoldingsDashboard["holdings"];
}) {
  return (
    <div className="rounded-[8px] border border-hairline bg-canvas">
      <div className="border-b border-hairline px-4 py-3">
        <h3 className="text-[15px] font-black leading-5 text-ink">{title}</h3>
      </div>
      <div className="divide-y divide-hairline">
        {holdings.map((holding, index) => (
          <RebalancingListRow
            key={`${title}-${holding.id}`}
            holding={holding}
            index={index}
          />
        ))}
        {holdings.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] font-bold leading-5 text-muted">
            비교 가능한 종목이 없습니다.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RebalancingListRow({
  holding,
  index,
}: {
  holding: HoldingView;
  index: number;
}) {
  const displayName = holdingDisplayName(holding);
  const rowClassName = [
    "group grid grid-cols-[40px_minmax(0,1fr)_auto_24px] items-center gap-3 px-4 py-3 transition-colors",
    holding.chatHref
      ? "cursor-pointer hover:bg-surface-soft focus-visible:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-fixed-dim/35"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      {holding.ticker ? (
        <CompanyLogo
          ticker={holding.ticker}
          companyName={displayName}
          imageSize={72}
          className="h-9 w-9 rounded-[8px] border border-hairline bg-surface text-[10px]"
        />
      ) : (
        <span className="font-mono text-[13px] font-black leading-5 text-muted">
          {index + 1}
        </span>
      )}
      <div className="min-w-0">
        <HoldingTitle holding={holding} />
        <p className="mt-1 text-[12px] font-bold leading-5 text-muted">
          #{index + 1} · 보유비중 {formatWeightPercent(holding.portfolioWeight)}
        </p>
      </div>
      <div className="text-right">
        <p
          className={`font-mono text-[13px] font-black leading-5 ${changeToneClass(
            holding.portfolioWeightChange,
          )}`}
        >
          {holding.portfolioWeightChange === null
            ? "-"
            : formatSignedPercentagePoints(holding.portfolioWeightChange)}
        </p>
        <p className="mt-1 font-mono text-[12px] font-bold leading-4 text-muted">
          {formatUsd(holding.valueUsd)}
        </p>
      </div>
      <HoldingArrow
        visible={Boolean(holding.chatHref)}
        className="justify-self-end"
      />
    </>
  );

  if (holding.chatHref) {
    return (
      <Link
        href={holding.chatHref}
        className={rowClassName}
        aria-label={`${holding.ticker ?? displayName} 리서치 열기`}
        title={`${holding.ticker ?? displayName} 리서치 열기`}
      >
        {content}
      </Link>
    );
  }

  return <div className={rowClassName}>{content}</div>;
}

function EmptyHoldings() {
  return (
    <div className="rounded-[8px] border border-hairline bg-surface-soft p-lg text-center">
      <p className="text-[15px] font-black leading-6 text-ink">
        저장된 13F 스냅샷이 없습니다.
      </p>
      <p className="mt-1 text-[13px] font-bold leading-5 text-muted">
        분기별 13F 스냅샷이 DB에 저장되면 표시됩니다.
      </p>
    </div>
  );
}

function splitManagerName(label: string) {
  const [primary, ...secondaryParts] = label.split(" / ");
  const primaryName = primary?.trim() || label.trim();
  return {
    primary: primaryName,
    secondary: secondaryParts.join(" / ").trim() || label.trim(),
  };
}

function managerDescription(
  manager: InstitutionalHoldingsDashboard["managers"][number],
) {
  const descriptions: Record<string, string> = {
    "0001608046": "한국 국민연금의 미국 상장주식 13F 보유 공시",
    "0002012383": "글로벌 자산운용사의 대형 포지션 변화",
    "0001067983": "워런 버핏의 버크셔 분기 포트폴리오",
    "0001697748": "캐시 우드의 혁신 성장주 중심 13F",
    "0001536411": "스탠리 드러켄밀러의 패밀리오피스 13F",
    "0000850529": "켄 피셔의 글로벌 주식 포트폴리오",
    "0001336528": "빌 애크먼의 집중 투자 포트폴리오",
    "0001656456": "데이비드 테퍼의 Appaloosa 13F",
    "0001061768": "세스 클라먼의 Baupost 장기 가치 포트폴리오",
    "0001040273": "댄 로브의 Third Point 13F",
    "0001029160": "조지 소로스의 Soros Fund Management 13F",
    "0001135730": "필립 라퐁의 Coatue 성장주 포트폴리오",
    "0001167483": "체이스 콜먼의 Tiger Global 13F",
    "0001103804": "안드레아스 할보르센의 Viking Global 13F",
    "0001061165": "스티브 맨델의 Lone Pine Capital 13F",
  };
  const { secondary } = splitManagerName(manager.displayName ?? manager.name);
  return descriptions[manager.cik] ?? `${secondary} 13F 보유 공시`;
}

function holdingDisplayName(holding: {
  displayName?: string | null;
  issuerName: string;
}) {
  return holding.displayName?.trim() || holding.issuerName;
}

function formatUsd(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) {
    return `${value < 0 ? "-" : ""}$${formatCompactUsdNumber(abs / 1_000_000_000_000)}T`;
  }
  if (abs >= 1_000_000_000) {
    return `${value < 0 ? "-" : ""}$${formatCompactUsdNumber(abs / 1_000_000_000)}B`;
  }
  if (abs >= 1_000_000) {
    return `${value < 0 ? "-" : ""}$${formatCompactUsdNumber(abs / 1_000_000)}M`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompactUsdNumber(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatSignedUsd(value: number) {
  if (value === 0) return formatUsd(0);
  const formatted = formatUsd(Math.abs(value));
  return `${value > 0 ? "+" : "-"}${formatted}`;
}

function formatShares(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function formatSignedNumber(value: number) {
  if (value === 0) return "0";
  const formatted = formatShares(Math.abs(value));
  return `${value > 0 ? "+" : "-"}${formatted}`;
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatWeightPercent(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSignedPercent(value: number) {
  if (value === 0) return "0%";
  const formatted = new Intl.NumberFormat("ko-KR", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(Math.abs(value));
  return `${value > 0 ? "+" : "-"}${formatted}`;
}

function formatSignedPercentagePoints(value: number) {
  if (value === 0) return "0%p";
  const formatted = new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 2,
  }).format(Math.abs(value) * 100);
  return `${value > 0 ? "+" : "-"}${formatted}%p`;
}

function changeToneClass(value: number | null | undefined) {
  if ((value ?? 0) > 0) return "text-semantic-up";
  if ((value ?? 0) < 0) return "text-semantic-down";
  return "text-muted";
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
