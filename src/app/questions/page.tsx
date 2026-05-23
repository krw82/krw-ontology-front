import Link from "next/link";
import type { Metadata } from "next";
import MarketingCtaLink from "@/components/MarketingCtaLink";
import PublicRelatedLinks from "@/components/PublicRelatedLinks";
import PublicTopNav from "@/components/PublicTopNav";
import {
  absoluteUrl,
  buildQuestionChatHref,
  pageMetadata,
  QUESTION_TOPIC_PAGES,
  SITE_NAME,
} from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "기업 리서치 질문 그래프",
  description:
    "매출 성장, 마진 변화, 리스크 요인, 세그먼트 성과, 현금흐름, 투자 thesis 점검을 Apple 질문 그래프로 시작합니다.",
  path: "/questions",
});

export default function QuestionsIndexPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "기업 리서치 질문 그래프",
    description: metadata.description,
    url: absoluteUrl("/questions"),
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: absoluteUrl("/"),
    },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: QUESTION_TOPIC_PAGES.map((topic, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: topic.title,
        url: absoluteUrl(`/questions/${topic.slug}`),
      })),
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
            <span className="text-ink">질문 그래프</span>
          </nav>

          <header className="border-b border-hairline pb-8">
            <p className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
              AAPL question graphs
            </p>
            <h1 className="mt-3 max-w-4xl text-balance text-[34px] font-black leading-[1.08] tracking-normal text-ink sm:text-[52px]">
              Apple 질문 그래프를 고르세요.
            </h1>
            <p className="mt-4 max-w-3xl text-[16px] leading-7 text-body sm:text-[18px]">
              추상적인 질문 목록 대신 Apple을 기준으로 질문이 어떻게 이어지는지
              보여줍니다. 그래프를 고른 뒤 첫 질문부터 차례대로 공시 근거를
              확인하세요.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <MarketingCtaLink
                href={buildQuestionChatHref(QUESTION_TOPIC_PAGES[0], {
                  ticker: QUESTION_TOPIC_PAGES[0].questionChain.ticker,
                  question: QUESTION_TOPIC_PAGES[0].questionChain.primaryQuestion,
                })}
                ctaId="questions_index_apple_start"
                ctaLabel="Apple 매출 그래프 시작"
                surface="questions_index_hero"
                className="inline-flex min-h-12 items-center justify-center rounded-[8px] bg-surface-dark px-5 py-3 text-[15px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                Apple 매출 그래프 시작
              </MarketingCtaLink>
              <MarketingCtaLink
                href="/companies"
                ctaId="questions_index_companies"
                ctaLabel="다른 회사 선택"
                surface="questions_index_hero"
                className="inline-flex min-h-12 items-center justify-center rounded-[8px] border border-hairline bg-canvas px-5 py-3 text-[15px] font-extrabold leading-5 text-ink transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                다른 회사 선택
              </MarketingCtaLink>
            </div>
          </header>

          <section className="py-8">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
                  Graph library
                </p>
                <h2 className="mt-2 text-[22px] font-black leading-7 text-ink">
                  Apple로 시작하는 질문 흐름
                </h2>
              </div>
              <p className="w-full min-w-full max-w-xl text-[13px] font-medium leading-6 text-muted md:w-[520px] md:min-w-[360px] md:text-right">
                모든 그래프는 AAPL 기준입니다. 화면은 질문 경로만 보여주고,
                실제 답변은 채팅에서 공시 근거로 생성됩니다.
              </p>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {QUESTION_TOPIC_PAGES.map((topic) => (
                <article
                  key={topic.slug}
                  className="rounded-[8px] border border-hairline bg-canvas p-base"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-primary">
                        {topic.category} · AAPL
                      </p>
                      <Link
                        href={`/questions/${topic.slug}`}
                        className="mt-2 block text-[20px] font-black leading-7 text-ink transition-colors hover:text-primary"
                      >
                        {topic.shortTitle}
                      </Link>
                      <p className="mt-2 text-[14px] font-medium leading-6 text-body">
                        {topic.questionChain.description}
                      </p>
                    </div>
                    <Link
                      href={`/questions/${topic.slug}`}
                      className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-[8px] border border-hairline bg-surface px-sm py-xs text-[13px] font-extrabold leading-5 text-ink transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                    >
                      그래프 보기
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <PublicRelatedLinks currentPath="/questions" />
        </div>
      </main>
    </div>
  );
}
