import type { EntitlementUsagePeriod } from "@/types/entitlement";

export interface BillingPeriod {
  start: string;
  end: string;
  label: string;
}

export function getCurrentDailyBillingPeriod(now = new Date()): BillingPeriod {
  const start = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  const end = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  ));

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    label: "오늘",
  };
}

export function getCurrentMonthlyBillingPeriod(
  now = new Date(),
): BillingPeriod {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    label: "이번 달",
  };
}

export function getCurrentWeeklyBillingPeriod(
  anchor: Date | string,
  now = new Date(),
): BillingPeriod {
  const anchorTime = new Date(anchor).getTime();
  const nowTime = now.getTime();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  if (!Number.isFinite(anchorTime)) {
    throw new Error("credit anchor must be a valid date");
  }

  const weekIndex = Math.max(0, Math.floor((nowTime - anchorTime) / weekMs));
  const start = new Date(anchorTime + weekIndex * weekMs);
  const end = new Date(start.getTime() + weekMs);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    label: "이번 주",
  };
}

export function getCurrentBillingPeriod(
  period: EntitlementUsagePeriod,
  now = new Date(),
): BillingPeriod {
  if (period === "daily") return getCurrentDailyBillingPeriod(now);
  if (period === "weekly") return getCurrentWeeklyBillingPeriod(now, now);
  return getCurrentMonthlyBillingPeriod(now);
}

export function isDateWithinPeriod(
  date: Date,
  period: Pick<BillingPeriod, "start" | "end">,
): boolean {
  const time = date.getTime();
  return time >= new Date(period.start).getTime() && time < new Date(period.end).getTime();
}
