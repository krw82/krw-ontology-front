import { describe, expect, it } from "vitest";
import { normalizeTicker } from "@/lib/ontology/ticker";

describe("ontology catalog ticker validation", () => {
  it("rejects path traversal and path-like ticker input", () => {
    expect(normalizeTicker("../AAPL")).toBeNull();
    expect(normalizeTicker("AAPL/../../etc/passwd")).toBeNull();
    expect(normalizeTicker("AAPL\\..\\secrets")).toBeNull();
    expect(normalizeTicker("BRK.B")).toBeNull();
  });

  it("still normalizes ordinary alphanumeric ticker input", () => {
    expect(normalizeTicker(" msft ")).toBe("MSFT");
    expect(normalizeTicker("brkb")).toBe("BRKB");
    expect(normalizeTicker("1234")).toBe("1234");
  });
});
