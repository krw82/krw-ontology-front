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

export default function CompaniesBrowser({
  initialCompanies,
}: CompaniesBrowserProps) {
  const [search, setSearch] = useState("");

  const filteredCompanies = useMemo(() => {
    return filterAndSortCompanies(initialCompanies, search);
  }, [initialCompanies, search]);

  return (
    <div className="relative mx-auto flex w-full max-w-[1600px] flex-1">
      <main className="w-full flex-grow overflow-y-auto px-base pb-[112px] pt-xl sm:px-md md:px-xl md:pb-[96px] md:pt-[96px]">
        <header className="mb-xl md:mb-[96px]">
          <h1 className="mb-base text-[40px] font-normal leading-[1.05] tracking-normal text-ink sm:text-[48px] md:mb-lg md:text-[64px]">
            회사 목록
          </h1>
          <p className="max-w-3xl text-[18px] font-normal leading-[1.45] tracking-normal text-body sm:text-[22px] md:text-[32px] md:leading-[1.13]">
            로컬 온톨로지에 인덱싱된 기업을 확인하고, 근거 기반 리서치를 바로 시작하세요.
          </p>
          <div className="mt-md text-[15px] font-medium leading-[1.5] text-muted sm:text-[16px]">
            {initialCompanies.length}개의 기업 정보를 제공합니다. 계속 업데이트중입니다.
          </div>
        </header>

        <section className="mb-xl rounded-xl border border-hairline bg-canvas p-sm shadow-sm sm:p-base">
          <div className="relative w-full">
            <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-[28px] text-outline sm:text-[32px]">
              search
            </span>
            <input
              className="h-[48px] w-full rounded-full border border-hairline bg-surface pl-11 pr-sm text-[16px] font-normal leading-[1.5] transition-colors focus:border-primary-container focus:outline-none focus:ring-0 sm:pl-12"
              placeholder="티커, 업종, 활동 키워드로 검색..."
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="회사 검색"
            />
          </div>
        </section>

        {initialCompanies.length === 0 ? (
          <div className="rounded-xl border border-hairline bg-surface-soft p-lg text-[15px] leading-[1.5] text-body sm:text-[16px]">
            로컬 온톨로지 디렉터리에서 인덱싱된 회사를 찾지 못했습니다.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-base md:grid-cols-2 md:gap-lg lg:grid-cols-3">
            {filteredCompanies.map((company) => (
              <CompanyCard key={company.ticker} company={company} />
            ))}
          </div>
        )}

        {initialCompanies.length > 0 && filteredCompanies.length === 0 && (
          <div className="py-xxl text-center">
            <p className="text-[18px] font-semibold leading-[1.33] text-muted">
              검색 조건에 맞는 회사가 없습니다.
            </p>
          </div>
        )}

        <footer className="mt-xxl w-full border-t border-hairline py-xxl md:mt-[96px] md:py-[96px]">
          <div className="flex w-full flex-col items-center justify-between gap-lg text-center md:flex-row md:text-left">
            <div className="text-[15px] font-semibold leading-[1.4] text-ink sm:text-[16px] md:leading-[1.25]">
              &copy; 2026 KRW Ontology. 근거 기반 기업 리서치와 데이터 분석.
            </div>
            <div className="flex flex-wrap justify-center gap-base sm:gap-lg">
              {["이용약관", "개인정보", "방법론", "공시", "API"].map(
                (link) => (
                  <Link
                    key={link}
                    className="text-[14px] font-medium leading-[1.4] text-muted opacity-100 transition-colors hover:text-primary hover:opacity-80"
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
