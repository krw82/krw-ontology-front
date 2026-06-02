import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { findPublicMessageShare } from "./message-share";

function createAdmin(data: Record<string, unknown> | null) {
  return {
    from(table: string) {
      expect(table).toBe("message_shares");
      return {
        select() {
          const query = {
            eq() {
              return query;
            },
            is() {
              return query;
            },
            maybeSingle() {
              return Promise.resolve({ data, error: null });
            },
          };
          return query;
        },
      };
    },
  } as unknown as ReturnType<typeof getSupabaseAdmin>;
}

describe("findPublicMessageShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sanitizes public share answer content and title", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      createAdmin({
        token: "share-token",
        title: "Let me retrieve more evidence.",
        answer_content:
          "Let me retrieve more evidence.분석 결과를 작성하겠습니다.\n\n---\n\n최종 답변입니다.",
        answer_created_at: "2026-05-31T00:00:00.000Z",
        tickers: ["NOW"],
        created_at: "2026-05-31T00:00:00.000Z",
      }),
    );

    await expect(findPublicMessageShare("share-token")).resolves.toMatchObject({
      title: "최종 답변입니다.",
      answer_content: "최종 답변입니다.",
    });
  });
});
