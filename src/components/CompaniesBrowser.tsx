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
    <div className="relative mx-auto flex min-h-0 w-full max-w-[1600px] flex-1">
      <main className="min-h-0 w-full flex-grow overflow-y-auto px-base pb-[112px] pt-xl sm:px-md md:px-xl md:pb-[96px] md:pt-[72px]">
        <header className="border-b border-hairline pb-8">
          <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)] lg:items-start">
            <div className="min-w-0">
              <p className="text-[13px] font-extrabold leading-5 text-primary">
                자료로 찾기
              </p>
              <h1 className="mt-3 max-w-3xl text-balance text-[32px] font-black leading-[1.08] tracking-normal text-ink sm:text-[44px]">
                자료에서 기업을 찾습니다.
              </h1>
              <p className="mt-4 max-w-2xl text-[16px] leading-7 text-body sm:text-[18px]">
                보고서, 논문 초록, 기사 내용을 그대로 넣어보세요. 관련
                회사와 공시 근거를 함께 확인합니다.
              </p>
            </div>

            <section className="rounded-[8px] border border-primary/25 bg-canvas p-4 shadow-sm sm:p-5">
              <div className="min-w-0">
                <p className="text-[12px] font-extrabold leading-5 text-primary">
                  자료 기반 리서치
                </p>
                <h2 className="mt-1.5 text-[18px] font-black leading-[1.25] text-ink sm:text-[21px]">
                  회사명을 몰라도 긴 글에서 시작합니다.
                </h2>
              </div>

              <p className="mt-4 text-[14px] font-semibold leading-6 text-body">
                보고서, 기사, 공시 문장을 분석 화면에 넣으면 관련 기업
                후보와 사업 활동, 리스크, 근거 문장을 함께 찾아줍니다.
              </p>

              <div className="mt-4">
                <Link
                  href="/chat"
                  className="inline-flex min-h-[48px] w-full items-center justify-center gap-xs rounded-[8px] bg-ink px-4 py-3 text-[14px] font-extrabold leading-5 text-canvas transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  aria-label="자료로 분석 시작"
                >
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-[19px]"
                  >
                    arrow_forward
                  </span>
                  자료로 분석 시작
                </Link>
              </div>
            </section>
          </div>

          <div className="mt-5 grid gap-3 rounded-[8px] border border-hairline bg-surface p-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center">
            <div>
              <p className="text-[13px] font-extrabold leading-5 text-ink">
                회사명으로 바로 찾기
              </p>
              <p className="mt-1 text-[13px] font-semibold leading-5 text-muted">
                AAPL, LNG처럼 알고 있는 티커가 있을 때
              </p>
            </div>
            <div className="relative w-full">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[22px] text-primary-container">
                search
              </span>
              <input
                className="h-[52px] w-full rounded-[8px] border border-hairline bg-canvas pl-11 pr-sm text-[15px] font-semibold leading-[1.5] transition-all duration-300 ease-out placeholder:text-muted focus:border-primary-fixed-dim focus:ring-4 focus:ring-primary-fixed-dim/20 focus:outline-none"
                placeholder="티커, 사업 활동, 리스크 변수 검색"
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="회사 검색"
              />
            </div>
          </div>
        </header>

        {initialCompanies.length === 0 ? (
          <div className="mt-8 rounded-[8px] border border-hairline bg-surface p-lg text-[15px] leading-[1.5] text-body sm:text-[16px]">
            로컬 온톨로지 디렉터리에서 인덱싱된 회사를 찾지 못했습니다.
          </div>
        ) : (
          <div className="animate-fade-in-up mt-8 overflow-hidden rounded-[8px] border border-hairline bg-canvas opacity-0" style={{ animationDelay: "150ms" }}>
            <div className="hidden grid-cols-[116px_minmax(220px,1.1fr)_minmax(260px,1.5fr)_minmax(220px,1fr)] border-b border-hairline bg-surface px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted 2xl:grid">
              <span>ticker</span>
              <span>company</span>
              <span>activity</span>
              <span>watch</span>
            </div>
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
          <div className="flex w-full flex-col items-center text-center md:items-start md:text-left">
            <div className="text-[15px] font-bold leading-[1.4] text-ink sm:text-[16px] md:leading-[1.25]">
              &copy; 2026 KRW Ontology. 근거 기반 기업 리서치와 데이터 분석.
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
