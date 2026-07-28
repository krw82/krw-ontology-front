import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  getSupabaseAdmin: vi.fn(),
  isEditorialAdmin: vi.fn(),
  isLocalEditorialAdminRequest: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  forbiddenError: vi.fn((message: string) =>
    Response.json({ error: { code: "forbidden", message } }, { status: 403 }),
  ),
  getAuthUser: mocks.getAuthUser,
  handleAuthError: vi.fn(() =>
    Response.json({ error: { code: "auth_required" } }, { status: 401 }),
  ),
}));
vi.mock("@/lib/editorial/access", () => ({
  isEditorialAdmin: mocks.isEditorialAdmin,
  isLocalEditorialAdminRequest: mocks.isLocalEditorialAdminRequest,
}));
vi.mock("@/lib/editorial/repository", () => ({ PULSE_EDITORIAL_BUCKET: "pulse-editorial" }));
vi.mock("@/lib/filing-notifications/request", () => ({
  invalidOriginResponse: vi.fn(() =>
    Response.json({ error: { code: "forbidden" } }, { status: 403 }),
  ),
  isExpectedMutationOrigin: vi.fn(() => true),
}));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: mocks.getSupabaseAdmin }));

import { PATCH } from "./route";

const entryId = "e1b2c3d4-e5f6-4789-abcd-123456789012";

function context() {
  return { params: Promise.resolve({ entryId }) } as never;
}

function requestWithInvalidSlideOrder() {
  const formData = new FormData();
  formData.set("title", "애플 회사 이야기");
  formData.set("body", "");
  formData.set("ticker", "AAPL");
  formData.set("format", "carousel");
  formData.set("status", "draft");
  formData.set("action_label", "");
  formData.set("action_href", "");
  formData.set("publish_at", "");
  formData.set("series_id", "");
  formData.set("episode_number", "");
  formData.set("company_visible", "false");
  formData.set("distribute_to_pulse", "false");
  formData.set("distribution_start_at", "");
  formData.set("distribution_end_at", "");
  formData.set("distribution_placement", "early");
  formData.set("distribution_priority", "");
  formData.set("asset_order", "not-json");
  return new NextRequest(`https://krwontology.com/api/editorial/${entryId}`, {
    method: "PATCH",
    headers: { origin: "https://krwontology.com" },
    body: formData,
  });
}

describe("PATCH /api/editorial/[entryId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUser.mockResolvedValue({
      id: "editor-1",
      email: "editor@example.test",
    });
    mocks.isEditorialAdmin.mockReturnValue(true);
    mocks.isLocalEditorialAdminRequest.mockReturnValue(true);
  });

  it("rejects malformed slide order before accessing Storage or the database", async () => {
    const response = await PATCH(requestWithInvalidSlideOrder(), context());

    expect(response).toBeDefined();
    if (!response) throw new Error("Expected PATCH to return a response");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error", message: expect.stringContaining("슬라이드") },
    });
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });
});
