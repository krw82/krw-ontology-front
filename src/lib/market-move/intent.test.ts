import { describe, expect, it } from "vitest";
import {
  extractMentionedPercentMove,
  extractMentionedTickers,
  inferMarketMoveDirection,
  isMarketMoveQuestion,
} from "./intent";

describe("market move intent", () => {
  it("detects Korean stock move questions", () => {
    expect(isMarketMoveQuestion("GOOGL 주가가 왜 6퍼 빠졌어?")).toBe(true);
    expect(inferMarketMoveDirection("GOOGL 주가가 왜 6퍼 빠졌어?")).toBe(
      "down",
    );
    expect(extractMentionedTickers("GOOGL 주가가 왜 6퍼 빠졌어?")).toEqual([
      "GOOGL",
    ]);
    expect(extractMentionedPercentMove("GOOGL 주가가 왜 6퍼 빠졌어?")).toBe(6);
  });

  it("detects neutral price-move questions without an explicit direction", () => {
    expect(isMarketMoveQuestion("오늘 가격 변동 왜있었어?")).toBe(true);
    expect(isMarketMoveQuestion("오늘 가격 변동이 왜이래?")).toBe(true);
    expect(inferMarketMoveDirection("오늘 가격 변동 왜있었어?")).toBe(
      "unknown",
    );
  });

  it("does not treat ordinary company research as a market move question", () => {
    expect(isMarketMoveQuestion("GOOGL 클라우드 매출 구조를 정리해줘")).toBe(
      false,
    );
  });
});
