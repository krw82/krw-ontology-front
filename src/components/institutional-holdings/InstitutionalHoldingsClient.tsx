"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import CompanyLogo from "@/components/CompanyLogo";
import type { InstitutionalHoldingsDashboard } from "@/lib/sec-13f/types";
import { quarterlyStoryCopy } from "./story-copy";

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
  const headingParts = splitManagerName(heading);
  const hasSecondaryHeading = heading.includes(" / ");

  return (
    <main
      id="main-content"
      className="px-base pb-xl pt-lg sm:px-md md:px-xl md:pb-[112px] md:pt-xl"
    >
      <div className="mx-auto w-full max-w-[1240px]">
        <header className="motion-13f-header border-b border-hairline pb-6 sm:pb-7">
          <p className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-primary">
            SEC 13F / QUARTERLY READ
          </p>
          <h1 className="mt-3 text-balance text-[34px] font-black leading-[1.04] tracking-[-0.045em] text-ink sm:text-[52px]">
            {headingParts.primary}
          </h1>
          {hasSecondaryHeading ? (
            <p className="mt-2 font-mono text-[12px] font-bold leading-5 text-muted">
              {headingParts.secondary}
            </p>
          ) : null}
          <p className="mt-4 max-w-2xl text-[16px] leading-7 text-body">
            {dashboard
              ? "공시의 변화와 핵심 보유를 먼저 읽고, 필요할 때 전체 종목을 확인합니다."
              : "유명 투자자와 운용사의 최신 13F 보유 공시를 모아봅니다."}
          </p>
        </header>

        {loadError ? (
          <div className="mt-5 border border-error-container bg-error-container/40 px-sm py-xs text-[13px] font-bold leading-5 text-error">
            {loadError}
          </div>
        ) : null}

        {dashboard ? (
          <>
            <div className="mt-7 grid gap-10 xl:grid-cols-[216px_minmax(0,1fr)] xl:gap-14">
              <FilingContext dashboard={dashboard} />
              <div className="min-w-0">
                <QuarterlyStory dashboard={dashboard} />
                <CoreHoldings holdings={dashboard.holdings} />
              </div>
            </div>

            <section
              id="all-holdings"
              className="motion-13f-change mt-12 scroll-mt-24 border-t border-ink pt-6 sm:mt-16 sm:pt-7"
              aria-labelledby="all-holdings-title"
            >
              <div className="grid gap-4 border-b border-hairline pb-5 md:grid-cols-[minmax(0,1fr)_320px] md:items-end">
                <div>
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-primary">
                    ALL HOLDINGS
                  </p>
                  <h2
                    id="all-holdings-title"
                    className="mt-2 text-[25px] font-black leading-8 tracking-[-0.035em] text-ink sm:text-[30px]"
                  >
                    전체 보유 종목
                  </h2>
                  <p className="mt-2 text-[14px] leading-6 text-muted">
                    표시된 {dashboard.displayLimit.toLocaleString()}개 종목입니다.
                    공시 시점 이후의 보유와는 다를 수 있습니다.
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

              <div className="mt-4">
                {dashboard.filing ? (
                  <HoldingsTable holdings={filteredHoldings} />
                ) : (
                  <EmptyHoldings />
                )}
              </div>
            </section>
          </>
        ) : (
          <ManagerGrid managers={managers} />
        )}
      </div>
    </main>
  );
}

