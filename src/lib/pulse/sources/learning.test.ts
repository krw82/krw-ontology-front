import { beforeEach, describe, expect, it, vi } from "vitest";

const editorialMocks = vi.hoisted(() => ({
  getEditorialLearningCandidates: vi.fn(),
}));

vi.mock("@/lib/pulse/sources/editorial", () => ({
  getEditorialLearningCandidates: editorialMocks.getEditorialLearningCandidates,
}));

import {
  buildLearningCandidates,
  getLearningCandidates,
  selectLearningCandidate,
} from "@/lib/pulse/sources/learning";
import { pulseLearningEntrySchema } from "@/lib/pulse/learning-schema";

describe("Pulse learning source", () => {
  beforeEach(() => {
    editorialMocks.getEditorialLearningCandidates.mockReset();
  });

  it("rotates exactly one curated entry after per-item state filtering", () => {
    const candidates = buildLearningCandidates(new Date("2026-07-15T00:00:00.000Z"));
    const first = selectLearningCandidate(candidates, "user-1", new Date("2026-07-15T00:00:00.000Z"));
    const sameWeek = selectLearningCandidate(candidates, "user-1", new Date("2026-07-17T00:00:00.000Z"));
    expect(first).toHaveLength(1);
    expect(sameWeek[0]?.source_id).toBe(first[0]?.source_id);
    expect(first[0]?.metadata.source_label).toBeTruthy();
  });

  it("uses the next week as a deterministic rotation seed", () => {
    const candidates = buildLearningCandidates(new Date("2026-07-15T00:00:00.000Z"));
    const first = selectLearningCandidate(candidates, "user-1", new Date("2026-07-15T00:00:00.000Z"));
    const nextWeek = selectLearningCandidate(candidates, "user-1", new Date("2026-07-22T00:00:00.000Z"));
    expect(nextWeek).toHaveLength(1);
    expect(first[0]?.metadata.source_label).toBeTruthy();
  });

  it("keeps a small priority-sorted early company-story reservoir for the device", () => {
    const [base] = buildLearningCandidates(new Date("2026-07-15T00:00:00.000Z"));
    expect(base).toBeTruthy();
    const lowPriority = {
      ...base!,
      item_key: "learning:company-low",
      source_id: "company-low",
      metadata: { ...base!.metadata, editorial_placement: "early", editorial_priority: 1 },
    };
    const highPriority = {
      ...base!,
      item_key: "learning:company-high",
      source_id: "company-high",
      metadata: { ...base!.metadata, editorial_placement: "early", editorial_priority: 9 },
    };
    const first = selectLearningCandidate([lowPriority, highPriority], "user-1", new Date("2026-07-15T00:00:00.000Z"));
    const refreshed = selectLearningCandidate([lowPriority, highPriority], "user-1", new Date("2026-07-15T22:00:00.000Z"));

    expect(first.map((candidate) => candidate.source_id)).toEqual(["company-high", "company-low"]);
    expect(refreshed.map((candidate) => candidate.source_id)).toEqual(["company-high", "company-low"]);
  });

  it("mixes personally relevant, editorial, and exploratory company-story candidates", () => {
    const [base] = buildLearningCandidates(new Date("2026-07-15T00:00:00.000Z"));
    expect(base).toBeTruthy();
    const story = (id: string, options: {
      priority: number;
      coverage?: "interest" | null;
      recentResearch?: boolean;
      affinity?: number;
    }) => ({
      ...base!,
      item_key: `learning:${id}`,
      source_id: id,
      ticker: id.toUpperCase(),
      coverage_level: options.coverage ?? null,
      has_recent_research: options.recentResearch ?? false,
      research_affinity: options.affinity ?? 0,
      metadata: {
        ...base!.metadata,
        editorial_placement: "early",
        editorial_priority: options.priority,
      },
    });
    const candidates = [
      story("personal-interest", { priority: 0, coverage: "interest" }),
      story("personal-research", { priority: 0, recentResearch: true, affinity: 8 }),
      ...Array.from({ length: 10 }, (_, index) => story(`editorial-${index}`, { priority: 10 - index })),
    ];

    const selected = selectLearningCandidate(
      candidates,
      "user-1",
      new Date("2026-07-15T00:00:00.000Z"),
    );

    expect(selected).toHaveLength(8);
    expect(selected.map((candidate) => candidate.source_id)).toContain("personal-interest");
    expect(selected.map((candidate) => candidate.source_id)).toContain("personal-research");
    expect(selected.filter((candidate) => candidate.metadata.editorial_candidate_role === "personal"))
      .toHaveLength(2);
    expect(selected.filter((candidate) => candidate.metadata.editorial_candidate_role === "explore"))
      .toHaveLength(2);
    expect(new Set(selected.map((candidate) => candidate.item_key))).toHaveLength(8);
  });

  it("rejects content without a source link and incomplete four-panel text", () => {
    const invalid = {
      slug: "invalid",
      kind: "four_panel",
      title: "제목",
      body: "요약",
      action_label: "보기",
      action_href: "/filings",
      source_label: "출처",
      source_href: "",
      active_from: "2026-01-01T00:00:00.000Z",
      active_until: "2027-01-01T00:00:00.000Z",
    };
    expect(pulseLearningEntrySchema.safeParse(invalid).success).toBe(false);
  });

  it("keeps a static learning card available when editorial retrieval fails", async () => {
    editorialMocks.getEditorialLearningCandidates.mockRejectedValue(new Error("offline"));

    const candidates = await getLearningCandidates(
      {} as never,
      new Date("2026-07-15T00:00:00.000Z"),
    );

    expect(candidates.length).toBeGreaterThan(0);
  });
});
