"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import CompanyCard, {
  type CompanyCardData,
} from "@/components/CompanyCard";
import { filterAndSortCompanies } from "@/lib/companies/filter";

interface CompaniesBrowserProps {
  initialCompanies: CompanyCardData[];
}

function uniqueCount<T>(items: T[]): number {
  return new Set(items).size;
}

export default function CompaniesBrowser({
  initialCompanies,
}: CompaniesBrowserProps) {
  const [search, setSearch] = useState("");

  const filteredCompanies = useMemo(() => {
    return filterAndSortCompanies(initialCompanies, search);
  }, [initialCompanies, search]);

  const stats = useMemo(() => {
    const filings = initialCompanies.reduce(
      (total, company) => total + (company.document_count ?? 0),
      0,
    );
    const sectors = uniqueCount(initialCompanies.map((company) => company.name));
    const latestPeriod = initialCompanies
      .map((company) => company.latest_period)
      .filter((period): period is string => Boolean(period))
      .sort()
      .at(-1);

    return [
      { label: "companies", value: initialCompanies.length.toLocaleString() },
      { label: "filings", value: filings.toLocaleString() },
      { label: "sectors", value: sectors.toLocaleString() },
      { label: "latest", value: latestPeriod ?? "-" },
    ];
  }, [initialCompanies]);

  return (
    <div className="relative mx-auto flex w-full max-w-[1600px] flex-1">
      <main className="w-full flex-grow overflow-y-auto px-base pb-[112px] pt-xl sm:px-md md:px-xl md:pb-[96px] md:pt-[72px]">
        <header className="border-b border-hairline pb-8">
          <div className="min-w-0">
            <p className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-tertiary">
              Research directory
            </p>
            <h1 className="mt-3 max-w-5xl text-balance text-[44px] font-black leading-[0.98] tracking-normal text-ink sm:text-[60px]">
              인덱싱된 기업과 공시 범위를 한눈에 봅니다.
            </h1>
            <p className="mt-5 max-w-3xl text-[17px] leading-8 text-body sm:text-[20px]">
              각 회사는 최신 기간, 문서 타입, 사업 활동, 핵심 변수를 같은
              카드 안에서 비교할 수 있게 정리되어 있습니다.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-[8px] border border-hairline bg-surface px-4 py-4 shadow-sm"
              >
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
                  {stat.label}
                </p>
                <p className="mt-2 text-[24px] font-black leading-none text-ink">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>
        </header>

        <section className="sticky top-0 z-20 -mx-base border-b border-hairline bg-canvas/95 px-base py-4 backdrop-blur-xl sm:-mx-md sm:px-md md:-mx-xl md:px-xl">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative w-full md:max-w-[576px]">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[22px] text-tertiary-container">
                search
              </span>
              <input
                className="h-[48px] w-full rounded-[8px] border border-hairline bg-surface pl-11 pr-sm text-[15px] font-semibold leading-[1.5] transition-colors placeholder:text-muted focus:border-tertiary-container focus:outline-none focus:ring-0"
                placeholder="티커, 업종, 사업 활동, 리스크 변수 검색"
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="회사 검색"
              />
            </div>
            <div className="flex items-center gap-2 text-[13px] font-bold text-muted">
              <span className="font-mono text-tertiary-container">
                {filteredCompanies.length}
              </span>
              <span>matched companies</span>
            </div>
          </div>
        </section>

        {initialCompanies.length === 0 ? (
          <div className="mt-8 rounded-[8px] border border-hairline bg-surface p-lg text-[15px] leading-[1.5] text-body sm:text-[16px]">
            로컬 온톨로지 디렉터리에서 인덱싱된 회사를 찾지 못했습니다.
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredCompanies.map((company) => (
              <CompanyCard key={company.ticker} company={company} />
            ))}
          </div>
        )}

        {initialCompanies.length > 0 && filteredCompanies.length === 0 && (
          <div className="py-xxl text-center">
            <p className="text-[18px] font-bold leading-[1.33] text-muted">
              검색 조건에 맞는 회사가 없습니다.
            </p>
          </div>
        )}

        <footer className="mt-xxl w-full border-t border-hairline py-xxl md:mt-[96px] md:py-[72px]">
          <div className="flex w-full flex-col items-center justify-between gap-lg text-center md:flex-row md:text-left">
            <div className="text-[15px] font-bold leading-[1.4] text-ink sm:text-[16px] md:leading-[1.25]">
              &copy; 2026 KRW Ontology. 근거 기반 기업 리서치와 데이터 분석.
            </div>
            <div className="flex flex-wrap justify-center gap-base sm:gap-lg">
              {["이용약관", "개인정보", "방법론", "공시", "API"].map(
                (link) => (
                  <Link
                    key={link}
                    className="text-[14px] font-semibold leading-[1.4] text-muted opacity-100 transition-colors hover:text-tertiary hover:opacity-80"
                    href="/"
                  >
                    {link}
                  </Link>
                ),
              )}
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
