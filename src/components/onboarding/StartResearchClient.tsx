"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import CompanyContextPicker from "@/components/company-picker/CompanyContextPicker";
import { KrwBrand } from "@/components/KrwBrand";
import type { Locale } from "@/i18n/config";
import { localizedPath } from "@/i18n/routing";
import {
  onboardingCompaniesHref,
  startCompanyChatHref,
} from "@/lib/onboarding/start-flow";
import { saveInterestCoverage } from "@/lib/coverage/client";
import {
  toCompanyMeta,
  type CompaniesResponse,
  type CompanyMeta,
} from "@/lib/chat/company-meta";

type StartResearchClientProps = {
  locale: Locale;
  preview?: boolean;
};

type OnboardingAction = "started" | "company_selected";
const COMPANY_PICKER_VISIBLE_BATCH_SIZE = 12;

function copyFor(locale: Locale) {
  if (locale === "en") {
    return {
      eyebrow: "First research",
      title: "Is there a company you want to understand?",
      intro:
        "Choose one company to start a focused conversation. You can also browse first if nothing comes to mind yet.",
      chooseCompany: "Choose a company",
      noCompany: "I do not have a company yet",
      companyLabel: "Choose a company to ask about",
      companyPickerDescription:
        "Select one to begin a new conversation with this company as the context.",
      companyPlaceholder: "Search ticker or company",
      companySearchLoading: "Loading available companies…",
      companySearchEmpty: "No company matched that search. Try a ticker or another name.",
      companySearchError: "We could not load companies right now. Browse the full list instead.",
      closePicker: "Close company selection",
      showingSuggestions: "Companies to start with",
    };
  }

  return {
    eyebrow: "첫 리서치",
    title: "관심 있는 회사가 있나요?",
    intro:
      "회사를 하나 고르면 그 회사 맥락의 새 채팅에서 바로 질문할 수 있어요. 아직 없다면 회사 목록을 먼저 둘러보세요.",
    chooseCompany: "관심 회사 선택",
    noCompany: "아직 관심 회사가 없어요",
    companyLabel: "어느 회사를 기준으로 질문할까요?",
    companyPickerDescription:
      "회사를 고르면 해당 회사 맥락의 새 채팅에서 바로 질문을 시작합니다.",
    companyPlaceholder: "티커 또는 회사명 검색",
    companySearchLoading: "분석 가능한 회사를 불러오는 중이에요…",
    companySearchEmpty: "검색 결과가 없어요. 티커 또는 다른 회사명으로 찾아보세요.",
    companySearchError: "회사를 불러오지 못했어요. 전체 회사 목록에서 찾아보세요.",
    closePicker: "회사 선택 닫기",
    showingSuggestions: "먼저 살펴볼 회사",
  };
}

async function readCompanyBrowseCatalog(locale: Locale): Promise<CompanyMeta[]> {
  const response = await fetch(
    `/api/companies/browse?locale=${encodeURIComponent(locale)}`,
    { cache: "no-store" },
  );
  const payload = (await response.json().catch(() => null)) as CompaniesResponse | null;
  if (!response.ok || !payload?.companies) throw new Error("company_catalog_failed");
  return payload.companies.map((company) => toCompanyMeta(company));
}

