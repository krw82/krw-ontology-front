import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/billing/entitlement", () => ({
  getEntitlementStatus: vi.fn(),
}));
vi.mock("./device-auth", () => ({
  authenticateDesktopAccessToken: vi.fn(),
}));

import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { authenticateDesktopAccessToken } from "./device-auth";
import {
  authenticateDesktopRequest,
  DesktopAuthError,
  requireDesktopEntitlement,
} from "./auth";
import type { EntitlementStatus } from "@/types/entitlement";

const ORIGINAL_ENV = { ...process.env };

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/desktop/ontology/tool-call", {
    headers,
  });
}

function entitlement(canRun: boolean): EntitlementStatus {
  return {
    status: "standard",
    plan: {
      key: "free",
      label: "Free",
      status_label: "Free",
      description: "Free plan",
    },
    usage: {
      period: "daily",
      period_label: "오늘",
      period_start: "2026-06-10T00:00:00.000Z",
      period_end: "2026-06-11T00:00:00.000Z",
      budget_used_usd: 0,
      budget_reserved_usd: 0,
      budget_limit_usd: 1,
      remaining_budget_usd: canRun ? 1 : 0,
      daily_budget_used_usd: 0,
      daily_budget_reserved_usd: 0,
      daily_budget_limit_usd: 1,
      per_run_reserve_usd: 0,
      analysis_credits_used: 0,
      analysis_credits_reserved: 0,
      analysis_credits_limit: 100,
      remaining_analysis_credits: canRun ? 100 : 0,
      daily_analysis_credits_used: 0,
      daily_analysis_credits_reserved: 0,
      daily_analysis_credits_limit: 100,
      per_run_analysis_credits: 0,
      run_count: 0,
      percent_used: canRun ? 0 : 100,
      alert_level: canRun ? "ok" : "blocked",
      can_run: canRun,
      unlimited: false,
      resets_at: "2026-06-11T00:00:00.000Z",
    },
    features: [
      {
        key: "evidence_research",
        label: "Evidence research",
        description: "Research",
        enabled: true,
      },
    ],
    upgrade: {
      label: "Upgrade",
      href: "/pricing",
      enabled: false,
      title: "OK",
      message: "OK",
    },
  };
}

describe("Desktop auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    vi.mocked(authenticateDesktopAccessToken).mockResolvedValue(null);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("rejects requests without a bearer token", async () => {
    await expect(authenticateDesktopRequest(request())).rejects.toMatchObject({
      name: "DesktopAuthError",
      code: "authentication_error",
      status: 401,
    });
  });

  it("accepts an explicitly configured dev token without Supabase lookup", async () => {
    process.env.KRW_DESKTOP_DEV_TOKEN = "dev-token";
    process.env.KRW_DESKTOP_DEV_USER_ID = "dev-user";

    const auth = await authenticateDesktopRequest(
      request({
        authorization: "Bearer dev-token",
        "x-krw-device-id": "device-1",
      }),
    );

    expect(auth).toMatchObject({
      userId: "dev-user",
      deviceId: "device-1",
      authMethod: "dev_token",
    });
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("rejects ordinary web bearer tokens without Supabase auth fallback", async () => {
    await expect(
      authenticateDesktopRequest(
        request({
          authorization: "Bearer web-access-token",
        }),
      ),
    ).rejects.toMatchObject({
      name: "DesktopAuthError",
      code: "authentication_error",
      status: 401,
      publicMessage: "KRW Desktop 로그인이 만료되었습니다. 다시 로그인해주세요.",
    });

    expect(authenticateDesktopAccessToken).toHaveBeenCalledWith(
      "web-access-token",
    );
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("accepts server-issued desktop access tokens", async () => {
    vi.mocked(authenticateDesktopAccessToken).mockResolvedValue({
      userId: "desktop-user",
      userEmail: null,
      deviceId: "device-1",
      authMethod: "desktop_access_token",
    });

    const auth = await authenticateDesktopRequest(
      request({
        authorization: "Bearer desktop-token",
      }),
    );

    expect(auth).toMatchObject({
      userId: "desktop-user",
      deviceId: "device-1",
      authMethod: "desktop_access_token",
    });
    expect(authenticateDesktopAccessToken).toHaveBeenCalledWith(
      "desktop-token",
    );
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("blocks users without remaining desktop entitlement", async () => {
    vi.mocked(getEntitlementStatus).mockResolvedValue(entitlement(false));

    await expect(
      requireDesktopEntitlement({
        userId: "user-1",
        userEmail: "user@example.test",
        deviceId: "device-1",
        authMethod: "desktop_access_token",
      }),
    ).rejects.toBeInstanceOf(DesktopAuthError);
  });
});
