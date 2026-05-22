import { describe, expect, it } from "vitest";
import {
  isPlainObject,
  isUuid,
  normalizeStringList,
  parseNonNegativeIntParam,
  parsePositiveIntParam,
} from "./validation";

describe("api validation helpers", () => {
  it("recognizes plain objects only", () => {
    expect(isPlainObject({ ok: true })).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
  });

  it("validates UUID strings", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
  });

  it("normalizes string lists by trimming, removing empties, and deduping", () => {
    expect(normalizeStringList([" AAPL ", "", "AAPL", " MSFT "])).toEqual([
      "AAPL",
      "MSFT",
    ]);
  });

  it("parses bounded positive query integers strictly", () => {
    expect(parsePositiveIntParam("12", 1, { max: 50 })).toBe(12);
    expect(parsePositiveIntParam("0", 1)).toBe(1);
    expect(parsePositiveIntParam("12abc", 1)).toBe(1);
    expect(parsePositiveIntParam("100", 1, { max: 50 })).toBe(50);
  });

  it("parses bounded non-negative query integers strictly", () => {
    expect(parseNonNegativeIntParam("0", 7)).toBe(0);
    expect(parseNonNegativeIntParam("42", 7, { max: 10 })).toBe(10);
    expect(parseNonNegativeIntParam("-1", 7)).toBe(7);
    expect(parseNonNegativeIntParam("1.5", 7)).toBe(7);
  });
});
