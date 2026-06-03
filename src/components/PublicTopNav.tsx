import Link from "next/link";
import { KrwBrand } from "@/components/KrwBrand";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import MarketingCtaLink from "@/components/MarketingCtaLink";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { localizedPath } from "@/i18n/routing";

const navItems = {
  ko: [
    { href: "/companies", label: "회사 목록" },
    { href: "/questions", label: "질문 그래프" },
    { href: "/pricing", label: "가격" },
  ],
  en: [
    { href: "/companies", label: "Companies" },
    { href: "/questions", label: "Question graphs" },
    { href: "/pricing", label: "Pricing" },
  ],
} as const;

interface PublicTopNavProps {
  locale?: Locale;
}

export default function PublicTopNav({
  locale = DEFAULT_LOCALE,
}: PublicTopNavProps) {
  const ctaLabel = locale === "ko" ? "무료 시작" : "Start free";

  return (
    <header className="sticky top-0 z-50 w-full flex-shrink-0 border-b border-hairline bg-canvas/95 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] w-full max-w-[1600px] items-center justify-between gap-sm px-base sm:px-md md:h-[64px]">
        <KrwBrand href={localizedPath(locale)} compact />

        <nav
          className="hidden items-center gap-xs md:flex"
          aria-label={locale === "ko" ? "공개 페이지 내비게이션" : "Public navigation"}
        >
          {navItems[locale].map((item) => (
            <Link
              key={item.href}
              href={localizedPath(locale, item.href)}
              className="rounded-[8px] px-sm py-xs text-[13px] font-extrabold leading-5 text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-xs">
          <LocaleSwitcher compact />
          <MarketingCtaLink
            href={localizedPath(locale, "/companies")}
            ctaId="public_nav_start"
            ctaLabel={ctaLabel}
            surface="public_nav"
            className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-[8px] bg-surface-dark px-sm py-xs text-[13px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            {ctaLabel}
          </MarketingCtaLink>
        </div>
      </div>
    </header>
  );
}
