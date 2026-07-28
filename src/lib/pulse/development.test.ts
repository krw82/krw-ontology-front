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
    expect(showcase.filter((item) => item.metadata.form_type === "4").every(
      (item) => item.metadata.form4_has_reported_open_market_trade === true,
    )).toBe(true);
    expect(showcase.every((item) => item.metadata.development_showcase === true)).toBe(true);
  });

  it("uses neutral product copy rather than development-preview text", () => {
    const showcase = buildDevelopmentPulseShowcase(new Date("2026-07-16T00:00:00.000Z"));
    const visibleCopy = showcase.flatMap((item) => [item.eyebrow, item.title, item.body, item.reason_label]);

    expect(visibleCopy.join(" ")).not.toMatch(/개발|미리보기|점검/u);
  });
});
