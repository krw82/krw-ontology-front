import { KrwBrand } from "@/components/KrwBrand";
import MessageAttachments from "@/components/MessageAttachments";
import ResearchMarkdown from "@/components/ResearchMarkdown";
import SharePageEvents from "@/components/SharePageEvents";
import ShareStartLink from "@/components/ShareStartLink";
import type { Locale } from "@/i18n/config";
import { getGuruLens, getGuruLensDisplayName } from "@/lib/guru-lenses";
import type { PublicMessageShare } from "@/lib/share/message-share";

type SharePageCopy = {
  brandAria: string;
  questionAria: string;
  questionLabel: string;
  answerAria: string;
  answerLabel: string;
  footer: string;
  cta: string;
  guruEyebrow: string;
  guruTitle: string;
  guruDescription: (lensName: string) => string;
  guruDisclaimer: string;
  guruFooter: string;
  guruCta: string;
};

const copy = {
  ko: {
    brandAria: "회사 목록으로 이동",
    questionAria: "공유된 질문",
    questionLabel: "질문",
    answerAria: "공유된 답변 본문",
    answerLabel: "답변",
    footer: "다른 회사나 뉴스도 공시 근거로 이어서 확인해보세요.",
    cta: "새 리서치 시작",
    guruEyebrow: "관점별 분석",
    guruTitle: "관점별 분석 답변",
    guruDescription: (lensName: string) =>
      `${lensName} 관점으로 회사와 아이디어를 점검한 공유 리서치입니다.`,
    guruDisclaimer:
      "실제 인물의 조언이 아니라, 공개적으로 알려진 투자 원칙을 바탕으로 만든 AI 렌즈입니다.",
    guruFooter: "다른 회사나 리서치 질문도 공개 원칙으로 점검해보세요.",
    guruCta: "관점별 분석 시작",
  },
  en: {
    brandAria: "Go to companies",
    questionAria: "Shared question",
    questionLabel: "Question",
    answerAria: "Shared answer",
    answerLabel: "Answer",
    footer: "Continue with another stock, news item, or investment question.",
    cta: "Start new research",
    guruEyebrow: "Perspective analysis",
    guruTitle: "Perspective analysis answer",
    guruDescription: (lensName: string) =>
      `A shared research answer using the ${lensName} perspective.`,
    guruDisclaimer:
      "This is an AI lens based on publicly known investing principles, not advice from the real person.",
    guruFooter: "Review another company or research question with public principles.",
    guruCta: "Start perspective analysis",
  },
} satisfies Record<Locale, SharePageCopy>;

interface SharedAnswerPageContentProps {
  share: PublicMessageShare;
  locale: Locale;
}

export default function SharedAnswerPageContent({
  share,
  locale,
}: SharedAnswerPageContentProps) {
  const strings = copy[locale];
  const tickers = share.tickers?.filter(Boolean) ?? [];
  const hasQuestion = Boolean(share.question_content);
  const hasQuestionAttachments =
    share.question_attachments.urls.length > 0 ||
    share.question_attachments.files.length > 0;
  const answerIndex = hasQuestion ? "02" : "01";
  const isGuruShare = share.share_context.run_kind === "guru_advisor";
  const guruLens =
    isGuruShare && share.share_context.guru_lens
      ? getGuruLens(share.share_context.guru_lens)
      : null;
  const guruLensName = guruLens
    ? getGuruLensDisplayName(guruLens, locale)
    : locale === "en"
      ? "guru"
      : "구루";
  const startHref = isGuruShare ? "/guru" : "/";

  return (
    <div className="min-h-[100dvh] bg-canvas pb-[112px] text-on-surface">
      <header className="sticky top-0 z-40 border-b border-hairline bg-canvas/90 backdrop-blur-xl">
        <div className="mx-auto flex h-20 w-full max-w-7xl items-center px-base sm:px-xl lg:px-8">
          <KrwBrand
            compact
            href="/companies"
            ariaLabel={strings.brandAria}
          />
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto w-full max-w-5xl px-base py-xl sm:px-xl sm:py-xxl"
      >
        <div className="space-y-xxl">
          {isGuruShare ? (
            <section className="border-b border-hairline pb-lg">
              <div className="font-mono text-[12px] font-black uppercase leading-5 tracking-[0.16em] text-primary">
                {strings.guruEyebrow}
              </div>
              <h1 className="mt-xs text-[32px] font-black leading-[1.12] tracking-normal text-ink sm:text-[44px]">
                {strings.guruTitle}
              </h1>
              <p className="mt-sm max-w-3xl text-[17px] font-semibold leading-[1.65] text-body sm:text-[19px]">
                {strings.guruDescription(guruLensName)}
              </p>
              <p className="mt-xs max-w-3xl text-[13px] font-semibold leading-[1.55] text-muted">
                {strings.guruDisclaimer}
              </p>
            </section>
          ) : null}

          {share.question_content ? (
            <section
              aria-label={strings.questionAria}
              className="grid gap-md sm:grid-cols-[96px_minmax(0,1fr)]"
            >
              <div className="font-mono text-[12px] font-black uppercase leading-5 tracking-[0.16em] text-primary">
                01 {strings.questionLabel}
              </div>
              <div className="border-l-2 border-primary-container pl-md text-ink">
                {hasQuestionAttachments ? (
                  <MessageAttachments
                    urls={share.question_attachments.urls}
                    files={share.question_attachments.files}
                    align="start"
                    variant="icon"
                    className="mb-sm"
                  />
                ) : null}
                <p className="whitespace-pre-wrap break-words text-[18px] font-extrabold leading-[1.55] sm:text-[22px] sm:leading-[1.45]">
                  {share.question_content}
                </p>
              </div>
            </section>
          ) : null}

          <section
            aria-label={strings.answerAria}
            className="grid gap-md sm:grid-cols-[96px_minmax(0,1fr)]"
          >
            <div className="font-mono text-[12px] font-black uppercase leading-5 tracking-[0.16em] text-primary">
              {answerIndex} {strings.answerLabel}
            </div>
            <div className="min-w-0 text-body">
              <ResearchMarkdown content={share.answer_content} />
            </div>
          </section>
          <SharePageEvents
            hasQuestion={hasQuestion}
            tickerCount={tickers.length}
          />
        </div>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-canvas/95 px-base py-sm backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] font-semibold leading-[1.45] text-body">
            {isGuruShare ? strings.guruFooter : strings.footer}
          </p>
          <ShareStartLink
            href={startHref}
            location="bottom"
            hasQuestion={hasQuestion}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-[8px] bg-surface-dark px-5 py-3 text-[15px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas sm:w-auto"
          >
            {isGuruShare ? strings.guruCta : strings.cta}
          </ShareStartLink>
        </div>
      </footer>
    </div>
  );
}
