import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { validateRequest } from "./validate-request";

vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  handleAuthError: vi.fn((error: unknown, requestId?: string) =>
    Response.json(
      {
        error: {
          code: "auth_required",
          message: error instanceof Error ? error.message : "Auth failed",
        },
        request_id: requestId,
      },
      { status: 401 },
    ),
  ),
}));

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/chat/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json(response: Response) {
  return response.json() as Promise<{
    error?: { code: string; message: string };
    request_id?: string;
  }>;
}

describe("validateRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as Awaited<ReturnType<typeof getAuthUser>>);
  });

  it("rejects non-object request bodies", async () => {
    const result = await validateRequest(makeRequest(null));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    expect(await json(result.response)).toMatchObject({
      error: { code: "validation_error" },
    });
    expect(getAuthUser).not.toHaveBeenCalled();
  });

  it("rejects non-string content before content limit checks can throw", async () => {
    const result = await validateRequest(
      makeRequest({ content: { text: "hi" }, request_id: "req-1" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    expect(await json(result.response)).toMatchObject({
      error: {
        code: "validation_error",
        message: "content and request_id must be strings",
      },
      request_id: "req-1",
    });
    expect(getAuthUser).not.toHaveBeenCalled();
  });

  it("rejects invalid session ids before querying auth/session data", async () => {
    const result = await validateRequest(
      makeRequest({
        session_id: "not-a-uuid",
        content: "hello",
        request_id: "req-1",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    expect(await json(result.response)).toMatchObject({
      error: {
        code: "validation_error",
        message: "session_id must be a valid UUID",
      },
    });
    expect(getAuthUser).not.toHaveBeenCalled();
  });

  it("rejects company scope when ticker list is empty after normalization", async () => {
    const result = await validateRequest(
      makeRequest({
        content: "hello",
        request_id: "req-1",
        scope_type: "company",
        default_tickers: ["  "],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    expect(await json(result.response)).toMatchObject({
      error: {
        code: "validation_error",
        message: "default_tickers required for company scope",
      },
    });
    expect(getAuthUser).not.toHaveBeenCalled();
  });

  it("returns normalized body and authenticated user for valid input", async () => {
    const result = await validateRequest(
      makeRequest({
        content: "hello",
        request_id: " req-1 ",
        scope_type: "company",
        default_tickers: [" AAPL ", "AAPL"],
        default_document_types: [" 10-K ", ""],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.userId).toBe("user-1");
    expect(result.data.body).toMatchObject({
      content: "hello",
      request_id: "req-1",
      scope_type: "company",
      default_tickers: ["AAPL"],
      default_document_types: ["10-K"],
    });
  });

  it("passes the normalized request id to auth errors", async () => {
    vi.mocked(getAuthUser).mockRejectedValueOnce(new Error("No user"));

    const result = await validateRequest(
      makeRequest({ content: "hello", request_id: " req-1 " }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(handleAuthError).toHaveBeenCalledWith(expect.any(Error), "req-1");
  });
});
