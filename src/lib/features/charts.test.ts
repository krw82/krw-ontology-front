import { describe, expect, it } from "vitest";
import { isVisualizationEnabled } from "./charts";

describe("visualization feature setting", () => {
  it("enables only the final compiler-owned visualization path", () => {
    expect(isVisualizationEnabled({ KRW_VISUALIZATIONS_MODE: "on" })).toBe(true);
    expect(isVisualizationEnabled({ KRW_VISUALIZATIONS_MODE: "ON" })).toBe(true);
    expect(isVisualizationEnabled({ KRW_VISUALIZATIONS_MODE: "shadow" })).toBe(false);
    expect(isVisualizationEnabled({ KRW_CHARTS_ENABLED: "true" })).toBe(false);
    expect(isVisualizationEnabled({ KRW_VISUALIZATIONS_MODE: "off" })).toBe(false);
  });
});
