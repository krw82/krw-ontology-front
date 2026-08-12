import { describe, expect, it } from "vitest";
import { selectTickerBatch } from "./ticker-batches";

describe("selectTickerBatch", () => {
  it("rotates through every ticker page before repeating", () => {
    const tickers = ["A", "B", "C", "D", "E"];

    expect(selectTickerBatch(tickers, 2, 0)).toEqual(["A", "B"]);
    expect(selectTickerBatch(tickers, 2, 1)).toEqual(["C", "D"]);
    expect(selectTickerBatch(tickers, 2, 2)).toEqual(["E"]);
    expect(selectTickerBatch(tickers, 2, 3)).toEqual(["A", "B"]);
  });
});
