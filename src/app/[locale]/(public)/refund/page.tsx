import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { KrwBrand } from "@/components/KrwBrand";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import { isLocale, type Locale } from "@/i18n/config";
import { localizedPageMetadata } from "@/i18n/metadata";
import { localizedPath } from "@/i18n/routing";
import { BUSINESS_CONTACT_EMAIL } from "@/lib/marketing/business";

type RefundPageProps = {
  params: Promise<{ locale: string }>;
};

const refundCopy = {
  ko: {
    metadataTitle: "환불정책",
    metadataDescription: "KRW.O 환불정책",
    home: "홈",
    eyebrow: "Refund Policy",
    heading: "환불정책",
    paragraphs: [
      "KRW.O는 월 단위로 과금되는 정기구독형 온라인 리서치 및 데이터 분석 서비스입니다.",
      "회원은 언제든지 구독을 해지할 수 있으며, 구독 해지 시 다음 결제일부터 자동결제가 중단됩니다. 이미 결제된 이용기간은 해당 기간 종료일까지 서비스 이용이 가능합니다.",
      "상위 플랜으로 즉시 변경하는 경우 남은 결제기간에 해당하는 월 구독료 차액만 결제합니다. 하위 플랜 변경은 다음 월 결제일부터 적용됩니다.",
      "결제 후 7일 이내이고 유료 기능 사용 이력이 없는 경우 전액 환불합니다.",
      "다만 유료 리서치 조회, 데이터 검색, 분석 결과 생성, 다운로드, API 사용 등 유료 서비스 이용이 개시된 경우에는 디지털 콘텐츠 및 온라인 서비스 특성상 해당 결제 건의 환불이 제한될 수 있습니다.",
      "중복 결제, 오결제, 시스템 장애, 회사 귀책사유로 정상적인 서비스 이용이 불가능한 경우에는 확인 후 전액 또는 잔여기간 기준으로 환불합니다.",
      "환불 요청은 고객센터 이메일 또는 서비스 내 문의 기능을 통해 접수할 수 있으며, 환불 승인 시 결제수단 취소 방식으로 처리합니다.",
      `고객센터 이메일: ${BUSINESS_CONTACT_EMAIL}.`,
    ],
  },
  en: {
    metadataTitle: "Refund Policy",
    metadataDescription: "KRW.O Refund Policy",
    home: "Home",
    eyebrow: "Refund Policy",
    heading: "Refund Policy",
    paragraphs: [
      "KRW.O is a monthly subscription-based online research and data analysis service.",
      "Members may cancel their subscription at any time. When a subscription is cancelled, automatic billing stops from the next billing date. The service remains available until the end of the already paid billing period.",
      "Immediate upgrades charge only the prorated monthly price difference for the remaining billing period. Downgrades take effect from the next monthly billing date.",
      "A full refund is available if the payment was made within the last 7 days and there is no paid feature usage history.",
      "However, once paid service usage has started, including paid research views, data searches, analysis result generation, downloads, or API usage, refunds for that payment may be restricted due to the nature of digital content and online services.",
      "If duplicate billing, incorrect billing, system failures, or causes attributable to the company prevent normal service use, KRW.O will review the case and provide a full refund or a refund based on the remaining period.",
      "Refund requests may be submitted through the customer support email or in-service inquiry feature. Approved refunds are processed by cancelling the original payment method.",
      `Customer support email: ${BUSINESS_CONTACT_EMAIL}.`,
    ],
  },
} satisfies Record<
  Locale,
  {
    metadataTitle: string;
    metadataDescription: string;
    home: string;
    eyebrow: string;
    heading: string;
    paragraphs: string[];
  }
>;

export async function generateMetadata({
  params,
}: RefundPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return localizedPageMetadata({
    locale,
    title: refundCopy[locale].metadataTitle,
    description: refundCopy[locale].metadataDescription,
    path: "/refund",
  });
}

export default async function RefundPage({ params }: RefundPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const copy = refundCopy[locale];

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

      <main
        id="main-content"
        className="mx-auto w-full max-w-5xl px-base py-xxl sm:px-md md:py-[72px]"
      >
        <p className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
          {copy.eyebrow}
        </p>
        <h1 className="mt-4 text-[34px] font-black leading-[1.08] tracking-normal text-ink sm:text-[48px]">
          {copy.heading}
        </h1>

        <section className="mt-10 rounded-[8px] border border-hairline bg-surface-soft px-base py-lg sm:px-lg">
          <div className="space-y-4">
            {copy.paragraphs.map((paragraph) => (
              <p
                key={paragraph}
                className="text-[15px] leading-7 text-body sm:text-[16px]"
              >
                {paragraph}
              </p>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
