const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * Rendering and persistence are deployed together. `shadow` lets production
 * exercise the compiler without showing artifacts to users; the legacy chart
 * flag remains a one-release compatibility bridge only.
 */
export type VisualizationMode = "off" | "shadow" | "on";

export function getVisualizationMode(
  env: Record<string, string | undefined> = process.env,
): VisualizationMode {
  const configured = (env.KRW_VISUALIZATIONS_MODE ?? "").trim().toLowerCase();
  if (configured === "off" || configured === "shadow" || configured === "on") {
    return configured;
  }
  return TRUE_ENV_VALUES.has(
    (env.KRW_CHARTS_ENABLED ?? "").trim().toLowerCase(),
  )
    ? "on"
    : "off";
}

export function isVisualizationGenerationEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return getVisualizationMode(env) !== "off";
}

export function isVisualizationVisible(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return getVisualizationMode(env) === "on";
}

/** @deprecated Use isVisualizationGenerationEnabled. */
export function isChartGenerationEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isVisualizationGenerationEnabled(env);
}

export function stripChartTokens(content: string): string {
  return content
    .replace(/\s*\[\[krw-chart:[A-Za-z0-9_-]+\]\]\s*/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
