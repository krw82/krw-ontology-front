import { describe, expect, it } from "vitest";
import { buildLearningCandidates } from "@/lib/pulse/sources/learning";
import { pulseLearningEntrySchema } from "@/lib/pulse/learning-schema";

describe("Pulse learning source", () => {
  it("serves exactly one curated entry per week without generation", () => {
    const first = buildLearningCandidates(new Date("2026-07-15T00:00:00.000Z"));
    const sameWeek = buildLearningCandidates(new Date("2026-07-17T00:00:00.000Z"));
    expect(first).toHaveLength(1);
    expect(sameWeek[0]?.source_id).toBe(first[0]?.source_id);
    expect(first[0]?.metadata.source_label).toBeTruthy();
  });

  it("rotates to a different curated entry in the following week", () => {
    const first = buildLearningCandidates(new Date("2026-07-15T00:00:00.000Z"));
    const nextWeek = buildLearningCandidates(new Date("2026-07-22T00:00:00.000Z"));
    expect(nextWeek[0]?.source_id).not.toBe(first[0]?.source_id);
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
});
