import { describe, expect, it } from "vitest";
import { buildSessionPreview } from "./session-preview";

describe("buildSessionPreview", () => {
  it("hides raw KRW-AI login errors from the sidebar", () => {
    expect(
      buildSessionPreview({
        content: "KRW-AI returned an error result: Not logged in · Please run /login",
        status: "completed",
      }),
    ).toBe("KRW-AI 인증이 필요합니다.");
  });

  it("uses a generic preview for failed messages", () => {
    expect(
      buildSessionPreview({
        content: "internal raw failure",
        status: "failed",
      }),
    ).toBe("응답 생성에 실패했습니다.");
  });

  it("uses a generic preview for cancelled messages", () => {
    expect(
      buildSessionPreview({
        content: "partial internal output",
        status: "cancelled",
      }),
    ).toBe("응답 생성을 취소했습니다.");
  });

  it("compacts normal message previews", () => {
    expect(
      buildSessionPreview({
        content: "첫 줄\n\n둘째 줄",
        status: "completed",
      }),
    ).toBe("첫 줄 둘째 줄");
  });

  it("hides assistant internal narration from previews", () => {
    expect(
      buildSessionPreview({
        role: "assistant",
        content:
          "Let me retrieve more evidence.분석 결과를 작성하겠습니다.\n\n---\n\n최종 답변입니다.",
        status: "completed",
      }),
    ).toBe("최종 답변입니다.");
  });

  it("keeps user text that looks like an English instruction", () => {
    expect(
      buildSessionPreview({
        role: "user",
        content: "Let me retrieve라고 사용자가 직접 입력",
        status: "completed",
      }),
    ).toBe("Let me retrieve라고 사용자가 직접 입력");
  });
});
