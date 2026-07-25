/**
 * Visualizations are a single compiler-owned path. There is no shadow mode,
 * legacy chart flag, or marker-based renderer to keep in sync with it.
 */
export function isVisualizationEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (env.KRW_VISUALIZATIONS_MODE ?? "").trim().toLowerCase() === "on";
}
