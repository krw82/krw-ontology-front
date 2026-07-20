import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  handleAuthError: vi.fn(() => Response.json({}, { status: 401 })),
}));
vi.mock("@/lib/filing-notifications/request", () => ({
  isExpectedMutationOrigin: vi.fn(() => true),
  invalidOriginResponse: vi.fn(() => Response.json({}, { status: 403 })),
}));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: vi.fn() }));

import { getAuthUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { PATCH } from "./route";

const eventIds = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
];
const itemIds = eventIds.map((eventId) =>
  Buffer.from(`filing:${eventId}`, "utf8").toString("base64url"));

describe("Pulse impression batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({ id: "user-1" } as never);
  });

  it("validates all filing rows before recording the visible stack atomically", async () => {
    const chain = {
      select: vi.fn(() => chain),
      in: vi.fn(() => chain),
      eq: vi.fn()
        .mockImplementationOnce(() => chain)
        .mockResolvedValueOnce({
          data: eventIds.map((id) => ({ id })),
          error: null,
        }),
    };
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null });
    vi.mocked(getSupabaseAdmin).mockReturnValue({
      from: vi.fn(() => chain),
      rpc,
    } as never);
    const request = new NextRequest("https://krwontology.com/api/pulse/impressions", {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: "https://krwontology.com" },
      body: JSON.stringify({
        item_ids: itemIds,
        feed_session_id: "00000000-0000-4000-8000-000000000020",
      }),
    });

    const response = await PATCH(request);

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("record_pulse_item_impressions", expect.objectContaining({
      p_user_id: "user-1",
      p_feed_session_id: "00000000-0000-4000-8000-000000000020",
      p_items: eventIds.map((eventId) => ({
        item_key: `filing:${eventId}`,
        source_type: "filing",
        source_id: eventId,
        kind: "filing",
      })),
    }));
  });
});
