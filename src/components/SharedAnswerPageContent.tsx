import { KrwBrand } from "@/components/KrwBrand";
import MessageAttachments from "@/components/MessageAttachments";
import ResearchMarkdown from "@/components/ResearchMarkdown";
import SharePageEvents from "@/components/SharePageEvents";
import ShareStartLink from "@/components/ShareStartLink";
import type { Locale } from "@/i18n/config";
import type { PublicMessageShare } from "@/lib/share/message-share";

const copy = {
  ko: {
    brandAria: "회사 목록으로 이동",
    questionAria: "공유된 질문",
    questionLabel: "질문",
    answerAria: "공유된 답변 본문",
    answerLabel: "답변",
    footer: "다른 기업이나 궁금한 점을 공시 기반으로 직접 확인해보세요.",
    cta: "다른 질문도 분석 시작",
  },
  en: {
    brandAria: "Go to companies",
    questionAria: "Shared question",
    questionLabel: "Question",
    answerAria: "Shared answer",
    answerLabel: "Answer",
    footer: "Ask another filing-grounded question.",
    cta: "Start another analysis",
  },
} satisfies Record<Locale, Record<string, string>>;

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
  const startHref = "/";

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
            {strings.footer}
          </p>
          <ShareStartLink
            href={startHref}
            location="bottom"
            hasQuestion={hasQuestion}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-[8px] bg-surface-dark px-5 py-3 text-[15px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas sm:w-auto"
          >
            {strings.cta}
          </ShareStartLink>
        </div>
      </footer>
    </div>
  );
}
