import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getPulseFilingDecisionContext } from "./read-model";

function query(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "in", "order"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.returns = vi.fn(() => Promise.resolve(result));
  return chain;
}

describe("getPulseFilingDecisionContext", () => {
  it("loads all current decisions and first linked theses in two bounded queries", async () => {
    const revisionQuery = query({
      data: [
        {
          id: "revision-1",
          judgment_id: "judgment-1",
          user_id: "user-1",
          filing_event_id: "event-1",
          ticker: "AAPL",
          revision_number: 2,
          impact: "positive",
          next_action: "complete",
          summary: "판단",
          rationale: "",
          is_current: true,
          idempotency_key: "mutation-1",
          created_at: "2026-07-18T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const thesisQuery = query({
      data: [
        {
          revision_id: "revision-1",
          user_company_theses: {
            id: "thesis-1",
            title: "서비스 성장",
            status: "active",
            user_id: "user-1",
          },
        },
      ],
      error: null,
    });
    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(revisionQuery)
        .mockReturnValueOnce(thesisQuery),
    };

    const result = await getPulseFilingDecisionContext(
      supabase as never,
      "user-1",
      ["event-1", "event-1"],
    );

    expect(supabase.from).toHaveBeenCalledTimes(2);
    expect(revisionQuery.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(thesisQuery.eq).toHaveBeenCalledWith("user_company_theses.user_id", "user-1");
    expect(result.get("event-1")).toMatchObject({
      judgment: { current_revision_id: "revision-1", revision_number: 2 },
      linked_thesis: { id: "thesis-1", status: "active" },
    });
  });

  it("does not query for an empty batch", async () => {
    const supabase = { from: vi.fn() };
    await expect(
      getPulseFilingDecisionContext(supabase as never, "user-1", []),
    ).resolves.toEqual(new Map());
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
