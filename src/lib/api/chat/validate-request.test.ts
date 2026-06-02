import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { MAX_CHAT_ATTACHMENT_BYTES } from "@/lib/chat/attachments";
import { validateRequest } from "./validate-request";

const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440001";
const SECOND_REQUEST_ID = "550e8400-e29b-41d4-a716-446655440002";

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
      makeRequest({ content: { text: "hi" }, request_id: REQUEST_ID }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    expect(await json(result.response)).toMatchObject({
      error: {
        code: "validation_error",
        message: "content and request_id must be strings",
      },
      request_id: REQUEST_ID,
    });
    expect(getAuthUser).not.toHaveBeenCalled();
  });

  it("rejects non-UUID request ids before querying auth/session data", async () => {
    const result = await validateRequest(
      makeRequest({ content: "hello", request_id: "req-1" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    expect(await json(result.response)).toMatchObject({
      error: {
        code: "validation_error",
        message: "request_id must be a valid UUID",
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
        request_id: REQUEST_ID,
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
        request_id: REQUEST_ID,
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

  it("rejects unsupported file attachment extensions on the server", async () => {
    const result = await validateRequest(
      makeRequest({
        content:
          "please read\n\n<attached_file name=\"filing.pdf\">\ntext\n</attached_file>",
        request_id: REQUEST_ID,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    expect(await json(result.response)).toMatchObject({
      error: {
        code: "validation_error",
        message: "txt 또는 md 파일만 첨부할 수 있습니다.",
      },
      request_id: REQUEST_ID,
    });
    expect(getAuthUser).not.toHaveBeenCalled();
  });

  it("rejects malformed attachment markers on the server", async () => {
    const result = await validateRequest(
      makeRequest({
        content: "hello\n\n<attached_file name=\"note.md\">\nmissing close",
        request_id: REQUEST_ID,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    expect(await json(result.response)).toMatchObject({
      error: {
        code: "validation_error",
        message: "첨부 파일 형식이 올바르지 않습니다.",
      },
    });
    expect(getAuthUser).not.toHaveBeenCalled();
  });

  it("rejects oversized individual attachments on the server", async () => {
    const result = await validateRequest(
      makeRequest({
        content: `<attached_file name=\"note.md\">\n${"a".repeat(
          MAX_CHAT_ATTACHMENT_BYTES + 1,
        )}\n</attached_file>`,
        request_id: REQUEST_ID,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    expect(await json(result.response)).toMatchObject({
      error: {
        code: "validation_error",
        message: `첨부 파일 하나는 ${MAX_CHAT_ATTACHMENT_BYTES.toLocaleString()}바이트를 넘을 수 없습니다.`,
      },
    });
    expect(getAuthUser).not.toHaveBeenCalled();
  });

  it("returns normalized body and authenticated user for valid input", async () => {
    const result = await validateRequest(
      makeRequest({
        content: "hello",
        request_id: ` ${REQUEST_ID} `,
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
      request_id: REQUEST_ID,
      scope_type: "company",
      default_tickers: ["AAPL"],
      default_document_types: ["10-K"],
      research_mode: "deep",
    });
  });

  it("normalizes missing or invalid research mode to deep", async () => {
    const missingResult = await validateRequest(
      makeRequest({
        content: "hello",
        request_id: REQUEST_ID,
      }),
    );
    const invalidResult = await validateRequest(
      makeRequest({
        content: "hello",
        request_id: SECOND_REQUEST_ID,
        research_mode: "slow",
      }),
    );

    expect(missingResult.ok).toBe(true);
    expect(invalidResult.ok).toBe(true);
    if (!missingResult.ok || !invalidResult.ok) return;
    expect(missingResult.data.body.research_mode).toBe("deep");
    expect(invalidResult.data.body.research_mode).toBe("deep");
  });

  it("accepts explicit research modes", async () => {
    const result = await validateRequest(
      makeRequest({
        content: "hello",
        request_id: REQUEST_ID,
        research_mode: "deep",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.body.research_mode).toBe("deep");
  });

  it("accepts valid markdown attachments after server-side validation", async () => {
    const result = await validateRequest(
      makeRequest({
        content: "summarize\n\n<attached_file name=\"note.md\">\n# Memo\n</attached_file>",
        request_id: REQUEST_ID,
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.body.content).toContain("<attached_file name=\"note.md\">");
  });

  it("passes the normalized request id to auth errors", async () => {
    vi.mocked(getAuthUser).mockRejectedValueOnce(new Error("No user"));

    const result = await validateRequest(
      makeRequest({ content: "hello", request_id: ` ${REQUEST_ID} ` }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(handleAuthError).toHaveBeenCalledWith(expect.any(Error), REQUEST_ID);
  });
});
