import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import PublicRelatedLinks from "@/components/PublicRelatedLinks";
import PublicTopNav from "@/components/PublicTopNav";
import {
  absoluteUrl,
  findQuestionTopic,
  pageMetadata,
  QUESTION_TOPIC_PAGES,
  SITE_NAME,
} from "@/lib/marketing/site";

type QuestionPageProps = {
  params: Promise<{ topic: string }>;
};

export function generateStaticParams() {
  return QUESTION_TOPIC_PAGES.map((topic) => ({ topic: topic.slug }));
}

export async function generateMetadata({
  params,
}: QuestionPageProps): Promise<Metadata> {
  const { topic: slug } = await params;
  const topic = findQuestionTopic(slug);

  if (!topic) {
    return pageMetadata({
      title: "질문 템플릿을 찾지 못했습니다",
      description: "현재 제공하지 않는 기업 리서치 질문 템플릿입니다.",
      path: `/questions/${slug}`,
      noIndex: true,
    });
  }

  return pageMetadata({
    title: `${topic.shortTitle} 질문 템플릿`,
    description: topic.description,
    path: `/questions/${topic.slug}`,
  });
}

export default async function QuestionTopicPage({
  params,
}: QuestionPageProps) {
  const { topic: slug } = await params;
  const topic = findQuestionTopic(slug);

  if (!topic) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    name: `${topic.shortTitle} 기업 리서치 질문`,
    url: absoluteUrl(`/questions/${topic.slug}`),
    mainEntity: [
      {
        "@type": "Question",
        name: topic.title,
        acceptedAnswer: {
          "@type": "Answer",
          text: topic.answerBlocks.join(" "),
        },
      },
    ],
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: absoluteUrl("/"),
    },
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas text-ink">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PublicTopNav />
      <main
        id="main-content"
        className="min-h-0 flex-1 overflow-y-auto px-base pb-[112px] pt-xl sm:px-md md:px-xl md:pb-[96px] md:pt-[72px]"
      >
        <div className="mx-auto w-full max-w-5xl">
          <nav className="mb-6 text-[13px] font-bold leading-5 text-muted">
            <Link href="/" className="hover:text-primary">
              홈
            </Link>
            <span className="mx-2 text-outline-variant">/</span>
            <span className="text-ink">{topic.shortTitle}</span>
          </nav>

          <header className="border-b border-hairline pb-8">
            <p className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
              {topic.category}
            </p>
            <h1 className="mt-3 max-w-4xl text-balance text-[34px] font-black leading-[1.08] tracking-normal text-ink sm:text-[48px]">
              {topic.title}
            </h1>
            <p className="mt-4 max-w-3xl text-[16px] leading-7 text-body sm:text-[18px]">
              {topic.description}
            </p>
            <div className="mt-6">
              <Link
                href={`/chat?query=${encodeURIComponent(topic.question)}`}
                className="inline-flex min-h-12 items-center justify-center rounded-[8px] bg-surface-dark px-5 py-3 text-[15px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                이 질문 입력하기
              </Link>
            </div>
          </header>

          <section className="grid gap-8 py-8 md:grid-cols-[minmax(0,1fr)_320px]">
            <article>
              <h2 className="text-[22px] font-black leading-7 text-ink">
                이 질문으로 확인하는 것
              </h2>
              <div className="mt-4 space-y-4 text-[15px] leading-7 text-body sm:text-[16px]">
                {topic.answerBlocks.map((block) => (
                  <p key={block}>{block}</p>
                ))}
              </div>
            </article>

            <aside className="rounded-[8px] border border-hairline bg-surface p-base">
              <h2 className="text-[16px] font-black leading-6 text-ink">
                예시 회사
              </h2>
              <div className="mt-4 flex flex-wrap gap-xs">
                {topic.exampleTickers.map((ticker) => (
                  <Link
                    key={ticker}
                    href={`/chat?ticker=${ticker}&query=${encodeURIComponent(topic.question)}`}
                    className="rounded-[8px] border border-hairline bg-canvas px-sm py-xs font-mono text-[13px] font-black leading-5 text-ink transition-colors hover:border-primary hover:text-primary"
                  >
                    {ticker}
                  </Link>
                ))}
              </div>
            </aside>
          </section>

          <section className="border-t border-hairline py-8">
            <h2 className="text-[22px] font-black leading-7 text-ink">
              다른 질문 템플릿
            </h2>
            <div className="mt-4 grid gap-sm sm:grid-cols-2 lg:grid-cols-3">
              {QUESTION_TOPIC_PAGES.filter((item) => item.slug !== topic.slug)
                .slice(0, 5)
                .map((item) => (
                  <Link
                    key={item.slug}
                    href={`/questions/${item.slug}`}
                    className="rounded-[8px] border border-hairline bg-canvas p-sm transition-colors hover:border-primary hover:bg-surface"
                  >
                    <p className="text-[14px] font-extrabold leading-5 text-ink">
                      {item.shortTitle}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-5 text-muted">
                      {item.description}
                    </p>
                  </Link>
                ))}
            </div>
          </section>

          <PublicRelatedLinks currentPath={`/questions/${topic.slug}`} />
        </div>
      </main>
    </div>
  );
}
