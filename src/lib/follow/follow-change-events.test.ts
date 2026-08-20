import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  emitFollowChange,
  subscribeFollowChange,
} from "./follow-change-events";

describe("follow change events", () => {
  beforeEach(() => {
    // 각 테스트 전에 이전 구독을 정리한다(구독 해제 함수를 직접 쓰지 않는 케이스 대비).
    vi.clearAllMocks();
  });

  it("notifies subscribers for the same ticker only", () => {
    const aapl = vi.fn();
    const msft = vi.fn();
    const offAapl = subscribeFollowChange("AAPL", aapl);
    const offMsft = subscribeFollowChange("MSFT", msft);

    emitFollowChange("AAPL");

    expect(aapl).toHaveBeenCalledTimes(1);
    expect(msft).not.toHaveBeenCalled();

    offAapl();
    offMsft();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const off = subscribeFollowChange("AAPL", listener);
    off();

    emitFollowChange("AAPL");

    expect(listener).not.toHaveBeenCalled();
  });

  it("isolates tickers and keeps other listeners after one unsubscribes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = subscribeFollowChange("AAPL", first);
    subscribeFollowChange("AAPL", second);

    offFirst();
    emitFollowChange("AAPL");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("tolerates emit with no subscribers", () => {
    expect(() => emitFollowChange("TSLA")).not.toThrow();
  });
});
