export interface BillingPeriod {
  start: string;
  end: string;
  label: string;
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

export function isDateWithinPeriod(
  date: Date,
  period: Pick<BillingPeriod, "start" | "end">,
): boolean {
  const time = date.getTime();
  return time >= new Date(period.start).getTime() && time < new Date(period.end).getTime();
}
