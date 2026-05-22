import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import MarketingCtaLink from "@/components/MarketingCtaLink";
import PublicRelatedLinks from "@/components/PublicRelatedLinks";
import PublicTopNav from "@/components/PublicTopNav";
import {
  absoluteUrl,
  findQuestionTopic,
  findUseCase,
  pageMetadata,
  type QuestionTopicPage,
  QUESTION_TOPIC_PAGES,
  SITE_NAME,
  USE_CASE_PAGES,
} from "@/lib/marketing/site";

type UseCasePageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return USE_CASE_PAGES.map((useCase) => ({ slug: useCase.slug }));
}

export async function generateMetadata({
  params,
}: UseCasePageProps): Promise<Metadata> {
  const { slug } = await params;
  const useCase = findUseCase(slug);

  if (!useCase) {
    return pageMetadata({
      title: "유스케이스를 찾지 못했습니다",
      description: "현재 제공하지 않는 기업 리서치 유스케이스입니다.",
      path: `/use-cases/${slug}`,
      noIndex: true,
    });
  }

  return pageMetadata({
    title: `${useCase.shortTitle} 유스케이스`,
    description: useCase.description,
    path: `/use-cases/${useCase.slug}`,
  });
}

export default async function UseCaseLandingPage({
  params,
}: UseCasePageProps) {
  const { slug } = await params;
  const useCase = findUseCase(slug);

  if (!useCase) notFound();

  const relatedQuestions = useCase.relatedQuestionSlugs
    .map(findQuestionTopic)
    .filter((topic): topic is QuestionTopicPage => Boolean(topic));
  const otherUseCases = USE_CASE_PAGES.filter((item) => item.slug !== useCase.slug);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: useCase.title,
    description: useCase.description,
    url: absoluteUrl(`/use-cases/${useCase.slug}`),
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: absoluteUrl("/"),
    },
    mainEntity: {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: useCase.title,
          acceptedAnswer: {
            "@type": "Answer",
            text: `${useCase.description} ${useCase.outcome}`,
          },
        },
      ],
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
            <span className="text-ink">{useCase.shortTitle}</span>
          </nav>

          <header className="border-b border-hairline pb-8">
            <p className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
              유스케이스
            </p>
            <h1 className="mt-3 max-w-4xl text-balance text-[34px] font-black leading-[1.08] tracking-normal text-ink sm:text-[48px]">
              {useCase.title}
            </h1>
            <p className="mt-4 max-w-3xl text-[16px] leading-7 text-body sm:text-[18px]">
              {useCase.description}
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <MarketingCtaLink
                href={`/chat?query=${encodeURIComponent(useCase.primaryQuestion)}`}
                ctaId={`use_case_${useCase.slug}_primary`}
                ctaLabel="이 흐름으로 질문 입력"
                surface="use_case_hero"
                className="inline-flex min-h-12 items-center justify-center rounded-[8px] bg-surface-dark px-5 py-3 text-[15px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                이 흐름으로 질문 입력
              </MarketingCtaLink>
              <MarketingCtaLink
                href="/companies"
                ctaId={`use_case_${useCase.slug}_companies`}
                ctaLabel="지원 회사 보기"
                surface="use_case_hero"
                className="inline-flex min-h-12 items-center justify-center rounded-[8px] border border-hairline bg-canvas px-5 py-3 text-[15px] font-extrabold leading-5 text-ink transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                지원 회사 보기
              </MarketingCtaLink>
            </div>
          </header>

          <section className="grid gap-8 border-b border-hairline py-8 md:grid-cols-[minmax(0,1fr)_320px]">
            <article>
              <h2 className="text-[22px] font-black leading-7 text-ink">
                이 유스케이스가 맞는 상황
              </h2>
              <p className="mt-4 text-[15px] leading-7 text-body sm:text-[16px]">
                {useCase.audience}
              </p>
              <p className="mt-4 text-[15px] leading-7 text-body sm:text-[16px]">
                {useCase.outcome}
              </p>
            </article>

            <aside className="rounded-[8px] border border-hairline bg-surface p-base">
              <h2 className="text-[16px] font-black leading-6 text-ink">
                예시 질문
              </h2>
              <p className="mt-3 text-[14px] font-semibold leading-6 text-body">
                {useCase.primaryQuestion}
              </p>
              <div className="mt-4 flex flex-wrap gap-xs">
                {useCase.exampleTickers.map((ticker) => (
                  <Link
                    key={ticker}
                    href={`/chat?ticker=${ticker}&query=${encodeURIComponent(useCase.primaryQuestion)}`}
                    className="rounded-[8px] border border-hairline bg-canvas px-sm py-xs font-mono text-[13px] font-black leading-5 text-ink transition-colors hover:border-primary hover:text-primary"
                  >
                    {ticker}
                  </Link>
                ))}
              </div>
            </aside>
          </section>

          <section className="border-b border-hairline py-8">
            <h2 className="text-[22px] font-black leading-7 text-ink">
              제품 안에서의 흐름
            </h2>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {useCase.workflowSteps.map((step, index) => (
                <div key={step.title} className="rounded-[8px] border border-hairline bg-canvas p-base">
                  <p className="font-mono text-[12px] font-black leading-5 text-primary">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <h3 className="mt-3 text-[16px] font-black leading-6 text-ink">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-[13px] font-medium leading-6 text-body">
                    {step.body}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-8 py-8 md:grid-cols-[minmax(0,1fr)_320px]">
            <article>
              <h2 className="text-[22px] font-black leading-7 text-ink">
                확인 가능한 가치
              </h2>
              <ul className="mt-4 space-y-3 text-[15px] font-medium leading-7 text-body">
                {useCase.proofPoints.map((point) => (
                  <li key={point} className="flex gap-sm">
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined mt-[3px] text-[18px] text-primary"
                    >
                      check_circle
                    </span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </article>

            <aside>
              <h2 className="text-[16px] font-black leading-6 text-ink">
                이어서 볼 질문
              </h2>
              <div className="mt-4 space-y-sm">
                {(relatedQuestions.length > 0
                  ? relatedQuestions
                  : QUESTION_TOPIC_PAGES.slice(0, 3)
                ).map((topic) => (
                  <Link
                    key={topic.slug}
                    href={`/questions/${topic.slug}`}
                    className="block rounded-[8px] border border-hairline bg-canvas p-sm transition-colors hover:border-primary hover:bg-surface"
                  >
                    <p className="text-[14px] font-extrabold leading-5 text-ink">
                      {topic.shortTitle}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-5 text-muted">
                      {topic.description}
                    </p>
                  </Link>
                ))}
              </div>
            </aside>
          </section>

          {otherUseCases.length > 0 && (
            <section className="border-t border-hairline py-8">
              <h2 className="text-[22px] font-black leading-7 text-ink">
                다른 유스케이스
              </h2>
              <div className="mt-4 grid gap-sm sm:grid-cols-2">
                {otherUseCases.map((item) => (
                  <Link
                    key={item.slug}
                    href={`/use-cases/${item.slug}`}
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
          )}

          <PublicRelatedLinks currentPath={`/use-cases/${useCase.slug}`} />
        </div>
      </main>
    </div>
  );
}
