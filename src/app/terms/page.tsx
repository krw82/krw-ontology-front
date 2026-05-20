import type { Metadata } from "next";
import Link from "next/link";
import { KrwBrand } from "@/components/KrwBrand";

export const metadata: Metadata = {
  title: "서비스 약관 | KRW Ontology",
  description: "KRW Ontology 서비스 약관",
};

const sections = [
  {
    title: "1. 서비스 개요",
    body: [
      "KRW Ontology는 기업 공시, 사업 활동, 리스크 요인, 사용자가 제공한 자료를 바탕으로 리서치 답변과 근거 기록을 제공하는 서비스입니다.",
      "서비스의 결과는 정보 제공 및 리서치 보조 목적이며, 투자 자문, 법률 자문, 회계 자문 또는 기타 전문 자문으로 간주되지 않습니다.",
    ],
  },
  {
    title: "2. 계정 및 인증",
    body: [
      "사용자는 Google 계정으로 로그인하여 개인 워크스페이스, 채팅 기록, 리서치 결과를 사용할 수 있습니다.",
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
      "KRW Ontology는 근거 기반 답변을 제공하기 위해 노력하지만, 생성된 요약과 분석에는 오류나 누락이 있을 수 있습니다.",
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
      "관련 법령이 허용하는 범위 내에서 KRW Ontology는 서비스 이용 또는 이용 불가로 인해 발생한 간접 손해, 특별 손해, 결과적 손해에 대해 책임을 지지 않습니다.",
      "사용자는 서비스 결과를 독립적으로 검토하고, 본인의 판단과 책임으로 활용해야 합니다.",
    ],
  },
  {
    title: "8. 문의",
    body: [
      "서비스 약관과 관련한 문의는 business@example.com 으로 연락해 주세요.",
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <header className="border-b border-hairline bg-canvas/95 backdrop-blur-xl">
        <nav className="mx-auto flex h-20 max-w-5xl items-center justify-between px-base sm:px-md">
          <KrwBrand compact />
          <Link
            href="/"
            className="rounded-[8px] border border-hairline px-3 py-2 text-[14px] font-bold text-body transition-colors hover:border-primary hover:text-primary"
          >
            홈
          </Link>
        </nav>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-5xl px-base py-xxl sm:px-md md:py-[72px]">
        <p className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
          Terms of Service
        </p>
        <h1 className="mt-4 text-[34px] font-black leading-[1.08] tracking-normal text-ink sm:text-[48px]">
          서비스 약관
        </h1>
        <p className="mt-4 max-w-3xl text-[16px] leading-7 text-body">
          KRW Ontology를 이용하기 전에 아래 서비스 약관을 확인해 주세요.
        </p>
        <p className="mt-3 font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-muted">
          시행일: 2026년 5월 17일
        </p>

        <div className="mt-10 divide-y divide-hairline rounded-[8px] border border-hairline bg-surface-soft">
          {sections.map((section) => (
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
