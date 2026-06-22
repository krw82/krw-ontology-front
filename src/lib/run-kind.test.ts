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

  it("keeps existing defaults for company and news analysis", () => {
    expect(normalizeRunKind("unsupported")).toBe(DEFAULT_RUN_KIND);
    expect(defaultRunKindForAnalysisMode("company")).toBe("company_research");
    expect(defaultRunKindForAnalysisMode("news")).toBe("news_discovery");
  });
});
