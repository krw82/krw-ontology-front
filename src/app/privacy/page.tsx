import type { Metadata } from "next";
import Link from "next/link";
import { KrwBrand } from "@/components/KrwBrand";

export const metadata: Metadata = {
  title: "개인정보처리방침 | KRW Ontology",
  description: "KRW Ontology 개인정보처리방침",
};

const sections = [
  {
    title: "1. 수집하는 정보",
    body: [
      "KRW Ontology는 서비스 제공을 위해 Google 로그인 과정에서 제공되는 기본 계정 정보(이메일 주소, 이름, 프로필 이미지)를 수집할 수 있습니다.",
      "서비스 이용 과정에서 사용자가 입력한 질문, 채팅 기록, 회사 검색 기록, 리서치 결과, 첨부하거나 붙여넣은 자료가 저장될 수 있습니다.",
      "서비스 안정성 확인을 위해 요청 시각, 오류 기록, 접속 환경 등 운영에 필요한 기술 정보가 처리될 수 있습니다.",
    ],
  },
  {
    title: "2. 정보 이용 목적",
    body: [
      "수집한 정보는 사용자 인증, 개인 워크스페이스 제공, 채팅 기록 보관, 리서치 결과 생성 및 서비스 품질 개선을 위해 사용됩니다.",
      "Google 계정 정보는 사용자를 식별하고 세션을 유지하기 위한 목적으로만 사용되며, Gmail, Drive, Calendar 등 별도 Google 서비스 데이터에는 접근하지 않습니다.",
    ],
  },
  {
    title: "3. 보관 및 삭제",
    body: [
      "계정 정보와 서비스 이용 기록은 사용자가 서비스를 이용하는 동안 보관될 수 있습니다.",
      "사용자가 삭제를 요청하면 관련 법령상 보관이 필요한 경우를 제외하고 합리적인 기간 내에 계정 및 관련 데이터를 삭제합니다.",
    ],
  },
  {
    title: "4. 제3자 제공 및 처리 위탁",
    body: [
      "KRW Ontology는 사용자의 개인정보를 판매하지 않습니다.",
      "서비스 운영을 위해 Supabase, Google OAuth 등 인증과 데이터 저장에 필요한 외부 서비스를 사용할 수 있으며, 각 제공자는 자체 정책에 따라 데이터를 처리합니다.",
    ],
  },
  {
    title: "5. 보안",
    body: [
      "KRW Ontology는 인증된 사용자만 본인의 세션과 리서치 기록에 접근할 수 있도록 접근 제어와 데이터 보호 조치를 적용합니다.",
      "다만 인터넷 기반 서비스의 특성상 모든 위험을 완전히 제거할 수는 없으므로, 민감한 개인정보나 기밀 자료 입력에는 주의가 필요합니다.",
    ],
  },
  {
    title: "6. 사용자 권리",
    body: [
      "사용자는 본인의 개인정보 열람, 정정, 삭제, 처리 중지를 요청할 수 있습니다.",
      "요청은 아래 연락처로 접수할 수 있으며, 본인 확인 후 처리됩니다.",
    ],
  },
  {
    title: "7. 연락처",
    body: [
      "개인정보와 관련한 문의는 business@example.com 으로 연락해 주세요.",
    ],
  },
];

export default function PrivacyPage() {
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
          Privacy Policy
        </p>
        <h1 className="mt-4 text-[34px] font-black leading-[1.08] tracking-normal text-ink sm:text-[48px]">
          개인정보처리방침
        </h1>
        <p className="mt-4 max-w-3xl text-[16px] leading-7 text-body">
          KRW Ontology는 근거 기반 기업 리서치 서비스를 제공하기 위해 필요한
          최소한의 정보를 처리합니다.
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
