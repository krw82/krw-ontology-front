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
              maybeSingle() {
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
});
