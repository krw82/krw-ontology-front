import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KrwBrand } from "@/components/KrwBrand";
import ResearchMarkdown from "@/components/ResearchMarkdown";
import SharePageEvents from "@/components/SharePageEvents";
import ShareStartLink from "@/components/ShareStartLink";
import { findPublicMessageShare } from "@/lib/share/message-share";

export const dynamic = "force-dynamic";

const tokenPattern = /^[A-Za-z0-9_-]{16,80}$/;

async function getShare(token: string) {
  if (!tokenPattern.test(token)) return null;
  return findPublicMessageShare(token);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const share = await getShare(token);

  if (!share) {
    return {
      title: "공유 답변을 찾지 못했습니다 | KRW Ontology",
    };
  }

  return {
    title: `${share.title} | KRW Ontology`,
    description: "KRW Ontology에서 공유된 리서치 답변입니다.",
  };
}

export default async function SharedAnswerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const share = await getShare(token);

  if (!share) notFound();

  const tickers = share.tickers?.filter(Boolean) ?? [];
  const hasQuestion = Boolean(share.question_content);
  const answerIndex = hasQuestion ? "02" : "01";
  const startHref = "/chat";

  return (
    <div className="min-h-[100dvh] bg-canvas pb-[112px] text-on-surface">
      <header className="sticky top-0 z-40 border-b border-hairline bg-canvas/90 backdrop-blur-xl">
        <div className="mx-auto flex h-20 w-full max-w-7xl items-center px-base sm:px-xl lg:px-8">
          <KrwBrand compact />
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto w-full max-w-5xl px-base py-xl sm:px-xl sm:py-xxl"
      >
        <div className="space-y-xxl">
          {share.question_content ? (
            <section
              aria-label="공유된 질문"
              className="grid gap-md sm:grid-cols-[96px_minmax(0,1fr)]"
            >
              <div className="font-mono text-[12px] font-black uppercase leading-5 tracking-[0.16em] text-primary">
                01 질문
              </div>
              <div className="border-l-2 border-primary-container pl-md text-ink">
                <p className="whitespace-pre-wrap break-words text-[18px] font-extrabold leading-[1.55] sm:text-[22px] sm:leading-[1.45]">
                  {share.question_content}
                </p>
              </div>
            </section>
          ) : null}

          <section
            aria-label="공유된 답변 본문"
            className="grid gap-md sm:grid-cols-[96px_minmax(0,1fr)]"
          >
            <div className="font-mono text-[12px] font-black uppercase leading-5 tracking-[0.16em] text-primary">
              {answerIndex} 답변
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
            다른 기업이나 궁금한 점을 공시 기반으로 직접 확인해보세요.
          </p>
          <ShareStartLink
            href={startHref}
            location="bottom"
            hasQuestion={hasQuestion}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-[8px] bg-surface-dark px-5 py-3 text-[15px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas sm:w-auto"
          >
            다른 질문도 분석 시작
          </ShareStartLink>
        </div>
      </footer>
    </div>
  );
}
