export function parseAnalyticsSampleRate(
  raw: string | undefined,
  fallback: number,
): number {
  if (!raw) return clampSampleRate(fallback);
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed)
    ? clampSampleRate(parsed)
    : clampSampleRate(fallback);
}

export function shouldSampleAnalyticsKey(
  key: string,
  sampleRate: number,
): boolean {
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  return normalizedAnalyticsHash(key) < sampleRate;
}

export function normalizedAnalyticsHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function clampSampleRate(value: number): number {
  return Math.min(1, Math.max(0, value));
}
