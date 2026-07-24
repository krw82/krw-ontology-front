import { afterEach, describe, expect, it, vi } from "vitest";
import { saveInterestCoverage } from "./client";

describe("saveInterestCoverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists the interest coverage level through the existing watchlist route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await saveInterestCoverage("AAPL");

    expect(fetchMock).toHaveBeenCalledWith("/api/watchlist/AAPL", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverage_level: "interest" }),
    });
  });

  it("keeps the picker open when the interest save fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 409 })));

    await expect(saveInterestCoverage("AAPL")).rejects.toThrow(
      "interest_coverage_save_failed",
    );
  });
});