function FilingContext({
  dashboard,
}: {
  dashboard: InstitutionalHoldingsDashboard;
}) {
  const filing = dashboard.filing;

  return (
    <aside
      aria-label="공시 맥락"
      className="motion-13f-context border-y border-hairline py-5 xl:sticky xl:top-6 xl:h-fit xl:border-t-0 xl:py-0"
    >
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-primary">
        FILING CONTEXT
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-5 border-t border-hairline xl:block">
        <ContextItem
          label="FORM"
          value={filing?.form ?? "13F"}
          detail={filing ? "SEC 공시" : "스냅샷 없음"}
        />
        <ContextItem
          label="AS OF"
          value={filing ? formatDate(filing.reportPeriod) : "-"}
          detail="보고 기준일"
        />
        <ContextItem
          label="COMPARE"
          value={
            dashboard.previousFiling
              ? formatDate(dashboard.previousFiling.reportPeriod)
              : "-"
          }
          detail={dashboard.previousFiling ? "직전 공시" : "비교 데이터 없음"}
        />
        <ContextItem
          label="SHOWN"
          value={formatUsd(dashboard.stats.totalValueUsd)}
          detail={dashboard.stats.totalPositions.toLocaleString() + "개 종목"}
        />
      </dl>
      {filing ? (
        <a
          href={filing.filingDetailUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex min-h-11 items-center border-b border-ink text-[13px] font-black leading-5 text-ink transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-fixed-dim/35"
        >
          원문 13F 열기
          <span
            aria-hidden="true"
            className="material-symbols-outlined ml-1.5 text-[16px]"
          >
            open_in_new
          </span>
        </a>
      ) : null}
      <p className="mt-4 text-[12px] leading-5 text-muted">
        13F는 분기 말 미국 상장 증권 중심의 보유 공시입니다. 현재 보유나 매매
        의도를 모두 보여 주지는 않습니다.
      </p>
    </aside>
  );
}

function ContextItem({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border-b border-hairline py-3 xl:py-3.5">
      <dt className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
        {label}
      </dt>
      <dd className="mt-1 text-[13px] font-black leading-5 text-ink">{value}</dd>
      <p className="mt-0.5 text-[11px] font-semibold leading-4 text-muted">
        {detail}
      </p>
    </div>
  );
}

function QuarterlyStory({
  dashboard,
}: {
  dashboard: InstitutionalHoldingsDashboard;
}) {
  const buys = dashboard.rebalancing.buys.slice(0, 3);
  const sells = dashboard.rebalancing.sells.slice(0, 3);
  const hasChanges = buys.length > 0 || sells.length > 0;
  const storyCopy = quarterlyStoryCopy({
    hasPreviousFiling: Boolean(dashboard.previousFiling),
    buys,
    sells,
  });

  return (
    <section className="motion-13f-story" aria-labelledby="quarterly-story-title">
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-primary">
        THIS QUARTER
      </p>
      <h2
        id="quarterly-story-title"
        className="mt-3 max-w-3xl text-balance text-[33px] font-black leading-[1.12] tracking-[-0.05em] text-ink sm:text-[48px]"
      >
        이번 분기, 무엇이 달라졌을까?
      </h2>
      <p className="mt-4 max-w-2xl text-[16px] leading-7 text-body">{storyCopy}</p>
      <p className="mt-2 max-w-2xl text-[13px] font-semibold leading-5 text-muted">
        증감은 직전 13F와 비교한 보유 비중 변화이며, 매수·매도 추천이 아닙니다.
      </p>

      {hasChanges ? (
        <nav
          className="mt-7 flex flex-wrap gap-x-5 border-b border-hairline"
          aria-label="13F 변화 바로가기"
        >
          {buys.length > 0 ? (
            <a
              href="#increased-holdings"
              className="inline-flex min-h-11 items-center border-b-2 border-primary text-[12px] font-black text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-fixed-dim/35"
            >
              더 크게 본 곳
            </a>
          ) : null}
          {sells.length > 0 ? (
            <a
              href="#decreased-holdings"
              className="inline-flex min-h-11 items-center border-b-2 border-transparent text-[12px] font-black text-body transition-colors hover:border-hairline hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-fixed-dim/35"
            >
              덜어낸 곳
            </a>
          ) : null}
          <a
            href="#core-holdings"
            className="inline-flex min-h-11 items-center border-b-2 border-transparent text-[12px] font-black text-body transition-colors hover:border-hairline hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-fixed-dim/35"
          >
            여전히 큰 보유
          </a>
        </nav>
      ) : null}

      {buys.length > 0 ? (
        <ChangeStorySection
          id="increased-holdings"
          index="01 / MORE OF"
          title="보유 비중을 더 키운 종목"
          description="직전 공시와 비교한 보유 비중 변화가 큰 순서입니다."
          holdings={buys}
          direction="up"
        />
      ) : null}

      {sells.length > 0 ? (
        <ChangeStorySection
          id="decreased-holdings"
          index="02 / LESS OF"
          title="보유 비중을 줄인 종목"
          description="비중 감소는 처분이나 부정적 전망과 같은 뜻이 아닙니다."
          holdings={sells}
          direction="down"
        />
      ) : null}

      {!hasChanges ? (
        <div className="mt-8 border-y border-hairline py-6 text-[14px] font-semibold leading-6 text-muted">
          비교 가능한 보유 비중 변화가 없거나, 직전 공시가 아직 준비되지 않았습니다.
        </div>
      ) : null}
    </section>
  );
}

function ChangeStorySection({
  id,
  index,
  title,
  description,
  holdings,
  direction,
}: {
  id: string;
  index: string;
  title: string;
  description: string;
  holdings: HoldingView[];
  direction: "up" | "down";
}) {
  const indexTone = direction === "up" ? "text-semantic-up" : "text-semantic-down";

  return (
    <section
      id={id}
      className="motion-13f-change mt-9 scroll-mt-24 border-t border-hairline pt-7 sm:mt-11 sm:pt-8"
      aria-labelledby={id + "-title"}
    >
      <p
        className={[
          "font-mono text-[11px] font-bold uppercase tracking-[0.12em]",
          indexTone,
        ].join(" ")}
      >
        {index}
      </p>
      <h3
        id={id + "-title"}
        className="mt-2 text-[26px] font-black leading-8 tracking-[-0.04em] text-ink sm:text-[34px]"
      >
        {title}
      </h3>
      <p className="mt-2 text-[14px] leading-6 text-body">{description}</p>
      <div className="mt-6 divide-y divide-hairline border-y border-ink sm:grid sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {holdings.map((holding, rowIndex) => (
          <ChangeStoryRow
            key={holding.id}
            holding={holding}
            direction={direction}
            index={rowIndex}
          />
        ))}
      </div>
    </section>
  );
}

