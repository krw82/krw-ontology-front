import { describe, expect, it } from "vitest";
import {
  isChatInputError,
  isWeeklyAnalysisLimitError,
  toUserFacingBoundaryError,
  toUserFacingChatError,
} from "./user-facing-error";

describe("user-facing chat errors", () => {
  it("never reflects provider setup instructions", () => {
    const message = toUserFacingChatError(
      "현재 KRW-AI 계정/API 요청 한도에 도달했습니다. 실제 ANTHROPIC_API_KEY를 설정한 뒤 서버를 재시작해주세요.",
    );

    expect(message).toBe("잠시 후 다시 시도해주세요.");
    expect(message).not.toContain("ANTHROPIC");
    expect(message).not.toContain("서버");
  });

  it("keeps product usage limits distinct from provider throttling", () => {
    expect(toUserFacingChatError("주간 분석 한도에 도달했습니다.")).toBe(
      "주간 분석 한도에 도달했습니다.",
    );
    expect(isWeeklyAnalysisLimitError("주간 분석 한도에 도달했습니다.")).toBe(true);
    expect(toUserFacingChatError("upstream rate limit (429)")).toBe(
      "분석 서비스가 잠시 바쁩니다. 잠시 후 다시 시도해주세요.",
    );
  });

  it("keeps deliberate input feedback useful", () => {
    const message = "메시지가 너무 깁니다. 최대 1,000자까지 입력할 수 있습니다.";
    expect(toUserFacingChatError(message)).toBe(message);
    expect(isChatInputError(message)).toBe(true);
  });

  it("keeps error boundaries generic even when a raw error is supplied", () => {
    expect(
      toUserFacingBoundaryError(
        "Error: invalid API key at runAgent (runner.ts:42)",
      ),
    ).toBe("문제가 발생했습니다. 잠시 후 다시 시도해주세요.");
  });
});
