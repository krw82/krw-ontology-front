import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkQuota } from "@/lib/concurrency/quota";
import { checkQuotaStep } from "./check-quota";

vi.mock("@/lib/concurrency/quota", () => ({
  checkQuota: vi.fn(),
}));

async function json(response: Response) {
  return response.json() as Promise<{
    error?: { code: string; message: string };
    request_id?: string;
  }>;
}

describe("checkQuotaStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns quota when allowed", async () => {
    vi.mocked(checkQuota).mockResolvedValue({
      allowed: true,
      questionsUsed: 2,
      costUsed: 0.5,
    });

    const result = await checkQuotaStep("user-1", "req-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quota.questionsUsed).toBe(2);
  });

  it("maps internal quota failures to a 500 response", async () => {
    vi.mocked(checkQuota).mockResolvedValue({
      allowed: false,
      reason: "internal_error",
      questionsUsed: 0,
      costUsed: 0,
    });

    const result = await checkQuotaStep("user-1", "req-1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(500);
    expect(await json(result.response)).toEqual({
      error: {
        code: "internal_error",
        message: "사용량 정보를 확인하지 못했습니다.",
      },
      request_id: "req-1",
    });
  });

  it("keeps quota limit failures as 429 responses", async () => {
    vi.mocked(checkQuota).mockResolvedValue({
      allowed: false,
      reason: "quota_exceeded",
      questionsUsed: 20,
      costUsed: 1,
    });

    const result = await checkQuotaStep("user-1", "req-1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(await json(result.response)).toMatchObject({
      error: {
        code: "quota_exceeded",
        message: "Daily question limit exceeded",
      },
    });
  });
});
