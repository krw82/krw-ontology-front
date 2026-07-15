import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { KrwBrand } from "@/components/KrwBrand";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import { isLocale, type Locale } from "@/i18n/config";
import { localizedPageMetadata } from "@/i18n/metadata";
import { localizedPath } from "@/i18n/routing";
import { BUSINESS_CONTACT_EMAIL } from "@/lib/marketing/business";

type TermsPageProps = {
  params: Promise<{ locale: string }>;
};

const termsCopy = {
  ko: {
    metadataTitle: "서비스 약관",
    metadataDescription: "KRW.O 서비스 약관",
    home: "홈",
    eyebrow: "Terms of Service",
    heading: "서비스 약관",
    intro: "KRW.O를 이용하기 전에 아래 서비스 약관을 확인해 주세요.",
    effectiveDate: "시행일: 2026년 5월 17일",
    sections: [
      {
        title: "1. 서비스 개요",
        body: [
          "KRW.O는 기업 공시, 사업 활동, 리스크 요인, 사용자가 제공한 자료를 바탕으로 리서치 답변과 근거 기록을 제공하는 서비스입니다.",
          "서비스의 결과는 정보 제공 및 리서치 보조 목적이며, 투자 자문, 법률 자문, 회계 자문 또는 기타 전문 자문으로 간주되지 않습니다.",
        ],
      },
      {
        title: "2. 계정 및 인증",
        body: [
          "사용자는 Google 계정 또는 이메일 계정으로 로그인하여 개인 워크스페이스, 채팅 기록, 리서치 결과를 사용할 수 있습니다.",
          "사용자는 본인 계정의 접근 권한을 안전하게 관리해야 하며, 계정의 무단 사용이 의심되는 경우 즉시 문의해야 합니다.",
        ],
      },
      {
        title: "3. 사용자 자료",
        body: [
          "사용자는 서비스에 입력하거나 첨부하는 자료를 사용할 권한이 있어야 합니다.",
          "영업비밀, 민감한 개인정보, 제3자의 권리를 침해할 수 있는 자료는 입력하지 않는 것이 좋습니다.",
          "사용자가 제공한 자료는 질문 처리, 리서치 결과 생성, 세션 기록 보관을 위해 사용될 수 있습니다.",
        ],
      },
      {
        title: "4. 허용되지 않는 사용",
        body: [
          "서비스를 불법 행위, 제3자 권리 침해, 악성 코드 배포, 무단 크롤링, 시스템 우회 또는 서비스 안정성을 해치는 방식으로 사용할 수 없습니다.",
          "자동화된 대량 요청이나 비정상적인 사용으로 서비스 운영에 영향을 주는 행위는 제한될 수 있습니다.",
        ],
      },
      {
        title: "5. 결과의 정확성",
        body: [
          "KRW.O는 근거 기반 답변을 제공하기 위해 노력하지만, 생성된 요약과 분석에는 오류나 누락이 있을 수 있습니다.",
          "중요한 의사결정에는 원문 자료와 전문적인 검토를 함께 사용해야 합니다.",
        ],
      },
      {
        title: "6. 서비스 변경 및 중단",
        body: [
          "서비스 기능, 제공 방식, 이용 조건은 운영상 필요에 따라 변경될 수 있습니다.",
          "점검, 장애, 외부 서비스 문제 등으로 서비스가 일시적으로 중단될 수 있습니다.",
        ],
      },
      {
        title: "7. 책임 제한",
        body: [
          "관련 법령이 허용하는 범위 내에서 KRW.O는 서비스 이용 또는 이용 불가로 인해 발생한 간접 손해, 특별 손해, 결과적 손해에 대해 책임을 지지 않습니다.",
          "사용자는 서비스 결과를 독립적으로 검토하고, 본인의 판단과 책임으로 활용해야 합니다.",
        ],
      },
      {
        title: "8. 문의",
        body: [
          `서비스 약관과 관련한 문의는 ${BUSINESS_CONTACT_EMAIL} 으로 연락해 주세요.`,
        ],
      },
    ],
  },
  en: {
    metadataTitle: "Terms of Service",
    metadataDescription: "KRW.O Terms of Service",
    home: "Home",
    eyebrow: "Terms of Service",
    heading: "Terms of Service",
    intro: "Please review these terms before using KRW.O.",
    effectiveDate: "Effective date: May 17, 2026",
    sections: [
      {
        title: "1. Service overview",
        body: [
          "KRW.O provides research answers and evidence records based on company filings, business activity, risk factors, and user-provided materials.",
          "Service outputs are for informational and research support purposes and are not investment, legal, accounting, or other professional advice.",
        ],
      },
      {
        title: "2. Accounts and authentication",
        body: [
          "Users can sign in with a Google account or email account to use personal workspaces, chat history, and research results.",
          "Users are responsible for keeping account access secure and should contact KRW.O immediately if unauthorized use is suspected.",
        ],
      },
      {
        title: "3. User materials",
        body: [
          "Users must have the right to submit or attach materials entered into the service.",
          "Users should avoid entering trade secrets, sensitive personal information, or materials that may infringe third-party rights.",
          "User-provided materials may be used to process questions, generate research results, and retain session records.",
        ],
      },
      {
        title: "4. Prohibited use",
        body: [
          "The service may not be used for illegal activity, rights infringement, malware distribution, unauthorized crawling, system bypass, or actions that harm service stability.",
          "Automated high-volume requests or abnormal usage that affects operations may be restricted.",
        ],
      },
      {
        title: "5. Accuracy of results",
        body: [
          "KRW.O aims to provide evidence-first answers, but generated summaries and analyses may contain errors or omissions.",
          "Important decisions should be made with original source materials and professional review.",
        ],
      },
      {
        title: "6. Service changes and interruption",
        body: [
          "Service features, delivery methods, and usage terms may change for operational reasons.",
          "Maintenance, incidents, or external service issues may temporarily interrupt the service.",
        ],
      },
      {
        title: "7. Limitation of liability",
        body: [
          "To the extent permitted by law, KRW.O is not liable for indirect, special, or consequential damages from use or inability to use the service.",
          "Users must independently review service outputs and use them under their own judgment and responsibility.",
        ],
      },
      {
        title: "8. Contact",
        body: [
          `For questions about these terms, contact ${BUSINESS_CONTACT_EMAIL}.`,
        ],
      },
    ],
  },
} satisfies Record<Locale, {
  metadataTitle: string;
  metadataDescription: string;
  home: string;
  eyebrow: string;
  heading: string;
  intro: string;
  effectiveDate: string;
  sections: Array<{ title: string; body: string[] }>;
}>;

