const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_RENEWAL_GRACE_MS = 3 * 24 * 60 * 60 * 1_000;
const RENEWAL_RETRY_DELAYS_MS = [
  60 * 60 * 1_000,
  6 * 60 * 60 * 1_000,
  12 * 60 * 60 * 1_000,
] as const;

export function addCalendarMonthsIso(
  value: string | Date,
  months: number,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("billing date must be valid");
  }

  const day = date.getUTCDate();
  const target = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + months,
      1,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString();
}

export function calculateProratedUpgradeAmountKrw({
  currentMonthlyPriceKrw,
  targetMonthlyPriceKrw,
  periodStart,
  periodEnd,
  now = new Date(),
}: {
  currentMonthlyPriceKrw: number;
  targetMonthlyPriceKrw: number;
  periodStart: string | Date;
  periodEnd: string | Date;
  now?: Date;
}): number {
  const priceDifference = Math.max(
    0,
    Math.floor(targetMonthlyPriceKrw) - Math.floor(currentMonthlyPriceKrw),
  );
  if (priceDifference === 0) return 0;

  const startMs = new Date(periodStart).getTime();
  const endMs = new Date(periodEnd).getTime();
  const nowMs = now.getTime();
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs
  ) {
    throw new Error("billing period must be valid");
  }

  const remainingRatio = Math.max(
    0,
    Math.min(1, (endMs - Math.max(nowMs, startMs)) / (endMs - startMs)),
  );
  return Math.ceil(priceDifference * remainingRatio);
}

export function getFirstWeeklyBoundaryAtOrAfterIso({
  anchor,
  at,
}: {
  anchor: string | Date;
  at: string | Date;
}): string {
  const anchorMs = new Date(anchor).getTime();
  const atMs = new Date(at).getTime();
  if (!Number.isFinite(anchorMs) || !Number.isFinite(atMs)) {
    throw new Error("weekly credit dates must be valid");
  }

  const elapsed = Math.max(0, atMs - anchorMs);
  const weekIndex = Math.ceil(elapsed / WEEK_MS);
  return new Date(anchorMs + weekIndex * WEEK_MS).toISOString();
}

export function getRenewalGraceUntilIso(
  periodEnd: string | Date,
  graceMs = DEFAULT_RENEWAL_GRACE_MS,
): string {
  const periodEndMs = new Date(periodEnd).getTime();
  if (!Number.isFinite(periodEndMs)) {
    throw new Error("billing period end must be valid");
  }
  return new Date(periodEndMs + Math.max(0, graceMs)).toISOString();
}

export function getRenewalRetryAtIso({
  now = new Date(),
  attemptCount,
}: {
  now?: Date;
  attemptCount: number;
}): string {
  const index = Math.min(
    Math.max(0, Math.floor(attemptCount)),
    RENEWAL_RETRY_DELAYS_MS.length - 1,
  );
  return new Date(now.getTime() + RENEWAL_RETRY_DELAYS_MS[index]).toISOString();
}
