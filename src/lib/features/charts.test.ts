import { describe, expect, it } from "vitest";
import {
  getVisualizationMode,
  isVisualizationGenerationEnabled,
  isVisualizationVisible,
  stripChartTokens,
} from "./charts";

describe("visualization feature mode", () => {
  it("uses the final mode setting and retains the old flag only as a bridge", () => {
    expect(getVisualizationMode({ KRW_VISUALIZATIONS_MODE: "shadow" })).toBe("shadow");
    expect(isVisualizationGenerationEnabled({ KRW_VISUALIZATIONS_MODE: "shadow" })).toBe(true);
    expect(isVisualizationVisible({ KRW_VISUALIZATIONS_MODE: "shadow" })).toBe(false);
    expect(getVisualizationMode({ KRW_CHARTS_ENABLED: "true" })).toBe("on");
    expect(getVisualizationMode({ KRW_CHARTS_ENABLED: "false" })).toBe("off");
  });

  it("always removes retired inline tokens from visible answer text", () => {
    expect(stripChartTokens("앞 [[krw-chart:chart_1_old]] 뒤"))
      .toBe("앞\n\n뒤");
  });
});
