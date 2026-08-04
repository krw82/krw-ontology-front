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
    const finishedAt = "2026-07-15T01:06:00.000Z";
    const completed = {
      ...running,
      status: "completed" as const,
      finished_at: finishedAt,
    };
    const messages = new Map([
      ["message-user", { id: "message-user", content: "서비스 매출과 현금흐름을 연결해줘" }],
      ["message-assistant", { id: "message-assistant", content: "저장된 답변 미리보기입니다." }],
    ]);
    // Pass `now` close to finished_at so the 24h notification window still applies.
    const [candidate] = buildAnalysisCandidates([session], [completed], messages, new Date("2026-07-15T02:00:00.000Z"));

    expect(candidate.item_key).toBe("analysis:run-1:completed");
    expect(candidate.eyebrow).toContain("완료");
    expect(candidate.body).toContain("원래 채팅");
    expect(candidate.primary_action).toMatchObject({ label: "결과 이어보기" });
    expect(candidate.secondary_actions).toEqual([]);
  });

  it("drops a completed run older than 24 hours", () => {
    const completed = {
      ...running,
      status: "completed" as const,
      finished_at: "2026-07-15T01:06:00.000Z",
    };
    const messages = new Map([
      ["message-user", { id: "message-user", content: "서비스 매출과 현금흐름을 연결해줘" }],
    ]);
    // 25 hours later — beyond the 24h notification window.
    const candidates = buildAnalysisCandidates([session], [completed], messages, new Date("2026-07-16T02:06:00.000Z"));
    expect(candidates).toHaveLength(0);
  });

  it("drops a failed run instead of surfacing it", () => {
    const failed = {
      ...running,
      status: "failed" as const,
      finished_at: "2026-07-15T01:06:00.000Z",
    };
    const messages = new Map([
      ["message-user", { id: "message-user", content: "서비스 매출과 현금흐름을 연결해줘" }],
    ]);
    const candidates = buildAnalysisCandidates([session], [failed], messages, new Date("2026-07-15T02:00:00.000Z"));
    expect(candidates).toHaveLength(0);
  });

  describe("wide research (ticker-less global session)", () => {
    const wideSession = {
      ...session,
      id: "session-wide",
      title: "PCE 인플레이션 전망",
      default_tickers: [] as string[],
    };
    const wideRunning = { ...running, id: "run-wide", session_id: wideSession.id };

    it("maps a ticker-less run to a candidate with wide-research copy and idea_generation link", () => {
      const messages = new Map([
        ["message-user", { id: "message-user", content: "PCE 인플레이션 전망이 빗나가는 원인?" }],
      ]);
      const [candidate] = buildAnalysisCandidates([wideSession], [wideRunning], messages);

      expect(candidate.ticker).toBeNull();
      expect(candidate.eyebrow).toBe("와이드 리서치 · 진행 중");
      expect(candidate.reason_label).toContain("매크로/와이드 리서치");
      // No ticker param; runKind=idea_generation so the chat opens in wide mode.
      expect(candidate.primary_action).toMatchObject({
        type: "link",
        href: "/chat?sessionId=session-wide&runKind=idea_generation",
      });
      expect(candidate.metadata).toMatchObject({ scope_type: "global" });
    });

    it("uses a completed wide-research phase identity", () => {
      const completed = {
        ...wideRunning,
        status: "completed" as const,
        finished_at: "2026-07-15T01:06:00.000Z",
      };
      const messages = new Map([
        ["message-user", { id: "message-user", content: "PCE 인플레이션 전망이 빗나가는 원인?" }],
      ]);
      const [candidate] = buildAnalysisCandidates(
        [wideSession],
        [completed],
        messages,
        new Date("2026-07-15T02:00:00.000Z"),
      );

      expect(candidate.eyebrow).toBe("와이드 리서치 · 완료");
      expect(candidate.ticker).toBeNull();
    });

    it("keeps company-scoped copy unchanged for ticker-bearing sessions (regression)", () => {
      const messages = new Map([
        ["message-user", { id: "message-user", content: "서비스 매출" }],
      ]);
      const [candidate] = buildAnalysisCandidates([session], [running], messages);

      expect(candidate.eyebrow).toBe("내가 시작한 분석 · 진행 중");
      expect(candidate.reason_label).toContain("회사 채팅");
      expect(candidate.metadata).toMatchObject({ scope_type: "company" });
      expect(candidate.primary_action).toMatchObject({
        type: "link",
        href: "/chat?sessionId=session-1&ticker=AAPL",
      });
    });
  });
});
