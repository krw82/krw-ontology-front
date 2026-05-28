import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import PublicTopNav from "@/components/PublicTopNav";
import QuestionChainGraph from "@/components/QuestionChainGraph";
import {
  absoluteUrl,
  buildQuestionChatHref,
  findQuestionTopic,
  pageMetadata,
  QUESTION_TOPIC_PAGES,
  SITE_NAME,
  type QuestionTopicPage,
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
      title: "질문 그래프를 찾지 못했습니다",
      description: "현재 제공하지 않는 기업 리서치 질문 그래프입니다.",
      path: `/questions/${slug}`,
      noIndex: true,
    });
  }

  return pageMetadata({
    title: `${topic.shortTitle} 질문 그래프`,
    description: topic.description,
    path: `/questions/${topic.slug}`,
    noIndex: true,
  });
}

export default async function QuestionTopicPage({
  params,
}: QuestionPageProps) {
  const { topic: slug } = await params;
  const topic = findQuestionTopic(slug);

  if (!topic) notFound();

  const relatedTopics = topic.relatedQuestionSlugs
    .map(findQuestionTopic)
    .filter((item): item is QuestionTopicPage => Boolean(item));
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${topic.shortTitle} Apple 질문 체인`,
    url: absoluteUrl(`/questions/${topic.slug}`),
    description: topic.questionChain.description,
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: absoluteUrl("/"),
    },
    mainEntity: {
      "@type": "ItemList",
      name: `${topic.questionChain.companyName} 질문 체인`,
      itemListElement: topic.questionChain.stages.flatMap((stage) =>
        stage.nodes.map((node, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: node.question,
        })),
      ),
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
        <div className="mx-auto w-full max-w-6xl">
          <nav className="mb-6 text-[13px] font-bold leading-5 text-muted">
            <Link href="/" className="hover:text-primary">
              홈
            </Link>
            <span className="mx-2 text-outline-variant">/</span>
            <span className="text-ink">{topic.shortTitle}</span>
          </nav>

          <header className="border-b border-hairline pb-8">
            <p className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
              {topic.category} · AAPL
            </p>
            <h1 className="mt-3 max-w-4xl text-balance text-[34px] font-black leading-[1.08] tracking-normal text-ink sm:text-[48px]">
              {topic.shortTitle}을 Apple 질문 체인으로 보기
            </h1>
            <p className="mt-4 max-w-3xl text-[16px] leading-7 text-body sm:text-[18px]">
              추상적인 질문 하나로 바로 보내지 않고, Apple의 사업 구조에서
              시작해 다음 질문으로 좁혀갑니다. 그래프의 첫 노드를 누르면 그
              질문으로 채팅을 시작합니다.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                href={buildQuestionChatHref(topic, {
                  ticker: topic.questionChain.ticker,
                  question: topic.questionChain.primaryQuestion,
                })}
                className="inline-flex min-h-12 items-center justify-center rounded-[8px] bg-surface-dark px-5 py-3 text-[15px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                Apple 질문 체인 시작
              </Link>
            </div>
          </header>

          <div className="py-8">
            <QuestionChainGraph topic={topic} />
          </div>

          <section className="border-t border-hairline py-8">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
                  Continue
                </p>
                <h2 className="mt-2 text-[22px] font-black leading-7 text-ink">
                  이어서 볼 질문과 흐름
                </h2>
              </div>
              <Link
                href="/questions"
                className="text-[13px] font-extrabold leading-5 text-primary hover:text-primary-active"
              >
                질문 그래프 전체 보기
              </Link>
            </div>
            <div className="mt-4 grid gap-sm sm:grid-cols-2 lg:grid-cols-3">
              {(relatedTopics.length > 0
                ? relatedTopics
                : QUESTION_TOPIC_PAGES.filter((item) => item.slug !== topic.slug)
              )
                .slice(0, 3)
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
                    Apple 질문 그래프로 이어서 확인합니다.
                  </p>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
