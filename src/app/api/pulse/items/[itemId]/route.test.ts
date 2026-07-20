import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/analytics/server", () => ({
  recordAnalyticsEventFromRequest: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { PATCH } from "./route";

const filingEventId = "00000000-0000-4000-8000-000000000001";
const itemId = Buffer.from(`filing:${filingEventId}`, "utf8").toString(
  "base64url",
);
const params = Promise.resolve({ itemId });

function requestFor(encodedItemId: string, action: "review" | "unreview" | "dismiss") {
  return new NextRequest(
    `https://krwontology.com/api/pulse/items/${encodeURIComponent(encodedItemId)}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://krwontology.com",
      },
      body: JSON.stringify({ action }),
    },
  );
}

function request(action: "review" | "unreview") {
  return requestFor(itemId, action);
}

describe("filing Pulse item mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as never);
  });

  it.each(["review", "unreview"] as const)(
    "rejects the %s shortcut before any legacy persistence",
    async (action) => {
      const response = await PATCH(request(action), { params });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: "validation_error",
          message: expect.stringContaining("영향"),
        },
      });
      expect(getSupabaseAdmin).not.toHaveBeenCalled();
    },
  );

  it.each(["review", "dismiss"] as const)(
    "resolves a scheduled monitoring %s through the atomic RPC",
    async (action) => {
      const ruleId = "00000000-0000-4000-8000-000000000099";
      const monitoringItemId = Buffer.from(
        `resurface:monitoring:${ruleId}`,
        "utf8",
      ).toString("base64url");
      const maybeSingle = vi.fn().mockResolvedValue({
        data: { id: ruleId },
        error: null,
      });
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle,
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      const rpc = vi.fn().mockResolvedValue({
        data: {
          reviewed_at: action === "review" ? "2026-07-18T00:00:00.000Z" : null,
          saved_at: null,
          snoozed_until: null,
          dismissed_at:
            action === "dismiss" ? "2026-07-18T00:00:00.000Z" : null,
        },
        error: null,
      });
      vi.mocked(getSupabaseAdmin).mockReturnValue({
        from: vi.fn(() => chain),
        rpc,
      } as never);

      const response = await PATCH(requestFor(monitoringItemId, action), {
        params: Promise.resolve({ itemId: monitoringItemId }),
      });

      expect(response.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith(
        "resolve_scheduled_monitoring_pulse_item",
        expect.objectContaining({
          p_user_id: "user-1",
          p_rule_id: ruleId,
          p_item_key: `resurface:monitoring:${ruleId}`,
          p_action: action,
        }),
      );
    },
  );
});