function companyMatchesSearch(company: CompanyMeta, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return [
    company.ticker,
    company.name,
    company.companyNameKo,
    company.sector,
    company.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase()
    .includes(normalizedQuery);
}

export default function StartResearchClient({
  locale,
  preview = false,
}: StartResearchClientProps) {
  const router = useRouter();
  const copy = copyFor(locale);
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyCatalog, setCompanyCatalog] = useState<CompanyMeta[] | null>(null);
  const [companyCatalogState, setCompanyCatalogState] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [visibleCompanyCount, setVisibleCompanyCount] = useState(
    COMPANY_PICKER_VISIBLE_BATCH_SIZE,
  );
  const [savingCompanyTicker, setSavingCompanyTicker] = useState<string | null>(null);
  const [companySelectionError, setCompanySelectionError] = useState<string | null>(null);
  const matchingCompanies = useMemo(
    () => (companyCatalog ?? []).filter((company) => companyMatchesSearch(company, companyQuery)),
    [companyCatalog, companyQuery],
  );
  const visibleCompanies = matchingCompanies.slice(0, visibleCompanyCount);
  const hasMoreCompanies = visibleCompanies.length < matchingCompanies.length;

  async function recordAction(
    action: OnboardingAction,
    properties: Record<string, unknown> = {},
  ) {
    try {
      await fetch("/api/onboarding/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...properties }),
        keepalive: true,
      });
    } catch {
      // Research stays available if lightweight lifecycle telemetry is down.
    }
  }

  useEffect(() => {
    void recordAction("started", { preview });
    // A mount is the start boundary; it is intentionally not tied to a click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!companyPickerOpen || companyCatalog) return;

    let active = true;
    void readCompanyBrowseCatalog(locale)
      .then((catalog) => {
        if (!active) return;
        setCompanyCatalog(catalog);
        setCompanyCatalogState("idle");
      })
      .catch(() => {
        if (!active) return;
        setCompanyCatalogState("error");
      });

    return () => {
      active = false;
    };
  }, [companyCatalog, companyPickerOpen, locale]);

  function openCompanyPicker() {
    setCompanyPickerOpen(true);
    setCompanyQuery("");
    setVisibleCompanyCount(COMPANY_PICKER_VISIBLE_BATCH_SIZE);
    if (!companyCatalog) setCompanyCatalogState("loading");
  }

  const handleCompanyQueryChange = useCallback((value: string) => {
    setCompanyQuery(value);
    setVisibleCompanyCount(COMPANY_PICKER_VISIBLE_BATCH_SIZE);
  }, []);

  const loadMoreCompanies = useCallback(() => {
    setVisibleCompanyCount((current) =>
      Math.min(
        current + COMPANY_PICKER_VISIBLE_BATCH_SIZE,
        matchingCompanies.length,
      ),
    );
  }, [matchingCompanies.length]);

  async function chooseCompany(company: CompanyMeta) {
    const destination = startCompanyChatHref(locale, company.ticker);
    if (!destination || savingCompanyTicker) return;

    setSavingCompanyTicker(company.ticker);
    setCompanySelectionError(null);
    try {
      await saveInterestCoverage(company.ticker);
      void recordAction("company_selected", { ticker: company.ticker });
      router.push(destination);
    } catch {
      setCompanySelectionError(
        locale === "ko"
          ? "관심 회사로 저장하지 못했습니다. 다시 시도해주세요."
          : "We could not save this company to your interests. Please try again.",
      );
    } finally {
      setSavingCompanyTicker(null);
    }
  }

  function browseCompanies() {
    // No "skipped" action here: this branch is still inside onboarding and
    // joins the same company-context chat flow from the companies page.
    router.push(onboardingCompaniesHref(locale));
  }

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <header className="border-b border-hairline bg-canvas">
        <div className="mx-auto flex min-h-[72px] w-full max-w-[1180px] items-center px-base sm:px-md">
          <KrwBrand
            href={localizedPath(locale, "/companies")}
            compact
            ariaLabel={locale === "ko" ? "회사 목록으로 이동" : "Browse companies"}
          />
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto flex min-h-[calc(100dvh-72px)] w-full max-w-[760px] flex-col justify-center px-base py-10 sm:px-md sm:py-14 md:justify-start md:pb-14 md:pt-[max(24px,calc(50dvh-338px))] lg:px-xl"
      >
        <section className="min-w-0">
          <p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-primary">
            {copy.eyebrow}
          </p>
          <h1 className="mt-3 max-w-2xl text-balance text-[36px] font-black leading-[1.08] tracking-[-0.04em] text-ink sm:text-[48px]">
            {copy.title}
          </h1>
          <p className="mt-4 max-w-[640px] text-[16px] leading-7 text-body sm:text-[17px]">
            {copy.intro}
          </p>

          <div className="mt-8 rounded-[12px] border border-hairline bg-canvas p-4 shadow-[0_12px_36px_rgba(10,11,13,0.06)] sm:p-5">
            <button
              type="button"
              onClick={openCompanyPicker}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[8px] bg-primary px-5 text-[15px] font-extrabold text-on-primary transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {copy.chooseCompany}
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                arrow_forward
              </span>
            </button>
            <button
              type="button"
              onClick={browseCompanies}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-[8px] border border-hairline px-4 text-[14px] font-extrabold text-ink transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {copy.noCompany}
            </button>
          </div>

        </section>

        <CompanyContextPicker
          open={companyPickerOpen}
          locale={locale}
          query={companyQuery}
          results={visibleCompanies}
          loading={companyCatalogState === "loading"}
          error={
            companySelectionError ??
            (companyCatalogState === "error" ? copy.companySearchError : null)
          }
          selecting={savingCompanyTicker !== null}
          totalCount={matchingCompanies.length}
          hasMore={hasMoreCompanies}
          title={copy.companyLabel}
          description={copy.companyPickerDescription}
          searchPlaceholder={copy.companyPlaceholder}
          loadingMessage={copy.companySearchLoading}
          emptyMessage={copy.companySearchEmpty}
          firstResultsLabel={copy.showingSuggestions}
          ariaLabel={copy.companyLabel}
          closeLabel={copy.closePicker}
          countLabel={(shown, total, hasMoreResults) =>
            locale === "ko"
              ? hasMoreResults
                ? `${Math.min(shown, total)} / ${total}개 표시 중`
                : `${total}개 모두 표시`
              : hasMoreResults
                ? `Showing ${Math.min(shown, total)} / ${total}`
                : `All ${total} shown`
          }
          onQueryChange={handleCompanyQueryChange}
          onLoadMore={loadMoreCompanies}
          onSelect={chooseCompany}
          onClose={() => setCompanyPickerOpen(false)}
          dataOnboardingTarget="start-company-picker"
        />

      </main>
    </div>
  );
}
