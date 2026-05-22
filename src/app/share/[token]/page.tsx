import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { KrwBrand } from "@/components/KrwBrand";
import ResearchMarkdown from "@/components/ResearchMarkdown";
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

  return (
    <div className="min-h-[100dvh] bg-canvas text-on-surface">
      <header className="sticky top-0 z-40 border-b border-hairline bg-canvas/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-4xl items-center justify-between gap-base px-base sm:px-xl">
          <KrwBrand compact />
          <Link
            href="/"
            className="rounded-[8px] border border-hairline px-3 py-2 text-[13px] font-bold leading-none text-body transition-colors hover:border-primary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            열기
          </Link>
        </div>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-4xl px-base py-xl sm:px-xl sm:py-xxl">
        <div className="mb-lg flex flex-wrap items-center gap-xs text-[12px] font-bold leading-none text-muted">
          <span className="rounded-[8px] border border-hairline bg-surface px-2 py-1">
            공유된 답변
          </span>
          {tickers.map((ticker) => (
            <span
              key={ticker}
              className="rounded-[8px] border border-hairline bg-surface px-2 py-1 font-mono text-primary"
            >
              {ticker}
            </span>
          ))}
          {answerTime ? <time dateTime={share.answer_created_at}>{answerTime}</time> : null}
        </div>

        <article className="pb-xxl">
          <ResearchMarkdown content={share.answer_content} />
        </article>
      </main>
    </div>
  );
}