function ChangeStoryRow({
  holding,
  direction,
  index,
}: {
  holding: HoldingView;
  direction: "up" | "down";
  index: number;
}) {
  const displayName = holdingDisplayName(holding);
  const primaryLabel = holding.ticker ?? displayName;
  const secondaryLabel = holding.ticker ? displayName : null;
  const rowClassName = [
    "motion-13f-row group flex min-h-[88px] items-center gap-3 px-0 py-4 transition-colors sm:min-h-[148px] sm:flex-col sm:items-start sm:justify-between sm:px-5 sm:py-5",
    holding.chatHref
      ? "cursor-pointer hover:bg-surface-soft focus-visible:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-fixed-dim/35"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const delta = formatSignedPercentagePoints(holding.portfolioWeightChange ?? 0);
  const deltaTone =
    direction === "up" ? "text-semantic-up" : "text-semantic-down";

  const content = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        {holding.ticker ? (
          <CompanyLogo
            ticker={holding.ticker}
            companyName={displayName}
            imageSize={72}
            className="h-10 w-10 shrink-0 text-[10px]"
          />
        ) : null}
        <div className="min-w-0">
          <p className="break-words font-mono text-[22px] font-black leading-6 tracking-[-0.06em] text-ink">
            {primaryLabel}
          </p>
          {secondaryLabel ? (
            <p className="mt-1 break-words text-[13px] font-bold leading-5 text-body">
              {secondaryLabel}
            </p>
          ) : null}
        </div>
      </div>
      <div className="ml-auto text-right sm:ml-0 sm:text-left">
        <p
          className={[
            "font-mono text-[14px] font-black leading-5",
            deltaTone,
          ].join(" ")}
        >
          {delta}
        </p>
        <p className="mt-1 font-mono text-[11px] font-bold leading-4 text-muted">
          비중 {formatWeightPercent(holding.portfolioWeight)} · {formatUsd(holding.valueUsd)}
        </p>
      </div>
      {holding.chatHref ? (
        <span
          aria-hidden="true"
          className="material-symbols-outlined shrink-0 text-[18px] text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary sm:hidden"
        >
          arrow_forward
        </span>
      ) : null}
    </>
  );

  if (holding.chatHref) {
    return (
      <Link
        href={holding.chatHref}
        className={rowClassName}
        style={{ "--motion-delay": `${index * 55}ms` } as CSSProperties}
        aria-label={(holding.ticker ?? displayName) + " 리서치 열기"}
        title={(holding.ticker ?? displayName) + " 리서치 열기"}
      >
        {content}
      </Link>
    );
  }

  return (
    <div
      className={rowClassName}
      style={{ "--motion-delay": `${index * 55}ms` } as CSSProperties}
    >
      {content}
    </div>
  );
}

