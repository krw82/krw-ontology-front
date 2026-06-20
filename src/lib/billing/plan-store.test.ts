import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  getBillingPlanFromStore,
  listPublicBillingPlansFromStore,
} from "./plan-store";

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

const freeRow = {
  key: "free",
  label: "Free",
  status_label: "무료",
  description: "DB Free",
  budget_period: "weekly",
  monthly_price_krw: 0,
  weekly_analysis_credits_raw: 21000,
  plan_version: "free-db",
  credit_policy_version: "credit-v1",
  monthly_analysis_credits: 21000,
  daily_analysis_credits: null,
  monthly_budget_usd: 21,
  daily_budget_usd: null,
  per_run_analysis_credits: 0,
  per_run_reserve_usd: 0,
  unlimited: false,
  sort_order: 10,
  is_public: true,
  created_at: "2026-05-25T00:00:00.000Z",
  updated_at: "2026-05-25T00:00:00.000Z",
};

describe("billing plan store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads a plan from the database as the source of truth", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: freeRow,
              error: null,
            }),
          })),
        })),
      })),
    } as never);

    const plan = await getBillingPlanFromStore("free");

    expect(plan.monthlyAnalysisCredits).toBe(21000);
    expect(plan.monthlyBudgetUsd).toBe(21);
    expect(plan.description).toBe("DB Free");
  });

  it("loads public plans from the database in display order", async () => {
    const proRow = {
      ...freeRow,
      key: "pro",
      label: "Pro",
      status_label: "고급 분석",
      monthly_price_krw: 29000,
      weekly_analysis_credits_raw: 600000,
      plan_version: "pro-db",
      monthly_analysis_credits: 600000,
      monthly_budget_usd: 600,
      sort_order: 30,
    };
    vi.mocked(getSupabaseAdmin).mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              returns: vi.fn().mockResolvedValue({
                data: [freeRow, proRow],
                error: null,
              }),
            })),
          })),
        })),
      })),
    } as never);

    const plans = await listPublicBillingPlansFromStore();

    expect(plans.map((plan) => plan.key)).toEqual(["free", "pro"]);
    expect(plans[1]?.monthlyAnalysisCredits).toBe(600000);
    expect(plans[1]?.monthlyPriceKrw).toBe(29000);
  });

  it("falls back to code-defined plans when the table is missing", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { code: "42P01", message: "missing table" },
            }),
          })),
        })),
      })),
    } as never);

    const plan = await getBillingPlanFromStore("free");

    expect(plan.weeklyAnalysisCreditsRaw).toBe(400000);
    expect(plan.monthlyPriceKrw).toBe(0);
  });
});
