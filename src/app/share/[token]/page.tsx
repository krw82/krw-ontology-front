import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KrwBrand, KrwMark } from "@/components/KrwBrand";
import ResearchMarkdown from "@/components/ResearchMarkdown";
import SharePageEvents from "@/components/SharePageEvents";
import ShareStartLink from "@/components/ShareStartLink";
import { findPublicMessageShare } from "@/lib/share/message-share";

export const dynamic = "force-dynamic";

const tokenPattern = /^[A-Za-z0-9_-]{16,80}$/;

function formatShareTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

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

  const answerTime = formatShareTime(share.answer_created_at);
  const tickers = share.tickers?.filter(Boolean) ?? [];
  const hasQuestion = Boolean(share.question_content);
  const answerIndex = hasQuestion ? "02" : "01";
  const startHref = "/chat";

  return (
    <div className="min-h-[100dvh] bg-canvas pb-[112px] text-on-surface">
      <header className="sticky top-0 z-40 border-b border-hairline bg-canvas/90 backdrop-blur-xl">
        <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between gap-base px-base sm:px-xl lg:px-8">
          <KrwBrand compact />
          <ShareStartLink
            href={startHref}
            location="header"
            hasQuestion={hasQuestion}
            className="rounded-[8px] border border-hairline px-3 py-2 text-[13px] font-bold leading-none text-body transition-colors hover:border-primary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            분석 시작
          </ShareStartLink>
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto w-full max-w-5xl px-base py-xl sm:px-xl sm:py-xxl"
      >
        <section className="border-b border-hairline pb-xl">
          <div className="grid gap-lg lg:grid-cols-[minmax(0,1fr)_280px] lg:items-end">
            <div className="min-w-0">
              <p className="font-mono text-[12px] font-black uppercase leading-5 tracking-[0.16em] text-primary">
                공유된 리서치
              </p>
              <h1 className="mt-sm max-w-3xl break-keep text-balance text-[34px] font-black leading-[1.08] tracking-normal text-ink sm:text-[48px]">
                공유된 공시 기반 답변입니다.
              </h1>
              <p className="mt-md max-w-2xl text-[15px] font-medium leading-7 text-body sm:text-[16px]">
                이 링크는 공유자가 선택한 답변 1개만 보여줍니다. 전체 대화와
                계정 정보는 공개되지 않습니다.
              </p>
            </div>

            <dl className="divide-y divide-hairline border-y border-hairline text-[12px] leading-5 lg:border-y-0 lg:border-l lg:pl-lg">
              <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-sm py-sm">
                <dt className="font-mono font-black uppercase tracking-[0.12em] text-muted">
                  범위
                </dt>
                <dd className="font-bold text-ink">이 답변만 공개됨</dd>
              </div>
              {answerTime ? (
                <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-sm py-sm">
                  <dt className="font-mono font-black uppercase tracking-[0.12em] text-muted">
                    시각
                  </dt>
                  <dd className="font-semibold text-body">
                    <time dateTime={share.answer_created_at}>{answerTime}</time>
                  </dd>
                </div>
              ) : null}
              {tickers.length > 0 ? (
                <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-sm py-sm">
                  <dt className="font-mono font-black uppercase tracking-[0.12em] text-muted">
                    티커
                  </dt>
                  <dd className="flex flex-wrap gap-xs">
                    {tickers.map((ticker) => (
                      <span
                        key={ticker}
                        className="font-mono font-black text-primary"
                      >
                        {ticker}
                      </span>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </section>

        <div className="mt-xl space-y-xxl">
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
              <div className="mb-lg flex items-center gap-sm border-b border-hairline pb-sm text-[13px] font-bold leading-none text-muted">
                <KrwMark className="h-8 w-8 shrink-0" />
                <span>KRW Ontology</span>
                <span className="hidden h-1 w-1 rounded-full bg-outline-variant sm:block" />
                <span className="hidden text-muted-soft sm:inline">
                  공시 기반 답변
                </span>
              </div>
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
            className="inline-flex min-h-11 items-center justify-center rounded-[8px] bg-primary px-lg py-sm text-[14px] font-black leading-none text-on-primary transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            다른 질문도 분석 시작
          </ShareStartLink>
        </div>
      </footer>
    </div>
  );
}
