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

  it("compacts normal message previews", () => {
    expect(
      buildSessionPreview({
        content: "첫 줄\n\n둘째 줄",
        status: "completed",
      }),
    ).toBe("첫 줄 둘째 줄");
  });
});
