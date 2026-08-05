import { describe, expect, it } from "vitest";
import { createUnavailablePulseFeed, withStage } from "@/lib/pulse/composer";

describe("createUnavailablePulseFeed", () => {
  it("returns a renderable, truthful empty shell when a server-side source is unavailable", () => {
    const feed = createUnavailablePulseFeed(new Date("2026-07-17T00:00:00.000Z"));

    expect(feed.candidate_items).toEqual([]);
    expect(feed.active_analysis_items).toEqual([]);
    expect(feed.completed_analysis_items).toEqual([]);
    expect(feed.ranking_version).toBe("rule_v10_research_completion");
    expect(feed.source_statuses.every((source) => source.status === "degraded")).toBe(true);
  });
});

describe("withStage", () => {
  it("passes through the resolved value on success", async () => {
    const result = await withStage("test", async () => 42);
    expect(result).toBe(42);
  });

  it("wraps a thrown error with the stage prefix so server logs identify the failing read", async () => {
    const original = new Error("relation does not exist");
    await expect(withStage("filing-decisions", async () => {
      throw original;
    })).rejects.toThrow(/^pulse:filing-decisions failed: relation does not exist$/);

    try {
      await withStage("signals", async () => {
        throw new Error("network timeout");
      });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("pulse:signals failed: network timeout");
      // The original error is preserved as cause for stack inspection.
      expect((error as Error).cause).toBeDefined();
    }
  });

  it("preserves non-Error throw values in the stage message", async () => {
    await expect(withStage("revision", async () => {
      // eslint-disable-next-line no-throw-literal
      throw "string error";
    })).rejects.toThrow("pulse:revision failed: string error");
  });
});
