"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import MarketingCtaLink from "@/components/MarketingCtaLink";
import {
  buildGuruLensHref,
  GURU_DIRECTORY_LENSES,
  getGuruLensDisplayName,
} from "@/lib/guru-lenses";
import { trackClientEventWithTimeout } from "@/lib/analytics/client";

export interface CompanyGuruLensPickerProps {
  ticker: string;
  companyName: string;
  locale: string;
  ctaLabel: string;
}

/**
 * The company page must never silently choose a Guru. This keeps company
 * context in place while requiring an explicit, named lens before a Guru run
 * can start.
 */
export default function CompanyGuruLensPicker({
  ticker,
  companyName,
  locale,
  ctaLabel,
}: CompanyGuruLensPickerProps) {
  const [open, setOpen] = useState(false);
  const isKo = locale === "ko";

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function openPicker() {
    void trackClientEventWithTimeout("cta_clicked", {
      cta_id: "company_open_guru",
      cta_label: ctaLabel,
      surface: "company_hero",
      source_surface: "company_hero",
      destination: `/guru?${new URLSearchParams({
        selectGuru: "1",
        ticker,
        ...(locale !== "ko" ? { locale } : {}),
      }).toString()}`,
      ticker,
      company_name: companyName,
    });
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[8px] border border-hairline bg-canvas px-5 py-3 text-[15px] font-extrabold leading-5 text-ink transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[19px]"
        >
          psychology
        </span>
        {ctaLabel}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            className="fixed inset-0 z-[170] flex items-end sm:items-center sm:justify-center"
            role="presentation"
            initial={false}
          >
            <motion.button
              type="button"
              aria-label={isKo ? "구루 선택 닫기" : "Close guru selection"}
              className="absolute inset-0 bg-ink/24"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setOpen(false)}
            />
            <motion.section
              className="relative z-10 w-full overflow-hidden rounded-t-[24px] border-t border-hairline bg-canvas text-ink shadow-[0_-18px_54px_rgba(10,11,13,0.18)] sm:max-w-[840px] sm:rounded-[18px] sm:border sm:shadow-[0_24px_70px_rgba(10,11,13,0.22)]"
              role="dialog"
              aria-modal="true"
              aria-label={
                isKo
                  ? `${companyName} 구루 관점 선택`
                  : `Choose a Guru lens for ${companyName}`
              }
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <div className="max-h-[min(84dvh,720px)] overflow-y-auto px-base pb-[calc(env(safe-area-inset-bottom)+20px)] pt-md sm:p-lg">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-primary">
                      Guru lens selection
                    </p>
                    <h2 className="mt-1 text-balance text-[24px] font-black leading-8 text-ink sm:text-[28px]">
                      {isKo
                        ? `${companyName}을 어떤 관점으로 볼까요?`
                        : `Which lens should we use for ${companyName}?`}
                    </h2>
                    <p className="mt-2 max-w-2xl text-[14px] font-semibold leading-6 text-muted">
                      {isKo
                        ? "자동 선택하지 않습니다. 구루를 고르면 그 투자 원칙으로 회사에 특화된 질문을 만들고, 공시 근거를 조사해 해석합니다."
                        : "No lens is selected automatically. Choose a guru to generate company-specific questions, research filing evidence, and interpret it through that investing philosophy."}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-dim hover:text-ink"
                    onClick={() => setOpen(false)}
                    aria-label={isKo ? "구루 선택 닫기" : "Close guru selection"}
                  >
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined text-[22px]"
                    >
                      close
                    </span>
                  </button>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {GURU_DIRECTORY_LENSES.map((lens) => {
                    const displayName = getGuruLensDisplayName(lens, locale);
                    const affiliation = isKo
                      ? lens.affiliationKo
                      : lens.affiliationEn;
                    const perspective = isKo
                      ? lens.perspectiveKo
                      : lens.perspectiveEn;
                    const href = buildGuruLensHref(lens.key, locale, ticker);

                    return (
                      <MarketingCtaLink
                        key={lens.key}
                        href={href}
                        ctaId="company_select_guru"
                        ctaLabel={displayName}
                        surface="company_guru_picker"
                        analyticsProperties={{
                          ticker,
                          company_name: companyName,
                          guru_lens: lens.key,
                        }}
                        className="group flex min-h-[218px] min-w-0 flex-col rounded-[8px] border border-hairline bg-canvas p-4 text-left text-ink transition-[background-color,border-color,color] hover:border-primary hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <span className="block min-w-0 text-[17px] font-black leading-6 text-ink">
                          {displayName}
                        </span>
                        <span className="mt-1 block min-w-0 truncate font-mono text-[10px] font-black uppercase leading-4 tracking-[0.12em] text-primary">
                          {affiliation}
                        </span>
                        <p className="mt-4 text-[13px] font-semibold leading-5 text-body">
                          {perspective}
                        </p>
                        <span className="mt-auto flex items-center justify-between pt-4 text-[11px] font-black leading-4 text-muted group-hover:text-primary">
                          <span>
                            {isKo
                              ? `${ticker} 이 관점으로 보기`
                              : `View ${ticker} with this lens`}
                          </span>
                          <span
                            aria-hidden="true"
                            className="material-symbols-outlined text-[18px] transition-transform group-hover:translate-x-0.5"
                          >
                            arrow_forward
                          </span>
                        </span>
                      </MarketingCtaLink>
                    );
                  })}
                </div>
              </div>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
