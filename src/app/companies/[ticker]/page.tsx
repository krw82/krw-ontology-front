import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import PublicTopNav from "@/components/PublicTopNav";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import { normalizeTicker } from "@/lib/ontology/ticker";
import { getSuggestedPromptsForTickers } from "@/lib/chat/suggested-prompts";
import { absoluteUrl, pageMetadata, SITE_NAME } from "@/lib/marketing/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CompanyPageProps = {
  params: Promise<{ ticker: string }>;
};

function chatHref(ticker: string, query?: string): string {
  const params = new URLSearchParams({ ticker });
  if (query) params.set("query", query);
  return `/chat?${params.toString()}`;
}

export async function generateMetadata({
  params,
}: CompanyPageProps): Promise<Metadata> {
  const { ticker: rawTicker } = await params;
  const ticker = normalizeTicker(rawTicker);
  const company = ticker ? await getIndexedCompany(ticker) : null;

  if (!company) {
    return pageMetadata({
      title: "회사를 찾지 못했습니다",
      description: "현재 KRW Ontology 인덱스에서 찾을 수 없는 회사입니다.",
      path: `/companies/${rawTicker}`,
      noIndex: true,
    });
  }

  return pageMetadata({
    title: `${company.ticker} 공시 기반 기업 분석`,
    description: `${company.name} (${company.ticker})의 실적 변화, 리스크, 사업 활동을 공시 근거 기반으로 질문해보세요.`,
    path: `/companies/${company.ticker}`,
  });
}

export default async function CompanyLandingPage({
  params,
}: CompanyPageProps) {
  const { ticker: rawTicker } = await params;
  const ticker = normalizeTicker(rawTicker);
  const company = ticker ? await getIndexedCompany(ticker) : null;

  if (!company) notFound();

  const prompts = getSuggestedPromptsForTickers([company.ticker]);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${company.ticker} 공시 기반 기업 분석`,
    url: absoluteUrl(`/companies/${company.ticker}`),
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: absoluteUrl("/"),
    },
    about: {
      "@type": "Organization",
      name: company.name,
      tickerSymbol: company.ticker,
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
            <Link href="/companies" className="hover:text-primary">
              회사 목록
            </Link>
            <span className="mx-2 text-outline-variant">/</span>
            <span className="text-ink">{company.ticker}</span>
          </nav>

          <header className="border-b border-hairline pb-8">
            <p className="font-mono text-[14px] font-black leading-5 tracking-[0.08em] text-primary">
              {company.ticker}
            </p>
            <h1 className="mt-3 max-w-4xl text-balance text-[34px] font-black leading-[1.08] tracking-normal text-ink sm:text-[48px]">
              {company.name} 공시 기반 리서치
            </h1>
            <p className="mt-4 max-w-3xl text-[16px] leading-7 text-body sm:text-[18px]">
              {company.description}
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                href={chatHref(company.ticker)}
                className="inline-flex min-h-12 items-center justify-center rounded-[8px] bg-surface-dark px-5 py-3 text-[15px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                {company.ticker} 무료 분석 시작
              </Link>
              <Link
                href={chatHref(company.ticker, prompts[0])}
                className="inline-flex min-h-12 items-center justify-center rounded-[8px] border border-hairline bg-canvas px-5 py-3 text-[15px] font-extrabold leading-5 text-ink transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                추천 질문 입력
              </Link>
            </div>
          </header>

          <section className="grid gap-4 border-b border-hairline py-8 md:grid-cols-3">
            <FactBlock label="커버리지" value={company.coverage ?? "공시 인덱싱"} />
            <FactBlock label="섹터" value={company.sector ?? "인덱싱된 기업"} />
            <FactBlock
              label="최신 기간"
              value={company.latest_period ?? "기간 정보 확인 중"}
            />
          </section>

          <section className="grid gap-8 py-8 md:grid-cols-[minmax(0,1fr)_320px]">
            <div>
              <h2 className="text-[22px] font-black leading-7 text-ink">
                바로 물어볼 수 있는 질문
              </h2>
              <div className="mt-4 divide-y divide-hairline rounded-[8px] border border-hairline bg-canvas">
                {prompts.map((prompt) => (
                  <Link
                    key={prompt}
                    href={chatHref(company.ticker, prompt)}
                    className="group flex items-center justify-between gap-sm px-base py-sm text-[14px] font-bold leading-6 text-body transition-colors hover:bg-surface hover:text-ink"
                  >
                    <span className="min-w-0">{prompt}</span>
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined shrink-0 text-[18px] text-muted transition-colors group-hover:text-primary"
                    >
                      arrow_forward
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            <aside className="rounded-[8px] border border-hairline bg-surface p-base">
              <h2 className="text-[16px] font-black leading-6 text-ink">
                분석 전에 확인할 범위
              </h2>
              <dl className="mt-4 space-y-sm">
                <DetailRow label="사업 활동" value={company.core_strength ?? "회사별 사업 활동 인덱스 확인"} />
                <DetailRow label="추적 변수" value={company.critical_risk ?? "리스크 변수 인덱스 확인"} />
                <DetailRow
                  label="문서 유형"
                  value={
                    company.document_types?.length
                      ? company.document_types.join(", ")
                      : "10-K, 10-Q"
                  }
                />
              </dl>
            </aside>
          </section>
        </div>
      </main>
    </div>
  );
}

function FactBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
        {label}
      </p>
      <p className="mt-2 text-[15px] font-extrabold leading-6 text-ink">
        {value}
      </p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
        {label}
      </dt>
      <dd className="mt-1 text-[13px] font-medium leading-5 text-body">
        {value}
      </dd>
    </div>
  );
}
