import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  handleAuthError: vi.fn(() =>
    Response.json({ error: { code: "auth_required" } }, { status: 401 }),
  ),
}));
vi.mock("@/lib/filing-notifications/request", () => ({
  isExpectedMutationOrigin: vi.fn(() => true),
  invalidOriginResponse: vi.fn(() =>
    Response.json({ error: { code: "forbidden" } }, { status: 403 }),
  ),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth";
import { isExpectedMutationOrigin } from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { GET, POST } from "./route";

const snapshotAt = "2026-07-18T03:00:00.000Z";
const sessionId = "00000000-0000-4000-8000-000000000020";
const recordId = "00000000-0000-4000-8000-000000000021";

function getRequest() {
  return new NextRequest(
    "https://krwontology.com/api/pulse/session-close?timezone=Asia%2FSeoul",
  );
}

function postRequest() {
  return new NextRequest("https://krwontology.com/api/pulse/session-close", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://krwontology.com",
    },
    body: JSON.stringify({
      feed_session_id: sessionId,
      timezone: "Asia/Seoul",
    }),
  });
}

describe("pulse decision session close route", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(snapshotAt));
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as never);
    vi.mocked(isExpectedMutationOrigin).mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("restores a persisted close state for the user's local day", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: recordId,
        local_date: "2026-07-18",
        closed_at: "2026-07-18T03:05:00.000Z",
        judgment_count: 3,
        observation_count: 1,
        thesis_update_count: 1,
        open_question_count: 2,
        next_check_count: 4,
        outcome: "deferred",
      },
      error: null,
    });
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle,
    };
    vi.mocked(getSupabaseAdmin).mockReturnValue({
      from: vi.fn(() => chain),
    } as never);

    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      local_date: "2026-07-18",
      closed_at: "2026-07-18T03:05:00.000Z",
      judgment_count: 3,
      observation_count: 1,
      thesis_update_count: 1,
      open_question_count: 2,
      next_check_count: 4,
      outcome: "deferred",
    });
  });

  it("blocks cross-origin closes before authentication", async () => {
    vi.mocked(isExpectedMutationOrigin).mockReturnValue(false);
    const response = await POST(postRequest());
    expect(response.status).toBe(403);
    expect(getAuthUser).not.toHaveBeenCalled();
  });

  it("persists the close once through the transactional RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        id: recordId,
        local_date: "2026-07-18",
        closed_at: "2026-07-18T03:05:00.000Z",
        judgment_count: 3,
        observation_count: 1,
        thesis_update_count: 1,
        open_question_count: 2,
        next_check_count: 4,
        outcome: "completed",
        idempotent_replay: false,
      },
      error: null,
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue({ rpc } as never);

    const response = await POST(postRequest());
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("close_user_decision_session", {
      p_user_id: "user-1",
      p_feed_session_id: sessionId,
      p_timezone: "Asia/Seoul",
    });
    await expect(response.json()).resolves.toMatchObject({
      judgment_count: 3,
      observation_count: 1,
      thesis_update_count: 1,
      open_question_count: 2,
      next_check_count: 4,
      outcome: "completed",
    });
  });
});
