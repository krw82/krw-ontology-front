import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import PublicTopNav from "@/components/PublicTopNav";
import QuestionChainGraph from "@/components/QuestionChainGraph";
import {
  getQuestionTopicDisplay,
  getQuestionTopicDisplayList,
} from "@/content/questions/display";
import { SUPPORTED_LOCALES, isLocale, type Locale } from "@/i18n/config";
import { localizedPageMetadata } from "@/i18n/metadata";
import { localizedPath } from "@/i18n/routing";
import {
  absoluteUrl,
  buildQuestionChatHref,
  findQuestionTopic,
  QUESTION_TOPIC_PAGES,
  SITE_NAME,
  type QuestionTopicPage,
} from "@/lib/marketing/site";
import { getCspNonce } from "@/lib/security/csp-nonce";

type QuestionPageProps = {
  params: Promise<{ locale: string; topic: string }>;
};

export function generateStaticParams() {
  return SUPPORTED_LOCALES.flatMap((locale) =>
    QUESTION_TOPIC_PAGES.map((topic) => ({ locale, topic: topic.slug })),
  );
}

const questionTopicCopy = {
  ko: {
    home: "홈",
    notFoundTitle: "질문 그래프를 찾지 못했습니다",
    notFoundDescription: "현재 제공하지 않는 기업 리서치 질문 그래프입니다.",
    headingSuffix: "을 Apple 질문 체인으로 보기",
    intro:
      "추상적인 질문 하나로 바로 보내지 않고, Apple의 사업 구조에서 시작해 다음 질문으로 좁혀갑니다. 그래프의 첫 노드를 누르면 그 질문으로 채팅을 시작합니다.",
    start: "Apple 질문 체인 시작",
    continueEyebrow: "Continue",
    continueHeading: "이어서 볼 질문과 흐름",
    allQuestions: "질문 그래프 전체 보기",
    relatedDescription: "Apple 질문 그래프로 이어서 확인합니다.",
  },
  en: {
    home: "Home",
    notFoundTitle: "Question graph not found",
    notFoundDescription: "This company research question graph is not available.",
    headingSuffix: " as an Apple question chain",
    intro:
      "Instead of sending one abstract prompt directly to chat, this graph starts from Apple's business structure and narrows into follow-up questions. Select the first node to start that question in chat.",
    start: "Start Apple question chain",
    continueEyebrow: "Continue",
    continueHeading: "Related questions and flows",
    allQuestions: "View all question graphs",
    relatedDescription: "Continue with another Apple question graph.",
  },
} satisfies Record<Locale, Record<string, string>>;

export async function generateMetadata({
  params,
}: QuestionPageProps): Promise<Metadata> {
  const { locale, topic: slug } = await params;
  if (!isLocale(locale)) notFound();

  const topic = findQuestionTopic(slug);

  if (!topic) {
    return localizedPageMetadata({
      locale,
      title: questionTopicCopy[locale].notFoundTitle,
      description: questionTopicCopy[locale].notFoundDescription,
      path: `/questions/${slug}`,
      noIndex: true,
    });
  }
  const displayTopic = getQuestionTopicDisplay(locale, topic);

  return localizedPageMetadata({
    locale,
    title:
      locale === "ko"
        ? `${displayTopic.shortTitle} 질문 그래프`
        : `${displayTopic.shortTitle} question graph`,
    description: displayTopic.description,
    path: `/questions/${topic.slug}`,
    noIndex: true,
  });
}

