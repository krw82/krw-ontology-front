import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  handleAuthError: vi.fn(() => Response.json({ error: { code: "auth_required" } }, { status: 401 })),
}));
vi.mock("@/lib/filing-notifications/request", () => ({
  isExpectedMutationOrigin: vi.fn(),
  invalidOriginResponse: vi.fn(() =>
    Response.json({ error: { code: "forbidden" } }, { status: 403 }),
  ),
}));
vi.mock("@/lib/judgments/repository", () => ({
  getFilingJudgment: vi.fn(),
  saveFilingJudgment: vi.fn(),
}));
vi.mock("@/lib/analytics/server", () => ({
  recordAnalyticsEventFromRequest: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/coverage/activation", () => ({
  tryRecordCoverageActivation: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth";
import { isExpectedMutationOrigin } from "@/lib/filing-notifications/request";
import { saveFilingJudgment } from "@/lib/judgments/repository";
import { PATCH, POST } from "./route";

const eventId = "00000000-0000-4000-8000-000000000001";
const params = Promise.resolve({ eventId });

function request(method: "POST" | "PATCH", body: unknown, origin = "https://krwontology.com") {
  return new NextRequest(`https://krwontology.com/api/filings/${eventId}/judgment`, {
    method,
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

const body = {
  client_mutation_id: "mutation-123",
  context_ticker: "GOOGL",
  impact: "neutral",
  next_action: "review_later",
  summary: "추가 확인이 필요하다.",
};

describe("filing judgment mutation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({ id: "user-1", email: "u@test.dev" } as never);
    vi.mocked(isExpectedMutationOrigin).mockReturnValue(true);
    vi.mocked(saveFilingJudgment).mockResolvedValue({
      judgment: { current_revision_id: "revision-1" },
      idempotent_replay: false,
    } as never);
  });

  it("blocks cross-origin writes before authentication and persistence", async () => {
    vi.mocked(isExpectedMutationOrigin).mockReturnValue(false);
    const response = await POST(request("POST", body, "https://evil.test"), { params });
    expect(response.status).toBe(403);
    expect(getAuthUser).not.toHaveBeenCalled();
    expect(saveFilingJudgment).not.toHaveBeenCalled();
  });

  it("maps client_mutation_id to a full replacement save", async () => {
    const response = await POST(request("POST", body), { params });
    expect(response.status).toBe(201);
    expect(saveFilingJudgment).toHaveBeenCalledWith(
      "user-1",
      eventId,
      expect.objectContaining({
        client_mutation_id: "mutation-123",
        context_ticker: "GOOGL",
        expected_revision_number: 0,
      }),
    );
  });

  it("requires optimistic concurrency for PATCH", async () => {
    const response = await PATCH(request("PATCH", body), { params });
    expect(response.status).toBe(400);
    expect(saveFilingJudgment).not.toHaveBeenCalled();
  });

  it("returns a conflict when the expected revision is stale", async () => {
    vi.mocked(saveFilingJudgment).mockRejectedValue(
      new Error("Failed to save: judgment_revision_conflict"),
    );
    const response = await PATCH(
      request("PATCH", { ...body, expected_revision_number: 1 }),
      { params },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "judgment_revision_conflict" },
    });
  });
});
