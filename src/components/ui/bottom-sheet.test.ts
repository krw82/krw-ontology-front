import { describe, expect, it } from "vitest";
import {
  BOTTOM_SHEET_DISMISS_DISTANCE_PX,
  BOTTOM_SHEET_DISMISS_VELOCITY_PX_PER_SECOND,
  shouldDismissBottomSheet,
} from "./bottom-sheet";

describe("shouldDismissBottomSheet", () => {
  it("dismisses after a deliberate downward drag", () => {
    expect(
      shouldDismissBottomSheet(
        BOTTOM_SHEET_DISMISS_DISTANCE_PX + 1,
        0,
      ),
    ).toBe(true);
  });

  it("dismisses after a short fast downward flick", () => {
    expect(
      shouldDismissBottomSheet(
        12,
        BOTTOM_SHEET_DISMISS_VELOCITY_PX_PER_SECOND + 1,
      ),
    ).toBe(true);
  });

  it("does not dismiss for a small, slow drag or an upward drag", () => {
    expect(
      shouldDismissBottomSheet(
        BOTTOM_SHEET_DISMISS_DISTANCE_PX,
        BOTTOM_SHEET_DISMISS_VELOCITY_PX_PER_SECOND,
      ),
    ).toBe(false);
    expect(shouldDismissBottomSheet(-120, -900)).toBe(false);
  });
});
