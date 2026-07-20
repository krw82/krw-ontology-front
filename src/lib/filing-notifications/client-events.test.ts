import { describe, expect, it } from "vitest";
import {
  filingUnreadBadgeText,
  normalizeFilingUnreadCount,
} from "./client-events";

describe("filing unread client events", () => {
  it("accepts bounded non-negative integer counts", () => {
    expect(normalizeFilingUnreadCount(0)).toBe(0);
    expect(normalizeFilingUnreadCount(42)).toBe(42);
    expect(normalizeFilingUnreadCount(2_000)).toBe(999);
  });

  it.each([-1, 1.5, Number.NaN, "4", null])(
    "rejects invalid unread count %s",
    (value) => {
      expect(normalizeFilingUnreadCount(value)).toBeNull();
    },
  );

  it("keeps the visual badge compact", () => {
    expect(filingUnreadBadgeText(9)).toBe("9");
    expect(filingUnreadBadgeText(100)).toBe("99+");
  });
});
