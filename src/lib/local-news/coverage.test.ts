import { describe, expect, it, vi } from "vitest";

import { listLocalNewsCoverageTickers } from "@/lib/local-news/coverage";

describe("listLocalNewsCoverageTickers", () => {
  it("accepts only active catalog ticker rows returned by the service-only RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { ticker: "msft", coverage_count: 2, max_priority: 0 },
        { ticker: "AAPL", coverage_count: "1", max_priority: "0" },
        { ticker: "not a ticker", coverage_count: 4, max_priority: 9 },
      ],
      error: null,
    });

    await expect(listLocalNewsCoverageTickers({ rpc } as never, "prod")).resolves.toEqual([
      { ticker: "MSFT", coverageCount: 2, maxPriority: 0 },
      { ticker: "AAPL", coverageCount: 1, maxPriority: 0 },
    ]);
    expect(rpc).toHaveBeenCalledWith("list_market_news_coverage_tickers", {
      p_environment: "prod",
    });
  });

  it("fails closed when the RPC errors", async () => {
    const error = new Error("permission denied");
    const rpc = vi.fn().mockResolvedValue({ data: null, error });

    await expect(listLocalNewsCoverageTickers({ rpc } as never, "prod")).rejects.toBe(error);
  });
});
