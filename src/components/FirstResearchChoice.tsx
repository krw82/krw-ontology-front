"use client";

import Link from "next/link";
import { trackClientEventSilently } from "@/lib/analytics/client";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";

interface FirstResearchChoiceProps {
  locale?: Locale;
  onStartCompany: () => void;
  onDismiss: () => void;
}

type ChoiceId = "company" | "discover" | "guru" | "browse";

const copyByLocale = {
  ko: {
    eyebrow: "첫 리서치 시작",
    heading: "오늘 무엇을 확인하고 싶나요?",
    intro:
      "한 가지만 고르면 바로 시작할 수 있어요. 나머지 도구는 필요할 때 꺼내 보세요.",
    primaryLabel: "가장 간단한 시작",
    companyTitle: "회사 분석",
    companyDescription:
      "이미 관심 있는 회사가 있다면, 티커나 회사명으로 바로 확인하세요.",
    companyAction: "회사 검색 시작",
    discoverTitle: "조건으로 기업 검색",
    discoverDescription:
      "산업, 실적 변화, 리스크 키워드로 확인할 회사를 좁혀보세요.",
    discoverAction: "기업 검색 시작",
    guruTitle: "관점별 분석",
    guruDescription:
      "공개된 질문 원칙으로 회사나 아이디어의 논리를 점검해 보세요.",
    guruAction: "분석 관점 선택",
    browse: "먼저 둘러볼게요",
  },
  en: {
    eyebrow: "Start your first research",
    heading: "What would you like to check today?",
    intro: "Choose one way to begin. The rest will be here when you need them.",
    primaryLabel: "Simplest start",
    companyTitle: "Analyze a company",
    companyDescription:
      "If you already have a company in mind, start with its name or ticker.",
    companyAction: "Search a company",
    discoverTitle: "Search companies by criteria",
    discoverDescription:
      "Narrow the companies to review through industries, earnings changes, or risk keywords.",
    discoverAction: "Start company search",
    guruTitle: "Perspective analysis",
    guruDescription:
      "Use public question frames to check the reasoning behind an idea or company.",
    guruAction: "Choose a perspective",
    browse: "I'll look around first",
  },
} as const;

export default function FirstResearchChoice({
  locale = DEFAULT_LOCALE,
  onStartCompany,
  onDismiss,
}: FirstResearchChoiceProps) {
  const copy = copyByLocale[locale];

  function trackChoice(choice: ChoiceId) {
    trackClientEventSilently("cta_clicked", {
      cta_id: `first_research_${choice}`,
      surface: "companies_onboarding",
    });
  }

  function handleCompanyStart() {
    trackChoice("company");
    onStartCompany();
  }

  function handleNavigation(choice: ChoiceId) {
    return () => {
      trackChoice(choice);
      onDismiss();
    };
  }

  return (
    <section
      aria-labelledby="first-research-heading"
      className="border-b border-hairline pb-6 sm:pb-7"
    >
      <div className="max-w-3xl">
        <p className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] leading-5 text-primary">
          {copy.eyebrow}
        </p>
        <h1
          id="first-research-heading"
          className="mt-2 text-balance text-[30px] font-black leading-[1.08] tracking-normal text-ink sm:text-[40px]"
        >
          {copy.heading}
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-6 text-body sm:text-[16px]">
          {copy.intro}
        </p>
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        <button
          type="button"
          onClick={handleCompanyStart}
          className="group relative flex min-h-[184px] flex-col rounded-[10px] border border-primary bg-canvas p-4 text-left shadow-[0_0_0_1px_rgba(0,62,199,0.08)] transition-colors duration-150 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <span className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-primary">
            {copy.primaryLabel}
          </span>
          <span className="mt-4 text-[18px] font-black leading-6 text-ink">
            {copy.companyTitle}
          </span>
          <span className="mt-2 text-[13px] font-semibold leading-5 text-body">
            {copy.companyDescription}
          </span>
          <span className="mt-auto pt-5 text-[13px] font-black text-primary">
            {copy.companyAction}
            <span
              aria-hidden="true"
              className="ml-2 transition-transform duration-150 group-hover:translate-x-0.5"
            >
              →
            </span>
          </span>
        </button>

        <Link
          href="/discover?entry=onboarding"
          onClick={handleNavigation("discover")}
          className="group flex min-h-[184px] flex-col rounded-[10px] border border-hairline bg-canvas p-4 transition-colors duration-150 hover:border-outline hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <span className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-muted">
            02
          </span>
          <span className="mt-4 text-[18px] font-black leading-6 text-ink">
            {copy.discoverTitle}
          </span>
          <span className="mt-2 text-[13px] font-semibold leading-5 text-body">
            {copy.discoverDescription}
          </span>
          <span className="mt-auto pt-5 text-[13px] font-black text-ink group-hover:text-primary">
            {copy.discoverAction}
            <span
              aria-hidden="true"
              className="ml-2 transition-transform duration-150 group-hover:translate-x-0.5"
            >
              →
            </span>
          </span>
        </Link>

        <Link
          href="/guru?entry=onboarding"
          onClick={handleNavigation("guru")}
          className="group flex min-h-[184px] flex-col rounded-[10px] border border-hairline bg-canvas p-4 transition-colors duration-150 hover:border-outline hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <span className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-muted">
            03
          </span>
          <span className="mt-4 text-[18px] font-black leading-6 text-ink">
            {copy.guruTitle}
          </span>
          <span className="mt-2 text-[13px] font-semibold leading-5 text-body">
            {copy.guruDescription}
          </span>
          <span className="mt-auto pt-5 text-[13px] font-black text-ink group-hover:text-primary">
            {copy.guruAction}
            <span
              aria-hidden="true"
              className="ml-2 transition-transform duration-150 group-hover:translate-x-0.5"
            >
              →
            </span>
          </span>
        </Link>
      </div>

      <button
        type="button"
        onClick={() => {
          trackChoice("browse");
          onDismiss();
        }}
        className="mt-4 text-[13px] font-bold text-muted underline decoration-hairline underline-offset-4 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {copy.browse}
      </button>
    </section>
  );
}
