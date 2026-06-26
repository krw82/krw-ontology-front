import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUN_KIND,
  defaultRunKindForAnalysisMode,
  normalizeRunKind,
} from "./run-kind";

describe("run kind", () => {
  it("accepts idea generation as a durable run kind", () => {
    expect(normalizeRunKind("idea_generation")).toBe("idea_generation");
  });

  it("accepts market move research as a durable run kind", () => {
    expect(normalizeRunKind("market_move_research")).toBe(
      "market_move_research",
    );
  });

  it("accepts scenario sensitivity as a durable run kind", () => {
    expect(normalizeRunKind("scenario_sensitivity")).toBe(
      "scenario_sensitivity",
    );
  });

  it("keeps existing defaults for company and news analysis", () => {
    expect(normalizeRunKind("unsupported")).toBe(DEFAULT_RUN_KIND);
    expect(defaultRunKindForAnalysisMode("company")).toBe("company_research");
    expect(defaultRunKindForAnalysisMode("news")).toBe("news_discovery");
  });
});
