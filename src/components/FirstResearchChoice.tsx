"use client";

import { trackClientEventSilently } from "@/lib/analytics/client";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";

interface FirstResearchChoiceProps {
  locale?: Locale;
  onStartCompany: () => void;
  onDismiss: () => void;
}

type ChoiceId = "company" | "browse";

const copyByLocale = {
  ko: {
    eyebrow: "첫 판단 만들기",
    heading: "회사 한 곳부터 판단해볼까요?",
    intro:
      "처음부터 여러 기능을 고를 필요는 없습니다. 회사 한 곳을 정하면 새 공시의 변화와 근거를 보고, 내 판단과 다음 행동까지 남길 수 있어요.",
    primaryLabel: "1개 회사로 시작",
    companyTitle: "확인할 회사 선택",
    companyDescription:
      "티커나 회사명으로 한 곳을 찾으세요. 선택한 회사는 커버리지에 담아 계속 이어서 볼 수 있습니다.",
    companyAction: "첫 회사 찾기",
    steps: ["무엇이 변했는지 확인", "SEC 원문 근거 확인", "내 판단과 다음 행동 기록"],
    browse: "먼저 둘러볼게요",
  },
  en: {
    eyebrow: "Make your first judgment",
    heading: "Start with one company",
    intro:
      "You do not need to choose among every tool. Pick one company, review what changed and its source, then record your judgment and next action.",
    primaryLabel: "Start with one company",
    companyTitle: "Choose a company to review",
    companyDescription:
      "Find one by ticker or name. It will stay in Coverage so you can continue from the next relevant event.",
    companyAction: "Find my first company",
    steps: ["See what changed", "Check the SEC source", "Record judgment and next action"],
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

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)] lg:items-stretch">
        <button
          type="button"
          onClick={handleCompanyStart}
          className="group relative flex min-h-[212px] flex-col rounded-[12px] border border-primary bg-primary-fixed/20 p-5 text-left shadow-[0_10px_30px_rgba(0,62,199,0.08)] transition-colors duration-150 hover:bg-primary-fixed/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
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
        <ol className="grid content-center gap-3 rounded-[12px] border border-hairline bg-surface-soft p-5" aria-label={locale === "ko" ? "첫 판단 과정" : "First judgment flow"}>
          {copy.steps.map((step, index) => (
            <li key={step} className="flex items-center gap-3 text-[13px] font-extrabold leading-5 text-body">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-canvas font-mono text-[11px] font-black text-primary shadow-sm" aria-hidden="true">
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
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
