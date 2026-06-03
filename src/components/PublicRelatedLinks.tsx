import Link from "next/link";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { localizedPath } from "@/i18n/routing";

const relatedLinks = {
  ko: [
    {
      href: "/companies",
      label: "회사 목록",
      description: "분석할 기업을 고릅니다.",
    },
    {
      href: "/questions",
      label: "질문 그래프",
      description: "Apple 질문 흐름에서 바로 시작합니다.",
    },
    {
      href: "/pricing",
      label: "가격",
      description: "무료 베타 한도를 확인합니다.",
    },
  ],
  en: [
    {
      href: "/companies",
      label: "Companies",
      description: "Choose a company to research.",
    },
    {
      href: "/questions",
      label: "Question graphs",
      description: "Start from an Apple question flow.",
    },
    {
      href: "/pricing",
      label: "Pricing",
      description: "Review the free beta limits.",
    },
  ],
} as const;

interface PublicRelatedLinksProps {
  currentPath?: string;
  locale?: Locale;
}

export default function PublicRelatedLinks({
  currentPath,
  locale = DEFAULT_LOCALE,
}: PublicRelatedLinksProps) {
  const links = relatedLinks[locale].filter((link) => link.href !== currentPath);

  return (
    <section className="border-t border-hairline py-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase leading-5 tracking-[0.16em] text-primary">
            {locale === "ko" ? "관련 페이지" : "Related pages"}
          </p>
          <h2 className="mt-2 text-[20px] font-black leading-7 text-ink">
            {locale === "ko" ? "다른 흐름으로 이어서 보기" : "Continue with another flow"}
          </h2>
        </div>

        <nav
          className="grid gap-3 sm:grid-cols-2 md:w-[560px]"
          aria-label={locale === "ko" ? "관련 공개 페이지" : "Related public pages"}
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={localizedPath(locale, link.href)}
              className="group block border-b border-hairline pb-3 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              <span className="block text-[14px] font-extrabold leading-5 text-ink transition-colors group-hover:text-primary">
                {link.label}
              </span>
              <span className="mt-1 block text-[12px] font-medium leading-5 text-muted">
                {link.description}
              </span>
            </Link>
          ))}
        </nav>
      </div>
    </section>
  );
}