export default async function QuestionTopicPage({
  params,
}: QuestionPageProps) {
  const nonce = await getCspNonce();
  const { locale, topic: slug } = await params;
  if (!isLocale(locale)) notFound();

  const copy = questionTopicCopy[locale];
  const topic = findQuestionTopic(slug);

  if (!topic) notFound();
  const displayTopic = getQuestionTopicDisplay(locale, topic);

  const relatedTopics = topic.relatedQuestionSlugs
    .map(findQuestionTopic)
    .filter((item): item is QuestionTopicPage => Boolean(item));
  const displayRelatedTopics = relatedTopics.map((item) =>
    getQuestionTopicDisplay(locale, item),
  );
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name:
      locale === "ko"
        ? `${displayTopic.shortTitle} Apple 질문 체인`
        : `${displayTopic.shortTitle} Apple question chain`,
    url: absoluteUrl(localizedPath(locale, `/questions/${topic.slug}`)),
    description: displayTopic.questionChain.description,
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: absoluteUrl(localizedPath(locale)),
    },
    mainEntity: {
      "@type": "ItemList",
      name:
        locale === "ko"
          ? `${displayTopic.questionChain.companyName} 질문 체인`
          : `${displayTopic.questionChain.companyName} question chain`,
      itemListElement: displayTopic.questionChain.stages.flatMap((stage) =>
        stage.nodes.map((node, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: node.question,
        })),
      ),
    },
  };

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <script
        nonce={nonce}
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PublicTopNav locale={locale} />
      <main
        id="main-content"
        className="px-base pb-[112px] pt-xl sm:px-md md:px-xl md:pb-[96px] md:pt-[72px]"
      >
        <div className="mx-auto w-full max-w-6xl">
          <nav className="mb-6 text-[13px] font-bold leading-5 text-muted">
            <Link href={localizedPath(locale)} className="hover:text-primary">
              {copy.home}
            </Link>
            <span className="mx-2 text-outline-variant">/</span>
            <span className="text-ink">{topic.shortTitle}</span>
          </nav>

          <header className="border-b border-hairline pb-8">
            <p className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
              {displayTopic.category} · AAPL
            </p>
            <h1 className="mt-3 max-w-4xl text-balance text-[34px] font-black leading-[1.08] tracking-normal text-ink sm:text-[48px]">
              {locale === "ko"
                ? `${displayTopic.shortTitle}${copy.headingSuffix}`
                : `${displayTopic.shortTitle}${copy.headingSuffix}`}
            </h1>
            <p className="mt-4 max-w-3xl text-[16px] leading-7 text-body sm:text-[18px]">
              {copy.intro}
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                href={buildQuestionChatHref(topic, {
                  ticker: topic.questionChain.ticker,
                  question: topic.questionChain.primaryQuestion,
                })}
                className="inline-flex min-h-12 items-center justify-center rounded-[8px] bg-surface-dark px-5 py-3 text-[15px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                {copy.start}
              </Link>
            </div>
          </header>

          <div className="py-8">
            <QuestionChainGraph topic={topic} displayTopic={displayTopic} />
          </div>

          <section className="border-t border-hairline py-8">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
                  {copy.continueEyebrow}
                </p>
                <h2 className="mt-2 text-[22px] font-black leading-7 text-ink">
                  {copy.continueHeading}
                </h2>
              </div>
              <Link
                href={localizedPath(locale, "/questions")}
                className="text-[13px] font-extrabold leading-5 text-primary hover:text-primary-active"
              >
                {copy.allQuestions}
              </Link>
            </div>
            <div className="mt-4 grid gap-sm sm:grid-cols-2 lg:grid-cols-3">
              {(displayRelatedTopics.length > 0
                ? displayRelatedTopics
                : getQuestionTopicDisplayList(
                    locale,
                    QUESTION_TOPIC_PAGES.filter((item) => item.slug !== topic.slug),
                  )
              )
                .slice(0, 3)
                .map((item) => (
                  <Link
                    key={item.slug}
                    href={localizedPath(locale, `/questions/${item.slug}`)}
                  className="rounded-[8px] border border-hairline bg-canvas p-sm transition-colors hover:border-primary hover:bg-surface"
                >
                  <p className="text-[14px] font-extrabold leading-5 text-ink">
                    {item.shortTitle}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-5 text-muted">
                    {copy.relatedDescription}
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
