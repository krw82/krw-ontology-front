import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/analytics/server", () => ({
  recordAnalyticsEventFromRequest: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  handleAuthError: vi.fn((error: unknown) =>
    Response.json(
      {
        error: {
          code: "auth_required",
          message: error instanceof Error ? error.message : "Auth failed",
        },
      },
      { status: 401 },
    ),
  ),
  forbiddenError: vi.fn((message: string) =>
    Response.json({ error: { code: "forbidden", message } }, { status: 403 }),
  ),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/share/message-share", () => ({
  createMessageShare: vi.fn(),
  ensureMessageShareContextSnapshot: vi.fn(),
  ensureMessageShareQuestionSnapshot: vi.fn(),
  findExistingActiveShare: vi.fn(),
}));

import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { getAuthUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  createMessageShare,
  ensureMessageShareContextSnapshot,
  ensureMessageShareQuestionSnapshot,
  findExistingActiveShare,
} from "@/lib/share/message-share";
import { POST } from "./route";

const MESSAGE_ID = "11111111-1111-4111-8111-111111111111";
const message = {
  id: MESSAGE_ID,
  session_id: "session-1",
  role: "assistant",
  content: "버핏 렌즈 답변",
  status: "completed",
  created_at: "2026-07-10T00:01:00.000Z",
  updated_at: "2026-07-10T00:01:00.000Z",
};
const session = {
  id: "session-1",
  user_id: "user-1",
  title: "AAPL",
  claude_session_id: null,
  scope_type: "company",
  default_tickers: ["AAPL"],
  default_document_types: [],
  created_at: "2026-07-10T00:00:00.000Z",
  updated_at: "2026-07-10T00:01:00.000Z",
};

function request() {
  return new NextRequest(
    `http://localhost/api/share/messages/${MESSAGE_ID}`,
    { method: "POST" },
  );
}

function params() {
  return { params: Promise.resolve({ messageId: MESSAGE_ID }) };
}

function createAdmin() {
  return {
    from(table: string) {
      return {
        select() {
          const query = {
            eq() {
              return query;
            },
            is() {
              return query;
            },
            single() {
              if (table === "messages") {
                return Promise.resolve({ data: message, error: null });
              }
              if (table === "chat_sessions") {
                return Promise.resolve({ data: session, error: null });
              }
              throw new Error(`Unexpected table: ${table}`);
            },
          };
          return query;
        },
      };
    },
  } as unknown as ReturnType<typeof getSupabaseAdmin>;
}

describe("POST /api/share/messages/[messageId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(getSupabaseAdmin).mockReturnValue(createAdmin());
    vi.mocked(recordAnalyticsEventFromRequest).mockResolvedValue({ ok: true });
  });

  it("backfills missing run context before reusing an existing share", async () => {
    vi.mocked(findExistingActiveShare).mockResolvedValue({
      token: "existing-share-token",
      question_content: "AAPL을 버핏 관점으로 봐줘.",
      share_context: {},
    });

    const response = await POST(request(), params());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      token: "existing-share-token",
    });
    expect(ensureMessageShareContextSnapshot).toHaveBeenCalledWith({ message });
    expect(ensureMessageShareQuestionSnapshot).not.toHaveBeenCalled();
    expect(createMessageShare).not.toHaveBeenCalled();
  });

  it("does not rewrite context when the existing share already has a run kind", async () => {
    vi.mocked(findExistingActiveShare).mockResolvedValue({
      token: "existing-share-token",
      question_content: "AAPL을 버핏 관점으로 봐줘.",
      share_context: { run_kind: "guru_advisor", guru_lens: "buffett" },
    });

    const response = await POST(request(), params());

    expect(response.status).toBe(200);
    expect(ensureMessageShareContextSnapshot).not.toHaveBeenCalled();
    expect(createMessageShare).not.toHaveBeenCalled();
  });
});
