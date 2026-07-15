"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import {
  localeSwitchHref,
  resolveRouteLocale,
} from "@/i18n/routing";

interface LocaleSwitcherProps {
  compact?: boolean;
}

export default function LocaleSwitcher({
  compact = false,
}: LocaleSwitcherProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentLocale = resolveRouteLocale(
    pathname,
    searchParams.get("locale"),
  );
  const query = searchParams.toString();

  return (
    <div
      className={[
        "inline-flex shrink-0 items-center rounded-[8px] border border-hairline bg-canvas p-[3px]",
        compact ? "h-9" : "h-10",
      ].join(" ")}
      aria-label={currentLocale === "ko" ? "언어 선택" : "Language switcher"}
    >
      {SUPPORTED_LOCALES.map((locale) => {
        const active = locale === currentLocale;
        const label = locale.toUpperCase();

        return (
          <Link
            key={locale}
            href={localeSwitchHref(locale, pathname, query)}
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
