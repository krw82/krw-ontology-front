import { describe, expect, it } from "vitest";
import { buildAnalysisCandidates } from "@/lib/pulse/sources/analysis";

const session = {
  id: "session-1",
  title: "리서치: AAPL",
  default_tickers: ["AAPL"],
  latest_run_status: "running" as const,
  updated_at: "2026-07-15T01:05:00.000Z",
};

const running = {
  id: "run-1",
  session_id: session.id,
  user_message_id: "message-user",
  assistant_message_id: "message-assistant",
  status: "running" as const,
  queued_at: "2026-07-15T01:00:00.000Z",
  started_at: "2026-07-15T01:01:00.000Z",
  finished_at: null,
};

describe("Pulse analysis activity source", () => {
  it("maps a user-started run to a status card without submitting new work", () => {
    const messages = new Map([
      ["message-user", { id: "message-user", content: "서비스 매출과 현금흐름을 연결해줘" }],
    ]);
    const [candidate] = buildAnalysisCandidates([session], [running], messages);

    expect(candidate).toMatchObject({
      item_key: "analysis:run-1:active",
      kind: "analysis",
      ticker: "AAPL",
      title: "서비스 매출과 현금흐름을 연결해줘",
      priority: "high",
      metadata: { run_status: "running", user_started: true },
      primary_action: {
        type: "link",
        label: "대화로 돌아가기",
        href: "/chat?sessionId=session-1&ticker=AAPL",
      },
    });
  });

  it("uses a terminal phase identity and keeps answer text out of the feed when completed", () => {
    const completed = {
      ...running,
      status: "completed" as const,
      finished_at: "2026-07-15T01:06:00.000Z",
    };
    const messages = new Map([
      ["message-user", { id: "message-user", content: "서비스 매출과 현금흐름을 연결해줘" }],
      ["message-assistant", { id: "message-assistant", content: "저장된 답변 미리보기입니다." }],
    ]);
    const [candidate] = buildAnalysisCandidates([session], [completed], messages);

    expect(candidate.item_key).toBe("analysis:run-1:completed");
    expect(candidate.eyebrow).toContain("완료");
    expect(candidate.body).toContain("원래 채팅");
    expect(candidate.primary_action).toMatchObject({ label: "결과 이어보기" });
    expect(candidate.secondary_actions).toEqual([]);
  });
});
