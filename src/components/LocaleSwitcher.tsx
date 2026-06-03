"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "@/i18n/config";
import {
  getPathLocale,
  localizedPath,
  stripLocalePrefix,
} from "@/i18n/routing";

interface LocaleSwitcherProps {
  compact?: boolean;
}

export default function LocaleSwitcher({
  compact = false,
}: LocaleSwitcherProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentLocale = getPathLocale(pathname) ?? DEFAULT_LOCALE;
  const unlocalizedPathname = stripLocalePrefix(pathname);
  const query = searchParams.toString();
  const querySuffix = query ? `?${query}` : "";

  return (
    <div
      className={[
        "inline-flex shrink-0 items-center rounded-[8px] border border-hairline bg-canvas p-[3px]",
        compact ? "h-9" : "h-10",
      ].join(" ")}
      aria-label="언어 선택"
    >
      {SUPPORTED_LOCALES.map((locale) => {
        const active = locale === currentLocale;
        const label = locale.toUpperCase();

        return (
          <Link
            key={locale}
            href={`${localizedPath(locale, unlocalizedPathname)}${querySuffix}`}
            aria-current={active ? "page" : undefined}
            className={[
              "inline-flex h-full min-w-9 items-center justify-center rounded-[6px] px-2 font-mono text-[11px] font-black leading-4 transition-colors",
              active
                ? "bg-surface-dark text-on-dark"
                : "text-muted hover:bg-surface hover:text-ink",
            ].join(" ")}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
