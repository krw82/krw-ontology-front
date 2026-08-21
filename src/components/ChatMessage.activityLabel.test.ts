import { describe, expect, it } from "vitest";
import { activityLabel } from "./ChatMessage";

describe("activityLabel", () => {
  it("uses source-neutral progress copy for every stage", () => {
    expect(activityLabel({ stage: "checking_evidence" } as never)).toBe("자료 확인 중");
    expect(activityLabel({ stage: "researching" } as never)).toBe("자료 확인 중");
    expect(activityLabel(null)).toBe("자료 확인 중");
    expect(activityLabel({ stage: "composing" } as never)).toBe("답변 작성 중");
  });
});
