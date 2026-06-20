import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("./admin-emails", () => ({
  isAdminEntitlementEmail: vi.fn(() => false),
}));
vi.mock("./plan-store", () => ({
  getBillingPlanFromStore: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { getBillingPlanFromStore } from "./plan-store";
import { getEntitlementStatus } from "./entitlement";
import type { BillingPlan } from "./plans";

const dailyPlan: BillingPlan = {
  key: "free",
  label: "Daily Free",
  statusLabel: "일 단위",
  description: "Daily test plan",
  planVersion: "free-test",
  monthlyPriceKrw: 0,
  weeklyAnalysisCreditsRaw: 300_000,
  creditPolicyVersion: "credit-v1",
  budgetPeriod: "daily",
  monthlyAnalysisCredits: 20_000,
  dailyAnalysisCredits: 2_000,
  monthlyBudgetUsd: 20,
  dailyBudgetUsd: 2,
  perRunReserveUsd: 0,
  perRunAnalysisCredits: 0,
  unlimited: false,
  sortOrder: 10,
  public: true,
};

const betaPlan: BillingPlan = {
  ...dailyPlan,
  key: "beta",
  label: "Beta",
  statusLabel: "운영 전 테스트",
  description: "Beta test plan",
  planVersion: "beta-test",
  budgetPeriod: "weekly",
  monthlyAnalysisCredits: 2_000_000,
  dailyAnalysisCredits: null,
  monthlyBudgetUsd: 2,
  dailyBudgetUsd: null,
  weeklyAnalysisCreditsRaw: 2_000_000,
  public: false,
};

function mockSupabaseForEntitlement(
  entitlementData: Record<string, unknown> | null,
) {
  vi.mocked(createClient).mockResolvedValue({
    from(table: string) {
      return {
        select() {
          const query = {
            eq() {
              return query;
            },
            in() {
              return query;
            },
            lte() {
              return query;
            },
            gt() {
              return query;
            },
            order() {
              return query;
            },
            limit() {
              return query;
            },
            maybeSingle() {
              if (table === "user_entitlements") {
                return Promise.resolve({
                  data: entitlementData,
                  error: null,
                });
              }
              if (table === "usage_credit_balances") {
                return Promise.resolve({
                  data: null,
                  error: {
                    code: "42P01",
                    message: "relation does not exist",
                  },
                });
              }
              throw new Error(`Unexpected maybeSingle table: ${table}`);
            },
            returns() {
              if (table !== "usage_budget_balances") {
                throw new Error(`Unexpected returns table: ${table}`);
              }
              return Promise.resolve({
                data: [],
                error: null,
              });
            },
          };
          return query;
        },
      };
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe("getEntitlementStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"));
    vi.mocked(getBillingPlanFromStore).mockResolvedValue(dailyPlan);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses monthly ledger periods for monthly balances even on daily plans", async () => {
    const periodStartFilters: unknown[][] = [];
    vi.mocked(createClient).mockResolvedValue({
      from(table: string) {
        return {
          select() {
            const query = {
              eq() {
                return query;
              },
              in(key: string, values: unknown[]) {
                if (table === "usage_budget_balances" && key === "period_start") {
                  periodStartFilters.push(values);
                }
                return query;
              },
              lte() {
                return query;
              },
              gt() {
                return query;
              },
              order() {
                return query;
              },
              limit() {
                return query;
              },
              maybeSingle() {
                if (table === "usage_credit_balances") {
                  return Promise.resolve({
                    data: null,
                    error: {
                      code: "42P01",
                      message: "relation does not exist",
                    },
                  });
                }
                if (table !== "user_entitlements") {
                  throw new Error(`Unexpected maybeSingle table: ${table}`);
                }
                return Promise.resolve({
                  data: {
                    plan_key: "free",
                    status: "active",
                  },
                  error: null,
                });
              },
              returns() {
                if (table !== "usage_budget_balances") {
                  throw new Error(`Unexpected returns table: ${table}`);
                }
                return Promise.resolve({
                  data: [
                    {
                      period_kind: "monthly",
                      period_start: "2026-06-01T00:00:00.000Z",
                      settled_cost_usd: 3,
                      reserved_cost_usd: 0.5,
                      run_count: 7,
                    },
                    {
                      period_kind: "daily",
                      period_start: "2026-06-10T00:00:00.000Z",
                      settled_cost_usd: 1,
                      reserved_cost_usd: 0.25,
                      run_count: 2,
                    },
                  ],
                  error: null,
                });
              },
            };
            return query;
          },
        };
      },
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const status = await getEntitlementStatus("user-1", "user@example.test");

    expect(periodStartFilters).toEqual([
      ["2026-06-01T00:00:00.000Z", "2026-06-10T00:00:00.000Z"],
    ]);
    expect(status.usage.period).toBe("daily");
    expect(status.usage.period_start).toBe("2026-06-10T00:00:00.000Z");
    expect(status.usage.budget_used_usd).toBe(3);
    expect(status.usage.daily_budget_used_usd).toBe(1);
    expect(status.usage.run_count).toBe(7);
  });

  it("loads weekly credit usage by the containing period instead of exact timestamp equality", async () => {
    vi.setSystemTime(new Date("2026-06-20T16:20:00.000Z"));
    vi.mocked(getBillingPlanFromStore).mockImplementation(async (planKey) =>
      planKey === "beta" ? betaPlan : dailyPlan,
    );

    const lteFilters: unknown[][] = [];
    const gtFilters: unknown[][] = [];
    vi.mocked(createClient).mockResolvedValue({
      from(table: string) {
        return {
          select() {
            const query = {
              eq() {
                return query;
              },
              in() {
                return query;
              },
              lte(key: string, value: unknown) {
                if (table === "usage_credit_balances") {
                  lteFilters.push([key, value]);
                }
                return query;
              },
              gt(key: string, value: unknown) {
                if (table === "usage_credit_balances") {
                  gtFilters.push([key, value]);
                }
                return query;
              },
              order() {
                return query;
              },
              limit() {
                return query;
              },
              maybeSingle() {
                if (table === "user_entitlements") {
                  return Promise.resolve({
                    data: {
                      plan_key: "beta",
                      status: "active",
                      current_period_start: "2026-06-20T12:53:29.534504Z",
                      current_period_end: "2026-07-20T12:53:29.534504Z",
                      credit_anchor_at: "2026-06-20T12:53:29.534504Z",
                    },
                    error: null,
                  });
                }
                if (table === "usage_credit_balances") {
                  return Promise.resolve({
                    data: {
                      credits_used_raw: 291_498,
                      credits_reserved_raw: 0,
                      credits_limit_raw: 300_000,
                      run_count: 2,
                      credit_policy_version: "credit-v1",
                    },
                    error: null,
                  });
                }
                throw new Error(`Unexpected maybeSingle table: ${table}`);
              },
              returns() {
                if (table !== "usage_budget_balances") {
                  throw new Error(`Unexpected returns table: ${table}`);
                }
                return Promise.resolve({
                  data: [],
                  error: null,
                });
              },
            };
            return query;
          },
        };
      },
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const status = await getEntitlementStatus("user-1", "user@example.test");

    expect(lteFilters).toEqual([
      ["period_start", "2026-06-20T16:20:00.000Z"],
    ]);
    expect(gtFilters).toEqual([
      ["period_end", "2026-06-20T16:20:00.000Z"],
    ]);
    expect(status.usage.credits_used_raw).toBe(291_498);
    expect(status.usage.credits_limit_raw).toBe(2_000_000);
    expect(status.usage.percent_used).toBe(15);
    expect(status.usage.run_count).toBe(2);
  });

  it("falls back to free when an active beta entitlement has expired", async () => {
    mockSupabaseForEntitlement({
      plan_key: "beta",
      status: "active",
      current_period_start: "2026-05-01T00:00:00.000Z",
      current_period_end: "2026-06-01T00:00:00.000Z",
      credit_anchor_at: "2026-05-01T00:00:00.000Z",
    });

    const status = await getEntitlementStatus("user-1", "user@example.test");

    expect(getBillingPlanFromStore).toHaveBeenCalledWith("free");
    expect(status.plan.key).toBe("free");
  });

  it("keeps beta access while the entitlement period is current", async () => {
    vi.mocked(getBillingPlanFromStore).mockImplementation(async (planKey) =>
      planKey === "beta" ? betaPlan : dailyPlan,
    );
    mockSupabaseForEntitlement({
      plan_key: "beta",
      status: "active",
      current_period_start: "2026-06-01T00:00:00.000Z",
      current_period_end: "2026-07-01T00:00:00.000Z",
      credit_anchor_at: "2026-06-01T00:00:00.000Z",
    });

    const status = await getEntitlementStatus("user-1", "user@example.test");

    expect(getBillingPlanFromStore).toHaveBeenCalledWith("beta");
    expect(status.plan.key).toBe("beta");
    expect(status.status).toBe("beta");
  });

  it("keeps paid access through grace_until after the paid period ends", async () => {
    const standardPlan: BillingPlan = {
      ...betaPlan,
      key: "standard",
      label: "Standard",
      planVersion: "standard-test",
      monthlyPriceKrw: 7_900,
      weeklyAnalysisCreditsRaw: 2_000_000,
      public: true,
    };
    vi.mocked(getBillingPlanFromStore).mockResolvedValue(standardPlan);
    mockSupabaseForEntitlement({
      plan_key: "standard",
      status: "grace",
      current_period_start: "2026-05-10T12:00:00.000Z",
      current_period_end: "2026-06-10T00:00:00.000Z",
      grace_until: "2026-06-13T00:00:00.000Z",
      credit_anchor_at: "2026-05-10T12:00:00.000Z",
    });

    const status = await getEntitlementStatus("user-1", "user@example.test");

    expect(getBillingPlanFromStore).toHaveBeenCalledWith("standard");
    expect(status.plan.key).toBe("standard");
  });
});
