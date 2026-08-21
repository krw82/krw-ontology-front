import MarketingCtaLink from "@/components/MarketingCtaLink";
import ResearchMarkdown from "@/components/ResearchMarkdown";
import type { SampleResearchAnswer } from "@/content/sample-research-answer.ko";
import type { Locale } from "@/i18n/config";
import { estimatedReadMinutes } from "@/lib/content/sample-answer-display";

interface SampleResearchAnswerCardProps {
  answer: SampleResearchAnswer;
  ctaHref: string;
  locale?: Locale;
  ctaId?: string;
  surface?: string;
}

const SAMPLE_BADGE_LABELS: Record<Locale, string> = {
  ko: "답변 예시",
  en: "Sample answer",
};

const SAMPLE_CTA_LABELS: Record<Locale, string> = {
  ko: "이 질문으로 시작하기",
  en: "Start with this question",
};

/**
 * 비로그인 사용자용 샘플 리서치 답변 카드 (서버 컴포넌트).
 * 섹션 본문은 실제 리서치 답변 마크다운이므로 기존 ResearchMarkdown 렌더러로 그대로 렌더링한다.
 */
export default function SampleResearchAnswerCard({
  answer,
  ctaHref,
  locale = "ko",
  ctaId = "questions_sample_answer_start",
  surface = "questions_index_sample_answer",
}: SampleResearchAnswerCardProps) {
  const readMinutes = estimatedReadMinutes(answer);
  const badgeLabel = SAMPLE_BADGE_LABELS[locale];
  const ctaLabel = SAMPLE_CTA_LABELS[locale];

  return (
    <article className="overflow-hidden rounded-[8px] border border-hairline bg-canvas">
      <div className="p-base sm:p-md md:p-lg">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-primary">
            {answer.ticker}
          </p>
          <span className="rounded-[4px] border border-hairline bg-surface px-2 py-1 text-[11px] font-extrabold leading-4 text-muted">
            {badgeLabel}
          </span>
          <span className="ml-auto text-[12px] font-semibold leading-5 text-muted">
            {answer.askedAtLabel} ·{" "}
            {locale === "ko" ? `약 ${readMinutes}분` : `~${readMinutes} min`}
          </span>
        </div>

        <p className="mt-sm border-l-2 border-primary-container pl-md text-[17px] font-extrabold leading-[1.55] text-ink sm:text-[19px] sm:leading-[1.5]">
          {answer.question}
        </p>

        <div className="mt-lg space-y-lg">
          {answer.sections.map((section) => (
            <section key={section.heading} aria-label={section.heading}>
              <h3 className="mb-sm text-[15px] font-extrabold leading-[1.4] text-ink sm:text-[16px]">
                {section.heading}
              </h3>
              <ResearchMarkdown content={section.body} />
            </section>
          ))}
        </div>
      </div>

      <div className="border-t border-hairline bg-surface px-base py-sm sm:px-md">
        <div className="flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] font-semibold leading-[1.5] text-muted">
            {answer.sourceRunLabel}
          </p>
          <MarketingCtaLink
            href={ctaHref}
            ctaId={ctaId}
            ctaLabel={ctaLabel}
            surface={surface}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-[8px] bg-surface-dark px-5 py-3 text-[13px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas sm:w-auto"
          >
            {ctaLabel}
          </MarketingCtaLink>
        </div>
      </div>
    </article>
  );
}
