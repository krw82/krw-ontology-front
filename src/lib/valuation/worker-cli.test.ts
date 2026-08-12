import { describe, expect, it } from "vitest";
import { parseValuationTickerList, parseValuationWorkerCli } from "./worker-cli";

describe("valuation worker CLI", () => {
  it("normalizes, validates, and deduplicates ticker overrides", () => {
    expect(parseValuationTickerList(" aapl,MSFT,aapl,invalid ticker,BRK-B ")).toEqual([
      "AAPL",
      "MSFT",
      "BRK-B",
    ]);
  });

  it("supports one-shot execution and help without requiring a worker process", () => {
    expect(parseValuationWorkerCli(["--once", "--tickers", "AAPL,MSFT"])).toEqual({
      once: true,
      help: false,
      tickers: ["AAPL", "MSFT"],
    });
    expect(parseValuationWorkerCli(["--help"])).toEqual({
      once: false,
      help: true,
      tickers: [],
    });
  });

  it("rejects unknown flags and missing ticker values", () => {
    expect(() => parseValuationWorkerCli(["--unexpected"])).toThrow(
      "Unknown valuation worker argument",
    );
    expect(() => parseValuationWorkerCli(["--tickers"])).toThrow(
      "--tickers requires a comma-separated value",
    );
    expect(() => parseValuationWorkerCli(["--tickers", "invalid ticker"])).toThrow(
      "--tickers did not contain a valid ticker",
    );
  });
});
