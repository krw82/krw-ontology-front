import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeVisualizationToolIntent } from "./create-visualization-tool";

describe("normalizeVisualizationToolIntent", () => {
  it("pairs bare Korean legend labels with the corresponding runtime source scopes", () => {
    const intent = normalizeVisualizationToolIntent({
      goal: "Zeta CY2025 권역별 영업이익 구성",
      include_scopes: ["Northern Arc", "Coastal Cluster"],
      series_label_hints: ["북부 권역", "해안 권역"],
    });

    expect(intent.series_label_hints).toEqual([
      { source: "Northern Arc", label: "북부 권역" },
      { source: "Coastal Cluster", label: "해안 권역" },
    ]);
  });

  it("does not positionally pair bare labels without a complete source scope list", () => {
    const intent = normalizeVisualizationToolIntent({
      goal: "Zeta 권역별 영업이익 구성",
      include_scopes: ["Northern Arc"],
      series_label_hints: ["북부 권역", "해안 권역"],
    });

    expect(intent.series_label_hints).toBeUndefined();
  });
});
