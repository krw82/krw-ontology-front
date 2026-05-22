import { afterEach, describe, expect, it, vi } from "vitest";
import { readFloatEnv, readIntEnv } from "./env";

describe("env number readers", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("uses the fallback for missing or invalid integer values", () => {
    process.env.TEST_INT = "abc";

    expect(readIntEnv("MISSING_TEST_INT", 7, { min: 1 })).toBe(7);
    expect(readIntEnv("TEST_INT", 7, { min: 1 })).toBe(7);
  });

  it("rejects out-of-range numeric values", () => {
    process.env.TEST_INT = "0";
    process.env.TEST_FLOAT = "-1";

    expect(readIntEnv("TEST_INT", 5, { min: 1 })).toBe(5);
    expect(readFloatEnv("TEST_FLOAT", 1.5, { min: 0 })).toBe(1.5);
  });

  it("returns valid integer and float values", () => {
    process.env.TEST_INT = "12";
    process.env.TEST_FLOAT = "2.75";

    expect(readIntEnv("TEST_INT", 5, { min: 1 })).toBe(12);
    expect(readFloatEnv("TEST_FLOAT", 1.5, { min: 0 })).toBe(2.75);
  });
});
