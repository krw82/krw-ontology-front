import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkChatRunRateLimit } from "@/lib/api/chat/rate-limit";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

function mockRpc(
  implementation: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({
    data: [{ allowed: true, current_count: 1, retry_after_seconds: 0 }],
    error: null,
  }),
) {
  vi.mocked(getSupabaseAdmin).mockReturnValue({
    rpc: implementation,
  } as unknown as ReturnType<typeof getSupabaseAdmin>);
  return implementation;
}

describe("chat run durable rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CHAT_RUNS_PER_USER_PER_MINUTE;
    delete process.env.CHAT_RUNS_PER_IP_PER_MINUTE;
    delete process.env.CHAT_RUNS_PER_SESSION_PER_MINUTE;
  });

  it("checks user, IP, and session buckets with stable minute windows", async () => {
    const rpc = mockRpc();

    const result = await checkChatRunRateLimit(
      {
        userId: "user-1",
        requestId: "req-1",
        ip: "203.0.113.10",
        sessionId: "session-1",
      },
      new Date("2026-05-23T01:02:33.456Z"),
    );

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenNthCalledWith(1, "increment_rate_limit", {
      p_key: "user:user-1",
      p_bucket: "chat_run:user:minute",
      p_window_start: "2026-05-23T01:02:00.000Z",
      p_window_seconds: 60,
      p_limit: 5,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "increment_rate_limit", {
      p_key: "ip:203.0.113.10",
      p_bucket: "chat_run:ip:minute",
      p_window_start: "2026-05-23T01:02:00.000Z",
      p_window_seconds: 60,
      p_limit: 20,
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "increment_rate_limit", {
      p_key: "session:session-1",
      p_bucket: "chat_run:session:minute",
      p_window_start: "2026-05-23T01:02:00.000Z",
      p_window_seconds: 60,
      p_limit: 8,
    });
  });

  it("returns a 429 with Retry-After when a bucket is exhausted", async () => {
    mockRpc(
      vi
        .fn()
        .mockResolvedValueOnce({
          data: [{ allowed: true, current_count: 1, retry_after_seconds: 0 }],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [{ allowed: false, current_count: 21, retry_after_seconds: 42 }],
          error: null,
        }),
    );

    const result = await checkChatRunRateLimit({
      userId: "user-1",
      requestId: "req-1",
      ip: "203.0.113.10",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("Retry-After")).toBe("42");
    await expect(result.response.json()).resolves.toMatchObject({
      error: { code: "rate_limited" },
      request_id: "req-1",
    });
  });

  it("fails closed when the rate-limit RPC is unavailable", async () => {
    mockRpc(
      vi.fn().mockResolvedValue({
        data: null,
        error: { message: "function missing" },
      }),
    );

    const result = await checkChatRunRateLimit({
      userId: "user-1",
      requestId: "req-1",
      ip: "203.0.113.10",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
    await expect(result.response.json()).resolves.toMatchObject({
      error: { code: "service_unavailable" },
    });
  });
});
