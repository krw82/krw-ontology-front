import { describe, expect, it } from "vitest";
import { buildDevelopmentPulseShowcase } from "@/lib/pulse/development";

describe("development Pulse showcase", () => {
  it("includes every production-visible Pulse card variant for local visual review", () => {
    const showcase = buildDevelopmentPulseShowcase(new Date("2026-07-16T00:00:00.000Z"));

    expect(showcase.map((item) => item.kind)).toEqual([
      "filing",
      "analysis",
      "filing",
      "filing",
      "filing",
      "question",
      "resurface",
      "learning",
    ]);
    expect(showcase.filter((item) => item.metadata.form_type === "4")).toHaveLength(3);
    expect(showcase.every((item) => item.metadata.development_showcase === true)).toBe(true);
  });
});
