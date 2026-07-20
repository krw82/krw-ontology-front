import { describe, expect, it } from "vitest";
import {
  boundedFocusAnchorTarget,
  calculateKeyboardOffset,
} from "./useChatMobileDock";

describe("mobile chat dock geometry", () => {
  it("derives the keyboard overlap from the visual viewport", () => {
    expect(
      calculateKeyboardOffset({
        layoutViewportHeight: 844,
        visualViewportHeight: 510,
        visualViewportOffsetTop: 0,
      }),
    ).toBe(334);
    expect(
      calculateKeyboardOffset({
        layoutViewportHeight: 844,
        visualViewportHeight: 820,
        visualViewportOffsetTop: 30,
      }),
    ).toBe(0);
  });

  it("bounds focus correction so the page cannot snap excessively", () => {
    expect(
      boundedFocusAnchorTarget({ currentTop: 1_000, targetTop: 1_120 }),
    ).toBe(1_120);
    expect(
      boundedFocusAnchorTarget({ currentTop: 1_000, targetTop: 2_000 }),
    ).toBe(1_480);
    expect(
      boundedFocusAnchorTarget({ currentTop: 100, targetTop: -1_000 }),
    ).toBe(0);
  });
});
