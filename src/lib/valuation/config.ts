import { readIntEnv } from "@/lib/env";

export interface ValuationRefreshConfig {
  enabled: boolean;
  workerId: string;
  intervalMs: number;
  batchSize: number;
}

export function readValuationRefreshConfig(
  env: Record<string, string | undefined> = process.env,
): ValuationRefreshConfig {
  const apiKey = env.FMP_API_KEY?.trim();
  const workerId = env.VALUATION_REFRESH_WORKER_ID?.trim() || "valuation-refresh-local";

  return {
    enabled: Boolean(apiKey),
    workerId,
    intervalMs: readIntEnv("VALUATION_REFRESH_INTERVAL_MS", 3_600_000, { min: 60_000, max: 86_400_000 }),
    batchSize: readIntEnv("VALUATION_REFRESH_BATCH_SIZE", 20, { min: 1, max: 100 }),
  };
}
