import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { KrwBrand } from "@/components/KrwBrand";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import { isLocale, type Locale } from "@/i18n/config";
import { localizedPageMetadata } from "@/i18n/metadata";
import { localizedPath } from "@/i18n/routing";
import { BUSINESS_CONTACT_EMAIL } from "@/lib/marketing/business";

type PrivacyPageProps = {
  params: Promise<{ locale: string }>;
};

const privacyCopy = {
  ko: {
    metadataTitle: "개인정보처리방침",
    metadataDescription: "KRW.O 개인정보처리방침",
    home: "홈",
    eyebrow: "Privacy Policy",
    heading: "개인정보처리방침",
    intro:
      "KRW.O는 근거 기반 기업 리서치 서비스를 제공하기 위해 필요한 최소한의 정보를 처리합니다.",
    effectiveDate: "시행일: 2026년 7월 14일",
    sections: [
      {
        title: "1. 수집하는 정보",
        body: [
          "KRW.O는 서비스 제공을 위해 Google 로그인 과정에서 제공되는 기본 계정 정보(이메일 주소, 이름, 프로필 이미지)와 이메일 로그인에 필요한 계정 정보를 처리할 수 있습니다.",
          "서비스 이용 과정에서 사용자가 입력한 질문, 채팅 기록, 회사 검색 기록, 리서치 결과, 첨부하거나 붙여넣은 자료가 저장될 수 있습니다.",
          "사용자가 공시 알림을 켜면 브라우저가 발급한 푸시 구독 식별자와 알림 수신 설정, 공시 알림 읽음·클릭 기록이 저장될 수 있습니다. 이 정보에는 기기 이름이나 모델을 저장하지 않습니다.",
          "서비스 안정성 확인을 위해 요청 시각, 오류 기록, 접속 환경 등 운영에 필요한 기술 정보가 처리될 수 있습니다.",
        ],
      },
      {
        title: "2. 정보 이용 목적",
        body: [
          "수집한 정보는 사용자 인증, 개인 워크스페이스 제공, 채팅 기록 보관, 리서치 결과 생성 및 서비스 품질 개선을 위해 사용됩니다.",
          "푸시 구독 정보와 알림 설정은 관심 기업의 8-K·6-K 공시 알림을 전송하고 알림 기능을 운영하기 위해서만 사용됩니다.",
          "로그인 정보는 사용자를 식별하고 세션을 유지하기 위한 목적으로만 사용됩니다. Google 로그인 이용 시에도 Gmail, Drive, Calendar 등 별도 Google 서비스 데이터에는 접근하지 않습니다.",
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
          "KRW.O는 사용자의 개인정보를 판매하지 않습니다.",
          "서비스 운영을 위해 Supabase, Google OAuth 등 인증과 데이터 저장에 필요한 외부 서비스를 사용할 수 있으며, 각 제공자는 자체 정책에 따라 데이터를 처리합니다.",
        ],
      },
      {
        title: "5. 보안",
        body: [
          "KRW.O는 인증된 사용자만 본인의 세션과 리서치 기록에 접근할 수 있도록 접근 제어와 데이터 보호 조치를 적용합니다.",
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
          `개인정보와 관련한 문의는 ${BUSINESS_CONTACT_EMAIL} 으로 연락해 주세요.`,
        ],
      },
    ],
  },
  en: {
    metadataTitle: "Privacy Policy",
    metadataDescription: "KRW.O Privacy Policy",
    home: "Home",
    eyebrow: "Privacy Policy",
    heading: "Privacy Policy",
    intro:
      "KRW.O processes the minimum information needed to provide evidence-first company research.",
    effectiveDate: "Effective date: July 14, 2026",
    sections: [
      {
        title: "1. Information we collect",
        body: [
          "KRW.O may process basic account information provided during Google sign-in, such as email address, name, and profile image, as well as account information needed for email sign-in.",
          "Questions, chat history, company searches, research results, and materials submitted or pasted by users may be stored as part of the service.",
          "If a user enables filing alerts, the service may store the browser-issued push subscription identifier, alert preferences, and filing-alert read/click records. It does not store a device name or model.",
          "Operational information such as request time, error logs, and access environment may be processed to maintain service reliability.",
        ],
      },
      {
        title: "2. How we use information",
        body: [
          "Collected information is used for authentication, personal workspaces, chat history, research result generation, and service quality improvement.",
          "Push subscription information and alert preferences are used only to deliver and operate 8-K and 6-K filing alerts for companies a user follows.",
          "Sign-in information is used only to identify users and maintain sessions. When Google sign-in is used, KRW.O does not access separate Google services such as Gmail, Drive, or Calendar.",
        ],
      },
      {
        title: "3. Retention and deletion",
        body: [
          "Account information and service usage records may be retained while the user continues to use the service.",
          "If a user requests deletion, KRW.O will delete the account and related data within a reasonable period unless retention is required by law.",
        ],
      },
      {
        title: "4. Third-party services",
        body: [
          "KRW.O does not sell user personal information.",
          "The service may use external providers such as Supabase and Google OAuth for authentication and data storage. Those providers process data under their own policies.",
        ],
      },
      {
        title: "5. Security",
        body: [
          "KRW.O applies access controls and data protection measures so authenticated users can access only their own sessions and research records.",
          "No internet-based service can remove every risk, so users should avoid entering sensitive personal information or confidential materials.",
        ],
      },
      {
        title: "6. User rights",
        body: [
          "Users may request access, correction, deletion, or suspension of processing for their personal information.",
          "Requests can be submitted through the contact below and will be handled after identity verification.",
        ],
      },
      {
        title: "7. Contact",
        body: [
          `For privacy questions, contact ${BUSINESS_CONTACT_EMAIL}.`,
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
}: PrivacyPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return localizedPageMetadata({
    locale,
    title: privacyCopy[locale].metadataTitle,
    description: privacyCopy[locale].metadataDescription,
    path: "/privacy",
  });
}

export default async function PrivacyPage({ params }: PrivacyPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const copy = privacyCopy[locale];

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
