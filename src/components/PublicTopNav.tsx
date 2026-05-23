import Link from "next/link";
import { KrwBrand } from "@/components/KrwBrand";
import MarketingCtaLink from "@/components/MarketingCtaLink";

const navItems = [
  { href: "/companies", label: "회사 목록" },
  { href: "/questions", label: "질문 그래프" },
  { href: "/pricing", label: "가격" },
] as const;

export default function PublicTopNav() {
  return (
    <header className="sticky top-0 z-50 w-full flex-shrink-0 border-b border-hairline bg-canvas/95 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] w-full max-w-[1600px] items-center justify-between gap-sm px-base sm:px-md md:h-[64px]">
        <KrwBrand href="/" compact />

        <nav
          className="hidden items-center gap-xs md:flex"
          aria-label="공개 페이지 내비게이션"
        >
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-[8px] px-sm py-xs text-[13px] font-extrabold leading-5 text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <MarketingCtaLink
          href="/companies"
          ctaId="public_nav_start"
          ctaLabel="무료 시작"
          surface="public_nav"
          className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-[8px] bg-surface-dark px-sm py-xs text-[13px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          무료 시작
        </MarketingCtaLink>
      </div>
    </header>
  );
}
