import { describe, expect, it } from "vitest";
import { normalizeTicker, normalizeTickers } from "./ticker";

describe("normalizeTicker", () => {
  it("normalizes valid tickers", () => {
    expect(normalizeTicker(" aapl ")).toBe("AAPL");
    expect(normalizeTicker("005930")).toBe("005930");
    expect(normalizeTicker("brk.b")).toBe("BRK.B");
  });

  it("rejects placeholder tickers", () => {
    expect(normalizeTicker("UNKNOWN")).toBeNull();
    expect(normalizeTicker(" unknown ")).toBeNull();
  });

  it("normalizes ticker lists while removing placeholders and duplicates", () => {
    expect(normalizeTickers(["UNKNOWN", " aapl ", "AAPL", "005930"])).toEqual([
      "AAPL",
      "005930",
    ]);
  });
});
