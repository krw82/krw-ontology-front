import type { SampleResearchAnswer } from "@/content/sample-research-answer.ko";
import { normalizeTicker } from "@/lib/ontology/ticker";

const CHARS_PER_MINUTE = 900;

/**
 * 샘플 답변의 원문 질문으로 chat 시작 href를 만든다.
 * chat 시작 파라미터 규격(/chat/new?query=...&ticker=...)과 동일하게 맞춘다.
 */
export function sampleAnswerCtaHref(answer: SampleResearchAnswer): string {
  const query = encodeURIComponent(answer.question.trim());
  const ticker =
    normalizeTicker(answer.ticker) ?? answer.ticker.trim().toUpperCase();

  return `/chat/new?query=${query}&ticker=${ticker}`;
}

/** 섹션 본문 글자 수 기준으로 예상 독서 시간(분)을 계산한다. 최소 1분. */
export function estimatedReadMinutes(
  answer: Pick<SampleResearchAnswer, "sections">,
): number {
  const totalChars = answer.sections.reduce(
    (sum, section) => sum + section.heading.length + section.body.length,
    0,
  );

  return Math.max(1, Math.ceil(totalChars / CHARS_PER_MINUTE));
}
