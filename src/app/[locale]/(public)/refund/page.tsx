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
    effectiveDate: "시행일: 2026년 8월 10일",
    paragraphs: [
      "KRW.O는 월 단위로 과금되는 정기구독형 온라인 리서치 및 데이터 분석 서비스입니다.",
      "회원은 언제든지 구독을 해지할 수 있으며, 구독 해지 시 다음 결제일부터 자동결제가 중단됩니다. 이미 결제된 이용기간은 해당 기간 종료일까지 서비스 이용이 가능합니다.",
      "상위 플랜으로 즉시 변경하는 경우 남은 결제기간에 해당하는 월 구독료 차액만 결제합니다. 하위 플랜 변경은 다음 월 결제일부터 적용됩니다.",
      "각 결제 건은 결제 후 7일 이내이고 해당 결제 후 유료 분석 실행 이력이 없는 경우, 설정 > 결제에서 즉시 전액 자동 환불할 수 있습니다.",
      "자동 환불을 실행하면 원래 결제수단을 바로 취소합니다. 최초 결제나 월 정기결제를 환불하면 구독은 즉시 종료되고 Free 플랜으로 전환됩니다. 업그레이드 차액 결제를 환불하면 직전 플랜으로 되돌립니다.",
      "유료 분석을 실행한 결제 건, 자동 환불 기간이 지난 결제 건, 이후 결제 또는 플랜 변경이 진행 중인 결제 건은 자동 환불 대상이 아닙니다.",
      "결제 취소 결과를 바로 확인할 수 없는 경우에는 중복 취소 없이 시스템이 결제 상태를 자동으로 다시 확인합니다. 별도의 관리자 승인 절차는 두지 않습니다.",
      "중복 결제, 오결제, 시스템 장애 등 자동 환불 화면에서 해결되지 않는 결제 문제는 고객센터로 알려 주세요.",
      `고객센터 이메일: ${BUSINESS_CONTACT_EMAIL}.`,
    ],
  },
  en: {
    metadataTitle: "Refund Policy",
    metadataDescription: "KRW.O Refund Policy",
    home: "Home",
    eyebrow: "Refund Policy",
    heading: "Refund Policy",
    effectiveDate: "Effective date: August 10, 2026",
    paragraphs: [
      "KRW.O is a monthly subscription-based online research and data analysis service.",
      "Members may cancel their subscription at any time. When a subscription is cancelled, automatic billing stops from the next billing date. The service remains available until the end of the already paid billing period.",
      "Immediate upgrades charge only the prorated monthly price difference for the remaining billing period. Downgrades take effect from the next monthly billing date.",
      "For each payment, a full automatic refund is available from Settings > Billing within 7 days of payment when there is no paid analysis execution after that payment.",
      "Starting an automatic refund immediately cancels the original payment method. Refunding an initial or monthly renewal payment ends the subscription and moves the account to Free. Refunding an upgrade difference restores the previous plan.",
      "Payments with paid analysis execution, payments outside the automatic refund window, or payments with a later payment or plan change in progress are not eligible for automatic refund.",
      "If the cancellation result cannot be verified immediately, the system automatically checks the payment status again without making a duplicate cancellation. No administrator approval is required.",
      "For duplicate charges, incorrect charges, or system failures that cannot be resolved in the automatic-refund screen, contact customer support.",
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
    effectiveDate: string;
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
        <p className="mt-3 text-[13px] font-semibold text-muted">
          {copy.effectiveDate}
        </p>

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
