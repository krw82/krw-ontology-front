import { describe, expect, it } from "vitest";
import type { MessageRow } from "@/types/database";
import {
  buildSessionMessages,
  pickFirstAssistantAnswer,
  buildSessionShareTitle,
} from "@/lib/share/session-share-message";

function msg(
  id: string,
  role: "user" | "assistant",
  content: string,
  createdAt: string,
  status: MessageRow["status"] = "completed",
): MessageRow {
  return {
    id,
    session_id: "session-1",
    role,
    content,
    status,
    created_at: createdAt,
    updated_at: createdAt,
  } as MessageRow;
}

describe("buildSessionMessages", () => {
  it("pairs user question with assistant completed answer", () => {
    const rows = [
      msg("u1", "user", "질문1", "2026-01-01T00:00:00Z"),
      msg("a1", "assistant", "답변1", "2026-01-01T00:01:00Z"),
    ];
    const result = buildSessionMessages(rows);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
  });

  it("excludes user message without following assistant answer", () => {
    const rows = [
      msg("u1", "user", "질문1", "2026-01-01T00:00:00Z"),
      msg("a1", "assistant", "답변1", "2026-01-01T00:01:00Z"),
      msg("u2", "user", "고마워", "2026-01-01T00:02:00Z"), // 답변 없음
    ];
    const result = buildSessionMessages(rows);
    expect(result).toHaveLength(2);
    expect(result.find((m) => m.content === "고마워")).toBeUndefined();
  });

  it("excludes non-completed assistant messages", () => {
    const rows = [
      msg("u1", "user", "질문1", "2026-01-01T00:00:00Z"),
      msg("a1", "assistant", "진행중", "2026-01-01T00:01:00Z", "streaming"),
      msg("a2", "assistant", "완료답변", "2026-01-01T00:02:00Z", "completed"),
    ];
    const result = buildSessionMessages(rows);
    expect(result).toHaveLength(2); // u1 + a2 only
    expect(result[1].content).toContain("완료답변");
  });

  it("sorts by created_at ascending", () => {
    const rows = [
      msg("a1", "assistant", "답변1", "2026-01-01T00:02:00Z"),
      msg("u1", "user", "질문1", "2026-01-01T00:00:00Z"),
      msg("a0", "assistant", "답변0", "2026-01-01T00:01:00Z"),
    ];
    const result = buildSessionMessages(rows);
    expect(result.map((m) => m.created_at)).toEqual([
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:01:00Z",
      "2026-01-01T00:02:00Z",
    ]);
  });
});

describe("pickFirstAssistantAnswer", () => {
  it("returns first completed assistant content", () => {
    const rows = [
      msg("u1", "user", "질문", "2026-01-01T00:00:00Z"),
      msg("a1", "assistant", "첫답변", "2026-01-01T00:01:00Z"),
    ];
    expect(pickFirstAssistantAnswer(rows)).toBe("첫답변");
  });

  it("returns empty string when no completed assistant", () => {
    const rows = [msg("u1", "user", "질문", "2026-01-01T00:00:00Z")];
    expect(pickFirstAssistantAnswer(rows)).toBe("");
  });
});

describe("buildSessionShareTitle", () => {
  it("builds title from first answer content", () => {
    const title = buildSessionShareTitle("## 삼성전자 실적 요약\n내용...", "폴백");
    expect(title).toBe("삼성전자 실적 요약");
  });

  it("uses fallback when content empty", () => {
    expect(buildSessionShareTitle("", "폴백")).toBe("폴백");
  });
});
