import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/share/message-share", () => ({
  findPublicShareStarter: vi.fn(),
}));
vi.mock("@/lib/analytics/server", () => ({
  recordAnalyticsEventFromRequest: vi.fn(),
}));

import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { findPublicShareStarter } from "@/lib/share/message-share";
import { GET } from "./route";

const TOKEN = "abcdefghijklmnop";

function request(token = TOKEN) {
  return new NextRequest(`http://localhost/api/share/${token}/starter`);
}

function params(token = TOKEN) {
  return { params: Promise.resolve({ token }) };
}

async function json(response: Response) {
  return response.json() as Promise<{
    question_content?: string;
    tickers?: string[];
    title?: string;
    error?: { code: string; message: string };
  }>;
}

describe("GET /api/share/[token]/starter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the public starter question without answer content", async () => {
    vi.mocked(findPublicShareStarter).mockResolvedValue({
      token: TOKEN,
      title: "AAPL 답변",
      question_content: "AAPL 서비스 매출 리스크를 정리해줘.",
      tickers: ["AAPL"],
    });

    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      question_content: "AAPL 서비스 매출 리스크를 정리해줘.",
      tickers: ["AAPL"],
      title: "AAPL 답변",
    });
    expect(recordAnalyticsEventFromRequest).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        eventName: "share_starter_loaded",
        properties: expect.objectContaining({
          ticker_count: 1,
          question_length: "AAPL 서비스 매출 리스크를 정리해줘.".length,
        }),
      }),
    );
  });

  it("rejects invalid tokens before lookup", async () => {
    const response = await GET(request("bad token"), params("bad token"));

    expect(response.status).toBe(404);
    expect(findPublicShareStarter).not.toHaveBeenCalled();
    expect(await json(response)).toMatchObject({
      error: {
        code: "not_found",
      },
    });
  });

  it("returns 404 when the share has no starter question", async () => {
    vi.mocked(findPublicShareStarter).mockResolvedValue(null);

    const response = await GET(request(), params());

    expect(response.status).toBe(404);
    expect(await json(response)).toMatchObject({
      error: {
        code: "not_found",
      },
    });
  });
});
