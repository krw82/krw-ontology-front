import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));

import { getRecentCompanyMarketNews } from "./company-news";

function query(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    returns: async () => result,
  };
  return chain;
}

describe("getRecentCompanyMarketNews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only published, unmerged issues explicitly linked to the company ticker", async () => {
    const from = vi.fn((table: string) => {
      if (table === "market_issue_entities") {
        return query({
          data: [{ issue_id: "issue-1" }, { issue_id: "issue-1" }, { issue_id: "issue-2" }],
          error: null,
        });
      }
      if (table === "market_issues") {
        return query({
          data: [
            {
              id: "issue-2",
              title_ko: "  최근 나이키 시장 이슈  ",
              summary_ko: "  나이키와 직접 연결된 시장 뉴스입니다.  ",
              impact_path: ["수요 변화가 매출 기대에 영향을 줄 수 있음", ""],
              published_at: "2026-08-11T01:00:00.000Z",
              updated_at: "2026-08-11T02:00:00.000Z",
            },
          ],
          error: null,
        });
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    mocks.getSupabaseAdmin.mockReturnValue({ from });

    await expect(getRecentCompanyMarketNews(" nke ")).resolves.toEqual([
      {
        id: "issue-2",
        title: "최근 나이키 시장 이슈",
        summary: "나이키와 직접 연결된 시장 뉴스입니다.",
        impactPath: ["수요 변화가 매출 기대에 영향을 줄 수 있음"],
        publishedAt: "2026-08-11T01:00:00.000Z",
        updatedAt: "2026-08-11T02:00:00.000Z",
      },
    ]);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("does not query Supabase for an invalid ticker", async () => {
    await expect(getRecentCompanyMarketNews("  ")).resolves.toEqual([]);
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });
});
