import type { MessageRow } from "@/types/database";
import { buildShareTitle } from "@/lib/share/message-share";

const SESSION_SHARE_MESSAGE_LIMIT = 100;

export interface SessionShareMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

/**
 * message_shares 테이블의 messages JSONB에 들어갈 직렬화된 메시지 배열을 만든다.
 *
 * 규칙 (spec 섹션 4.2):
 * - completed assistant 답변을 기준점으로 삼는다.
 * - 각 답변 바로 직전(이전 포함 메시지 이후)의 user 메시지들을 질문으로 포함한다.
 * - 답변 없이 뒤따르는 user 발언은 제외된다.
 * - streaming/pending/failed assistant 메시지는 제외된다.
 * - 결과는 created_at 오름차순 정렬된다.
 */
export function buildSessionMessages(rows: MessageRow[]): SessionShareMessage[] {
  const sorted = [...rows].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );

  const result: SessionShareMessage[] = [];
  let lastIncludedIndex = -1;

  for (let i = 0; i < sorted.length; i += 1) {
    const row = sorted[i];
    if (row.role === "assistant" && row.status === "completed") {
      // 이전 포함 메시지 이후부터 현재 답변 직전까지의 user 메시지 포함
      for (let j = lastIncludedIndex + 1; j < i; j += 1) {
        const candidate = sorted[j];
        if (candidate.role === "user" && candidate.content.trim()) {
          result.push(toSessionMessage(candidate));
          lastIncludedIndex = j;
        }
      }
      // 현재 assistant 답변 포함
      result.push(toSessionMessage(row));
      lastIncludedIndex = i;
    }
  }

  return result.slice(0, SESSION_SHARE_MESSAGE_LIMIT * 2);
}

function toSessionMessage(row: MessageRow): SessionShareMessage {
  return {
    role: row.role as "user" | "assistant",
    content: row.content,
    created_at: row.created_at,
  };
}

/**
 * 첫 completed assistant 답변의 content를 반환한다.
 * buildSessionShareTitle의 입력으로 사용된다.
 */
export function pickFirstAssistantAnswer(rows: MessageRow[]): string {
  const sorted = [...rows].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const first = sorted.find(
    (r) => r.role === "assistant" && r.status === "completed",
  );
  return first?.content ?? "";
}

/**
 * 첫 completed assistant 답변에서 세션 공유 제목을 만든다.
 * buildShareTitle()을 재사용한다 (spec: 첫 답변 제목).
 */
export function buildSessionShareTitle(
  firstAnswerContent: string,
  fallbackTitle?: string,
): string {
  return buildShareTitle(firstAnswerContent, fallbackTitle);
}
