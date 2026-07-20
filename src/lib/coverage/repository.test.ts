import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/entitlement", () => ({
  getEntitlementStatus: vi.fn(),
}));
vi.mock("@/lib/coverage/activation", () => ({
  tryRecordCoverageActivation: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { tryRecordCoverageActivation } from "@/lib/coverage/activation";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { setCompanyCoverageLevelWithEvent } from "./repository";

describe("company coverage repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEntitlementStatus).mockResolvedValue({
      plan: { key: "free" },
    } as never);
  });

  it("re-evaluates activation inside the shared repository for every client", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        mark: {
          user_id: "10000000-0000-4000-8000-000000000001",
          ticker: "AAPL",
          coverage_level: "interest",
          priority: 0,
          interest_reason: null,
          tags: [],
          last_activity_at: null,
          created_at: "2026-07-18T00:00:00.000Z",
          updated_at: "2026-07-18T00:00:00.000Z",
        },
        event_id: "20000000-0000-4000-8000-000000000001",
        previous_coverage_level: null,
        coverage_level: "interest",
        changed: true,
        idempotent_replay: false,
      },
      error: null,
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue({ rpc } as never);

    await setCompanyCoverageLevelWithEvent({
      userId: "10000000-0000-4000-8000-000000000001",
      ticker: "aapl",
      coverageLevel: "interest",
      source: "desktop",
    });

    expect(tryRecordCoverageActivation).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000001",
    );
  });
});