export async function generateMetadata({
  params,
}: TermsPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return localizedPageMetadata({
    locale,
    title: termsCopy[locale].metadataTitle,
    description: termsCopy[locale].metadataDescription,
    path: "/terms",
  });
}

export default async function TermsPage({ params }: TermsPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const copy = termsCopy[locale];

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <header className="border-b border-hairline bg-canvas/95 backdrop-blur-xl">
        <nav className="mx-auto flex h-20 max-w-5xl items-center justify-between px-base sm:px-md">
          <KrwBrand
            href="/companies"
            compact
            ariaLabel={locale === "ko" ? "회사 목록으로 이동" : "Go to companies"}
          />
          <div className="flex items-center gap-xs">
            <LocaleSwitcher compact />
            <Link
              href={localizedPath(locale)}
              className="rounded-[8px] border border-hairline px-3 py-2 text-[14px] font-bold text-body transition-colors hover:border-primary hover:text-primary"
            >
              {copy.home}
            </Link>
          </div>
        </nav>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-5xl px-base py-xxl sm:px-md md:py-[72px]">
        <p className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
          {copy.eyebrow}
        </p>
        <h1 className="mt-4 text-[34px] font-black leading-[1.08] tracking-normal text-ink sm:text-[48px]">
          {copy.heading}
        </h1>
        <p className="mt-4 max-w-3xl text-[16px] leading-7 text-body">
          {copy.intro}
        </p>
        <p className="mt-3 font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-muted">
          {copy.effectiveDate}
        </p>

        <div className="mt-10 divide-y divide-hairline rounded-[8px] border border-hairline bg-surface-soft">
          {copy.sections.map((section) => (
            <section key={section.title} className="px-base py-lg sm:px-lg">
              <h2 className="text-[20px] font-black leading-[1.25] text-ink">
                {section.title}
              </h2>
              <div className="mt-4 space-y-3">
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="text-[15px] leading-7 text-body sm:text-[16px]">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
