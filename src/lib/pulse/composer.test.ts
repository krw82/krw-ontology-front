import { describe, expect, it } from "vitest";
import { createUnavailablePulseFeed } from "@/lib/pulse/composer";

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
