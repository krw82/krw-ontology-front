import Link from "next/link";

import { DEFAULT_LOCALE } from "@/i18n/config";
import { getGuruLensDisplayName, type GuruLensOption } from "@/lib/guru-lenses";

export default function GuruLensContextHeader({
  lens,
  locale,
  compact = false,
}: {
  lens: GuruLensOption;
  locale: string;
  compact?: boolean;
}) {
  const isKo = locale === "ko";
  const description = isKo ? lens.descriptionKo : lens.descriptionEn;
  const detail = isKo ? lens.detailKo : lens.detailEn;
  const displayName = getGuruLensDisplayName(lens, locale);

  return (
    <div
      data-onboarding-target="guru-lens-context"
      className={[
        "mx-auto w-full max-w-4xl border-b border-hairline pb-base",
        compact ? "mb-base" : "mb-lg",
      ].join(" ")}
    >
      <div className="flex min-w-0 items-start">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-primary">
            Guru lens
          </p>
          <h2 className="mt-1 text-[24px] font-black leading-8 text-ink sm:text-[32px] sm:leading-9">
            {displayName}
          </h2>
          <p className="mt-2 text-[15px] font-bold leading-6 text-body">
            {description}
          </p>
          <p className="mt-1 max-w-2xl text-[13px] font-semibold leading-6 text-muted">
            {detail}
          </p>
        </div>
      </div>
      {!compact ? (
        <Link
          href={locale === DEFAULT_LOCALE ? "/guru" : `/guru?locale=${locale}`}
          className="mt-sm inline-flex min-h-11 items-center gap-1 rounded-[8px] border border-hairline bg-canvas px-3 text-[13px] font-extrabold text-body transition-colors hover:border-outline hover:bg-surface-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[17px]">
            arrow_back
          </span>
          {isKo ? "다른 구루 선택" : "Choose another guru"}
        </Link>
      ) : null}
    </div>
  );
}
