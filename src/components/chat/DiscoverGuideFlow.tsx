"use client";

import { AnimatePresence, motion } from "motion/react";

import type { DiscoverGuideStep } from "@/lib/chat/discover-guide";

export type DiscoverGuideFlowProps = {
  locale: string;
  step: DiscoverGuideStep;
  disabled?: boolean;
  urlValue: string;
  urlError?: string | null;
  ideaValue: string;
  ideaError?: string | null;
  onUrlValueChange: (value: string) => void;
  onCommitUrl: () => void;
  onSkipUrl: () => void;
  onAddFile: () => void;
  onSkipFile: () => void;
  onIdeaValueChange: (value: string) => void;
  onSubmitIdea: () => void;
  onSelectExample: (prompt: string) => void;
};

export default function DiscoverGuideFlow({
  locale,
  step,
  disabled = false,
  urlValue,
  urlError,
  ideaValue,
  ideaError,
  onUrlValueChange,
  onCommitUrl,
  onSkipUrl,
  onAddFile,
  onSkipFile,
  onIdeaValueChange,
  onSubmitIdea,
  onSelectExample,
}: DiscoverGuideFlowProps) {
  const isKo = locale === "ko";
  const stepOrder: DiscoverGuideStep[] = ["url", "file", "idea"];
  const activeIndex = stepOrder.indexOf(step);
  const examples = isKo
    ? [
        "AI 데이터센터 전력 수요 수혜 기업 중 FCF로 CapEx를 버티는 후보 3개만 찾아줘.",
        "클라우드 소프트웨어 기업 중 RPO와 구독 매출이 함께 늘어나는 후보 3개만 찾아줘.",
        "반도체 공급망 기업 중 AI 매출 노출은 크고 재고 부담은 낮은 후보 3개만 찾아줘.",
      ]
    : [
        "Find 3 AI data-center power beneficiaries that can fund CapEx with FCF.",
        "Find 3 cloud software companies where RPO and subscription revenue are both growing.",
        "Find 3 semiconductor supply-chain companies with high AI revenue exposure and lower inventory risk.",
      ];
  const copy = {
    url: isKo
      ? {
          eyebrow: "선택사항",
          title: "참고할 URL이 있나요?",
          description:
            "뉴스나 리포트 링크가 있으면 먼저 시장 맥락을 잡습니다. 없어도 바로 넘어갈 수 있습니다.",
          primary: "다음",
          secondary: "건너뛰기",
          urlPlaceholder: "https://example.com/report",
        }
      : {
          eyebrow: "Optional",
          title: "Do you have a URL to reference?",
          description:
            "Add a news or report link to set market context first. You can skip this.",
          primary: "Next",
          secondary: "Skip",
          urlPlaceholder: "https://example.com/report",
        },
    file: isKo
      ? {
          eyebrow: "선택사항",
          title: "첨부할 파일이 있나요?",
          description:
            "PDF, txt, md 문서를 질문과 함께 보낼 수 있습니다. 없으면 다음으로 넘어가세요.",
          primary: "파일 선택하기",
          secondary: "건너뛰기",
          fileHint: "선택이 완료되면 다음 단계로 이동합니다.",
        }
      : {
          eyebrow: "Optional",
          title: "Do you have a file to attach?",
          description:
            "Attach PDF, txt, or md documents with the question, or skip this step.",
          primary: "Choose file",
          secondary: "Skip",
          fileHint: "The flow continues after a file is selected.",
        },
    idea: isKo
      ? {
          eyebrow: "시작",
          title: "어떤 아이디어로 종목을 발굴할까요?",
          description:
            "산업, 변화, 리스크, 재무 조건을 한 문장으로 적으면 관련 회사를 넓게 찾아봅니다.",
          primary: "종목 발굴 시작",
          secondary: "예시",
          ideaPlaceholder: "예: AI 데이터센터 수혜지만 부채 부담이 낮은 기업",
        }
      : {
          eyebrow: "Start",
          title: "What idea should we use to discover stocks?",
          description:
            "Describe an industry, shift, risk, or financial condition and we will explore related companies.",
          primary: "Start discovery",
          secondary: "Examples",
          ideaPlaceholder: "e.g. AI data-center beneficiaries with lower debt burden",
        },
  }[step];

  const handlePrimary = () => {
    if (step === "url") {
      onCommitUrl();
      return;
    }
    if (step === "file") {
      onAddFile();
      return;
    }
    onSubmitIdea();
  };
  const handleSecondary = () => {
    if (step === "url") {
      onSkipUrl();
      return;
    }
    if (step === "file") {
      onSkipFile();
      return;
    }
    onSubmitIdea();
  };

  return (
    <div className="mx-auto w-full max-w-[38rem] text-left">
      <div
        className="mb-2 grid grid-cols-3 gap-1.5"
        aria-label={isKo ? "종목 발굴 단계" : "Discovery steps"}
      >
        {stepOrder.map((item, index) => (
          <span
            key={item}
            className={[
              "h-1.5 rounded-full transition-colors",
              index <= activeIndex ? "bg-primary" : "bg-surface-dim",
            ].join(" ")}
            aria-hidden="true"
          />
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.section
          key={step}
          className="overflow-hidden rounded-[8px] border border-hairline bg-canvas shadow-[0_18px_48px_rgba(10,11,13,0.08)]"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          <div className="flex items-center justify-between border-b border-hairline px-sm py-2 sm:px-base sm:py-sm">
            <p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-primary">
              {copy.eyebrow}
            </p>
            <p className="font-mono text-[11px] font-black tracking-[0.14em] text-muted">
              {String(activeIndex + 1).padStart(2, "0")} / 03
            </p>
          </div>

          <div className="p-sm sm:p-lg">
            <div className="min-w-0">
              <h3 className="text-[19px] font-black leading-7 text-ink sm:text-[24px] sm:leading-8">
                {copy.title}
              </h3>
              <p className="mt-1.5 text-[14px] font-semibold leading-6 text-body sm:mt-2 sm:text-[15px]">
                {copy.description}
              </p>
            </div>

            {step === "url" ? (
              <div className="mt-sm">
                <label className="sr-only" htmlFor="discover-url-input">
                  {copy.title}
                </label>
                <input
                  id="discover-url-input"
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="h-12 w-full rounded-[8px] border border-hairline bg-surface-soft px-sm text-[15px] font-bold leading-6 text-ink shadow-sm transition-colors placeholder:text-muted focus:border-primary focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/25"
                  placeholder={copy.urlPlaceholder}
                  value={urlValue}
                  onChange={(event) => onUrlValueChange(event.currentTarget.value)}
                  disabled={disabled}
                />
                {urlError ? (
                  <p className="mt-2 text-[12px] font-bold leading-5 text-error">
                    {urlError}
                  </p>
                ) : null}
              </div>
            ) : null}

            {step === "file" ? (
              <div className="mt-sm rounded-[8px] border border-hairline bg-surface-soft px-sm py-xs text-[13px] font-bold leading-5 text-muted">
                {copy.fileHint}
              </div>
            ) : null}

            {step === "idea" ? (
              <div className="mt-sm grid gap-3">
                <label className="sr-only" htmlFor="discover-idea-input">
                  {copy.title}
                </label>
                <textarea
                  id="discover-idea-input"
                  className="min-h-[112px] w-full resize-none rounded-[8px] border border-hairline bg-surface-soft px-sm py-sm text-[16px] font-bold leading-7 text-ink shadow-sm transition-colors placeholder:text-muted focus:border-primary focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/25"
                  placeholder={copy.ideaPlaceholder}
                  value={ideaValue}
                  onChange={(event) => onIdeaValueChange(event.currentTarget.value)}
                  disabled={disabled}
                />
                {ideaError ? (
                  <p className="text-[12px] font-bold leading-5 text-error">
                    {ideaError}
                  </p>
                ) : null}
              </div>
            ) : null}

            {step === "idea" ? (
              <div className="mt-sm grid gap-2">
                <p className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-muted">
                  {copy.secondary}
                </p>
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="group flex min-h-12 w-full items-center justify-between gap-3 rounded-[8px] border border-hairline bg-surface px-sm py-xs text-left text-[14px] font-bold leading-5 text-ink transition-colors hover:border-outline hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-55"
                    onClick={() => onSelectExample(example)}
                    disabled={disabled}
                  >
                    <span className="min-w-0">{example}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <div
              className={[
                "mt-sm grid gap-2",
                step === "idea" ? "" : "sm:grid-cols-[minmax(0,1fr)_auto]",
              ].join(" ")}
            >
              <button
                type="button"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[8px] bg-surface-dark px-5 py-3 text-[15px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-55"
                onClick={handlePrimary}
                disabled={disabled}
              >
                {copy.primary}
              </button>
              {step !== "idea" ? (
                <button
                  type="button"
                  className="inline-flex min-h-12 items-center justify-center rounded-[8px] border border-hairline bg-canvas px-5 py-3 text-[15px] font-extrabold leading-5 text-body transition-colors hover:bg-surface-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-55"
                  onClick={handleSecondary}
                  disabled={disabled}
                >
                  {copy.secondary}
                </button>
              ) : null}
            </div>
          </div>
        </motion.section>
      </AnimatePresence>
    </div>
  );
}
