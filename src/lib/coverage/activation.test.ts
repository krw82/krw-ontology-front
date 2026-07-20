import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { tryRecordCoverageActivation } from "./activation";

describe("tryRecordCoverageActivation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("waits for and returns the persisted database milestone result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    vi.mocked(getSupabaseAdmin).mockReturnValue({ rpc } as never);

    await expect(
      tryRecordCoverageActivation("123e4567-e89b-42d3-a456-426614174000"),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("try_record_coverage_activation", {
      p_user_id: "123e4567-e89b-42d3-a456-426614174000",
    });
  });

  it("fails closed without rejecting the user mutation", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "schema unavailable" },
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue({ rpc } as never);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      tryRecordCoverageActivation("123e4567-e89b-42d3-a456-426614174000"),
    ).resolves.toBe(false);
    expect(warning).toHaveBeenCalled();
  });
});
