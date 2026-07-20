import type { PulseFeedSummary } from "@/types/api-contracts";

interface PulseSummaryBarProps {
  summary: PulseFeedSummary;
}

export default function PulseSummaryBar({ summary }: PulseSummaryBarProps) {
  const parts = [
    summary.counts.filing ? `새 공시 ${summary.counts.filing}` : null,
    summary.counts.question ? `이어볼 질문 ${summary.counts.question}` : null,
    summary.counts.resurface ? `다시 볼 리서치 ${summary.counts.resurface}` : null,
  ].filter((value): value is string => Boolean(value));

  if (parts.length === 0) return null;

  return (
    <section className="mb-lg rounded-[16px] border border-hairline bg-white px-base py-base shadow-[0_8px_24px_rgba(16,24,40,0.04)] sm:px-lg" aria-label="현재 피드 요약">
      <p className="text-[11px] font-black uppercase tracking-[0.15em] text-primary">지금 확인할 항목</p>
      <p className="mt-1 text-[14px] font-extrabold text-ink">{parts.join(" · ")}</p>
      <p className="mt-xs text-[12px] font-semibold leading-5 text-muted">
        위에서부터 변화와 출처를 확인하고, 카드 안에서 판단을 마무리하세요.
      </p>
    </section>
  );
}
