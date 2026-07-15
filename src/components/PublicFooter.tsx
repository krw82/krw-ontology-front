import Link from "next/link";
import { KrwBrand } from "@/components/KrwBrand";
import { type Locale } from "@/i18n/config";
import { localizedPath } from "@/i18n/routing";
import { getBusinessInformation } from "@/lib/marketing/business";
import { SITE_NAME } from "@/lib/marketing/site";

const legalLinks = {
  ko: [
    { href: "/terms", label: "이용약관" },
    { href: "/privacy", label: "개인정보처리방침" },
    { href: "/refund", label: "환불정책" },
  ],
  en: [
    { href: "/terms", label: "Terms of Service" },
    { href: "/privacy", label: "Privacy Policy" },
    { href: "/refund", label: "Refund Policy" },
  ],
} as const;

interface PublicFooterProps {
  locale: Locale;
}

export default function PublicFooter({ locale }: PublicFooterProps) {
  const business = getBusinessInformation(locale);
  const isMissingValue =
    business.phone === "정보 입력 필요" ||
    business.phone === "Configure required";
  const labels =
    locale === "ko"
      ? {
          business: "사업자 정보",
          companyName: "상호명",
          representative: "대표자",
          registration: "사업자등록번호",
          ecommerceRegistration: "통신판매업 신고번호",
          address: "사업장 주소",
          phone: "전화번호",
          email: "이메일",
          privacyOfficer: "개인정보보호책임자",
          contact: "문의",
          copyright: `© ${new Date().getFullYear()} ${SITE_NAME}`,
        }
      : {
          business: "Business information",
          companyName: "Business name",
          representative: "Representative",
          registration: "Business registration no.",
          ecommerceRegistration: "E-commerce registration no.",
          address: "Business address",
          phone: "Phone",
          email: "Email",
          privacyOfficer: "Privacy officer",
          contact: "Contact",
          copyright: `© ${new Date().getFullYear()} ${SITE_NAME}`,
        };

  return (
    <footer className="border-t border-hairline bg-surface-soft text-body">
      <div className="mx-auto w-full max-w-[1600px] px-base py-xl sm:px-md md:px-xl">
        <div className="flex flex-col gap-lg border-b border-hairline pb-lg md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 md:w-[28rem] md:flex-none">
            <KrwBrand
              href={localizedPath(locale, "/")}
              compact
              ariaLabel={locale === "ko" ? "홈으로 이동" : "Go home"}
            />
            <p className="mt-3 w-full break-keep text-[13px] font-medium leading-6 text-muted">
              {locale === "ko"
                ? "공시 원문 근거를 따라가는 기업 리서치 서비스입니다."
                : "Filing-grounded company research."}
            </p>
          </div>

          <nav
            aria-label={locale === "ko" ? "법적 문서" : "Legal documents"}
            className="flex shrink-0 flex-wrap gap-x-md gap-y-2 text-[13px] font-extrabold text-body"
          >
            {legalLinks[locale].map((link) => (
              <Link
                key={link.href}
                href={localizedPath(locale, link.href)}
                className="transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-soft"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <section className="pt-lg" aria-labelledby="business-information-heading">
          <h2
            id="business-information-heading"
            className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-muted"
          >
            {labels.business}
          </h2>
          <dl className="mt-4 grid gap-x-lg gap-y-3 text-[12px] leading-5 sm:grid-cols-2 lg:grid-cols-4">
            <BusinessField label={labels.companyName} value={business.companyName} />
            <BusinessField
              label={labels.representative}
              value={business.representative}
            />
            <BusinessField
              label={labels.registration}
              value={business.businessRegistrationNumber}
            />
            <BusinessField
              label={labels.ecommerceRegistration}
              value={business.ecommerceRegistrationNumber}
            />
            <BusinessField label={labels.address} value={business.address} />
            <BusinessField
              label={labels.phone}
              value={business.phone}
              href={isMissingValue ? undefined : `tel:${business.phone}`}
            />
            <BusinessField
              label={labels.email}
              value={business.email}
              href={`mailto:${business.email}`}
            />
            <BusinessField
              label={labels.privacyOfficer}
              value={business.privacyOfficer}
            />
          </dl>
        </section>

        <div className="mt-lg flex flex-col gap-2 text-[11px] font-bold leading-5 text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>{labels.copyright}</span>
          <span>
            {labels.contact}: {business.email}
          </span>
        </div>
      </div>
    </footer>
  );
}

function BusinessField({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="font-bold text-muted">{label}</dt>
      <dd className="mt-0.5 break-words font-semibold text-body">
        {href ? (
          <a
            href={href}
            className="transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-soft"
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