function CoreHoldings({ holdings }: { holdings: HoldingView[] }) {
  const coreHoldings = holdings.slice(0, 4);
  if (coreHoldings.length === 0) return null;

  return (
    <section
      id="core-holdings"
      className="motion-13f-core mt-11 scroll-mt-24 border-t border-ink pt-7 sm:mt-14 sm:pt-8"
      aria-labelledby="core-holdings-title"
    >
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-primary">
        THE CORE
      </p>
      <h2
        id="core-holdings-title"
        className="mt-2 text-[28px] font-black leading-8 tracking-[-0.04em] text-ink sm:text-[36px]"
      >
        여전히 큰 보유
      </h2>
      <p className="mt-2 max-w-2xl text-[14px] leading-6 text-body">
        비중 변화와 별개로, 공시 시점에서 비중이 큰 종목을 함께 확인합니다.
      </p>
      <div className="mt-6 border-y border-hairline">
        {coreHoldings.map((holding, index) => (
          <CoreHoldingRow key={holding.id} holding={holding} index={index} />
        ))}
      </div>
    </section>
  );
}

function CoreHoldingRow({
  holding,
  index,
}: {
  holding: HoldingView;
  index: number;
}) {
  const displayName = holdingDisplayName(holding);
  const rowClassName = [
    "motion-13f-row group grid min-h-[76px] grid-cols-[28px_minmax(0,1fr)_auto_22px] items-center gap-3 border-b border-hairline py-3 last:border-b-0 sm:grid-cols-[36px_minmax(0,1fr)_96px_112px_22px] sm:gap-4",
    holding.chatHref
      ? "cursor-pointer hover:bg-surface-soft focus-visible:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-fixed-dim/35"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      <span className="font-mono text-[11px] font-bold text-muted">
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className="flex min-w-0 items-center gap-3">
        {holding.ticker ? (
          <CompanyLogo
            ticker={holding.ticker}
            companyName={displayName}
            imageSize={72}
            className="h-9 w-9 shrink-0 text-[10px]"
          />
        ) : null}
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-black leading-5 text-ink transition-colors group-hover:text-primary">
            {displayName}
          </span>
          {holding.ticker ? (
            <span className="mt-1 block font-mono text-[11px] font-bold leading-4 text-muted">
              {holding.ticker}
            </span>
          ) : null}
        </span>
      </span>
      <span className="text-right font-mono text-[12px] font-black leading-5 text-ink">
        {formatWeightPercent(holding.portfolioWeight)}
      </span>
      <span className="hidden text-right font-mono text-[12px] font-black leading-5 text-ink sm:inline">
        {formatUsd(holding.valueUsd)}
      </span>
      {holding.chatHref ? (
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[17px] text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
        >
          arrow_forward
        </span>
      ) : (
        <span aria-hidden="true" />
      )}
    </>
  );

  if (holding.chatHref) {
    return (
      <Link
        href={holding.chatHref}
        className={rowClassName}
        style={{ "--motion-delay": `${index * 55}ms` } as CSSProperties}
        aria-label={(holding.ticker ?? displayName) + " 리서치 열기"}
        title={(holding.ticker ?? displayName) + " 리서치 열기"}
      >
        {content}
      </Link>
    );
  }

  return (
    <div
      className={rowClassName}
      style={{ "--motion-delay": `${index * 55}ms` } as CSSProperties}
    >
      {content}
    </div>
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
  const managerParts = splitManagerName(manager.displayName ?? manager.name);
  const description = managerDescription(manager);

  return (
    <Link
      href={"/institutional-holdings?cik=" + encodeURIComponent(manager.cik)}
      className="motion-13f-manager-card group flex aspect-square min-w-0 flex-col rounded-[8px] border border-hairline bg-canvas p-3 text-left text-ink transition-[background-color,border-color,color,transform] hover:border-outline hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-fixed-dim/35 sm:p-4"
    >
      <span className="font-mono text-[10px] font-black uppercase leading-4 tracking-[0.12em] text-primary">
        {manager.countryCode || "13F"} · 13F
      </span>
      <span className="mt-3 block min-w-0 text-[15px] font-black leading-5 text-ink sm:text-[16px]">
        {managerParts.primary}
      </span>
      <span className="mt-1 line-clamp-2 min-w-0 text-[11px] font-bold leading-4 text-muted sm:text-[12px]">
        {managerParts.secondary}
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

function HoldingsTable({
  holdings,
}: {
  holdings: InstitutionalHoldingsDashboard["holdings"];
}) {
  if (holdings.length === 0) {
    return (
      <div className="border border-hairline bg-surface-soft p-lg text-center text-[14px] font-bold leading-6 text-muted">
        조건에 맞는 보유 종목이 없습니다.
      </div>
    );
  }

  return (
    <div className="overflow-hidden border border-hairline bg-canvas">
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
      <div className="grid min-w-0 grid-cols-2 divide-x divide-hairline xl:contents xl:divide-x-0">
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
              : formatSignedNumber(holding.sharesChange) +
                (holding.sharesChangePct === null
                  ? ""
                  : " (" + formatSignedPercent(holding.sharesChangePct) + ")")
          }
          tone={changeToneClass(holding.sharesChange)}
          className="hidden xl:block"
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
        aria-label={(holding.ticker ?? displayName) + " 리서치 열기"}
        title={(holding.ticker ?? displayName) + " 리서치 열기"}
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
  className = "",
}: {
  label: string;
  value: string;
  detail: string;
  tone: string;
  className?: string;
}) {
  return (
    <div
      className={[
        "min-w-0 px-3 first:pl-0 last:pr-0 xl:px-0 xl:text-right",
        className,
      ].join(" ")}
    >
      <p className="mb-1 text-[10px] font-black leading-3 text-muted xl:hidden">
        {label}
      </p>
      <p className="truncate font-mono text-[13px] font-black leading-5 text-ink">
        {value}
      </p>
      <p className={["truncate font-mono text-[11px] font-bold leading-4", tone].join(" ")}>
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
    return (
      <span aria-hidden="true" className={["h-7 w-7", className].join(" ")} />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={[
        "inline-flex h-7 w-7 shrink-0 items-center justify-center border border-hairline bg-canvas text-muted transition-colors group-hover:border-primary group-hover:text-primary",
        className,
      ].join(" ")}
    >
      <span className="material-symbols-outlined text-[17px]">arrow_forward</span>
    </span>
  );
}

function HoldingTitle({ holding }: { holding: HoldingView }) {
  const displayName = holdingDisplayName(holding);

  return (
    <div className="min-w-0">
      <p className="min-w-0 max-w-full truncate text-[14px] font-black leading-5 text-ink transition-colors group-hover:text-primary">
        {displayName}
      </p>
    </div>
  );
}

function EmptyHoldings() {
  return (
    <div className="border border-hairline bg-surface-soft p-lg text-center">
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
  const secondary = splitManagerName(
    manager.displayName ?? manager.name,
  ).secondary;
  return descriptions[manager.cik] ?? secondary + " 13F 보유 공시";
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
    return (
      (value < 0 ? "-" : "") +
      "$" +
      formatCompactUsdNumber(abs / 1_000_000_000_000) +
      "T"
    );
  }
  if (abs >= 1_000_000_000) {
    return (
      (value < 0 ? "-" : "") +
      "$" +
      formatCompactUsdNumber(abs / 1_000_000_000) +
      "B"
    );
  }
  if (abs >= 1_000_000) {
    return (
      (value < 0 ? "-" : "") +
      "$" +
      formatCompactUsdNumber(abs / 1_000_000) +
      "M"
    );
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
  return (value > 0 ? "+" : "-") + formatted;
}

function formatShares(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function formatSignedNumber(value: number) {
  if (value === 0) return "0";
  return (value > 0 ? "+" : "-") + formatShares(Math.abs(value));
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
  return (value > 0 ? "+" : "-") + formatted;
}

function formatSignedPercentagePoints(value: number) {
  if (value === 0) return "0%p";
  const formatted = new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 2,
  }).format(Math.abs(value) * 100);
  return (value > 0 ? "+" : "-") + formatted + "%p";
}

function changeToneClass(value: number | null | undefined) {
  if ((value ?? 0) > 0) return "text-semantic-up";
  if ((value ?? 0) < 0) return "text-semantic-down";
  return "text-muted";
}

function formatDate(value: string) {
  const date = new Date(value + "T00:00:00Z");
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
