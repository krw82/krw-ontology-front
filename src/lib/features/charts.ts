const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

export function isChartGenerationEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return TRUE_ENV_VALUES.has(
    (env.KRW_CHARTS_ENABLED ?? "").trim().toLowerCase(),
  );
}

export function stripChartTokens(content: string): string {
  return content
    .replace(/\s*\[\[krw-chart:[A-Za-z0-9_-]+\]\]\s*/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
