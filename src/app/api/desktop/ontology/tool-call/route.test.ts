import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/desktop/auth", () => ({
  authenticateDesktopRequest: vi.fn(),
  requireDesktopEntitlement: vi.fn(),
  DesktopAuthError: class DesktopAuthError extends Error {
    code = "authentication_error";
    publicMessage = "로그인이 필요합니다.";
    status = 401;
    retryable = false;
  },
}));
vi.mock("@/lib/desktop/ontology-service", () => ({
  executeDesktopOntologyTool: vi.fn(),
  DesktopOntologyServiceError: class DesktopOntologyServiceError extends Error {
    code = "ontology_unavailable";
    publicMessage = "온톨로지를 사용할 수 없습니다.";
    status = 503;
    retryable = true;
  },
}));
vi.mock("@/lib/desktop/ontology-usage", () => ({
  checkDesktopOntologyRateLimit: vi.fn(),
  createDesktopOntologyToolAuditStart: vi.fn(),
  finishDesktopOntologyToolAuditSuccess: vi.fn(),
  finishDesktopOntologyToolAuditFailure: vi.fn(),
  withDesktopOntologyUsage: vi.fn((response, audit, usage, latencyMs) => ({
    ...response,
    usage: {
      ...response.usage,
      remaining_today: usage.remainingToday,
    },
    audit: {
      ...response.audit,
      server_tool_call_id: audit.id,
      latency_ms: latencyMs,
    },
  })),
}));

import {
  authenticateDesktopRequest,
  requireDesktopEntitlement,
} from "@/lib/desktop/auth";
import { executeDesktopOntologyTool } from "@/lib/desktop/ontology-service";
import {
  checkDesktopOntologyRateLimit,
  createDesktopOntologyToolAuditStart,
  finishDesktopOntologyToolAuditFailure,
  finishDesktopOntologyToolAuditSuccess,
} from "@/lib/desktop/ontology-usage";
import { POST } from "./route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/desktop/ontology/tool-call", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer token",
    },
    body: JSON.stringify(body),
  });
}

async function json(response: Response) {
  return response.json() as Promise<{
    ok: boolean;
    error?: { code: string; public_message: string; retryable: boolean };
    result_text?: string;
  }>;
}

describe("POST /api/desktop/ontology/tool-call", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateDesktopRequest).mockResolvedValue({
      userId: "user-1",
      userEmail: "user@example.test",
      deviceId: "device-1",
      authMethod: "desktop_access_token",
    });
    vi.mocked(requireDesktopEntitlement).mockResolvedValue({} as never);
    vi.mocked(checkDesktopOntologyRateLimit).mockResolvedValue({
      ok: true,
      remainingToday: 499,
    });
    vi.mocked(createDesktopOntologyToolAuditStart).mockResolvedValue({
      id: "audit-1",
      startedAt: Date.parse("2026-06-10T00:00:00.000Z"),
    });
    vi.mocked(finishDesktopOntologyToolAuditSuccess).mockResolvedValue(123);
    vi.mocked(finishDesktopOntologyToolAuditFailure).mockResolvedValue(undefined);
    vi.mocked(executeDesktopOntologyTool).mockResolvedValue({
      ok: true,
      tool_call_id: "tool-1",
      tool_name: "krw_ontology_query_context",
      result_text: "Evidence",
      result_json: { summary: "Evidence" },
      ontology_release: {
        release_id: "release-1",
        api_version: "ontology-search/v1",
      },
    });
  });

  it("authenticates, checks entitlement, validates, and executes a tool call", async () => {
    const response = await POST(
      request({
        local_session_id: "session-1",
        local_run_id: "run-1",
        tool_call_id: "tool-1",
        tool_name: "krw_ontology_query_context",
        arguments: {
          question: "AAPL demand",
          tickers: ["aapl"],
        },
        desktop_context: {
          analysis_mode: "company",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      ok: true,
      result_text: "Evidence",
      usage: {
        remaining_today: 499,
      },
      audit: {
        server_tool_call_id: "audit-1",
        latency_ms: 123,
      },
    });
    expect(authenticateDesktopRequest).toHaveBeenCalledTimes(1);
    expect(requireDesktopEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
    );
    expect(executeDesktopOntologyTool).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_name: "krw_ontology_query_context",
        arguments: expect.objectContaining({
          tickers: ["AAPL"],
          response_detail: "compact",
        }),
      }),
      expect.objectContaining({ userId: "user-1" }),
    );
    expect(checkDesktopOntologyRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
    );
    expect(createDesktopOntologyToolAuditStart).toHaveBeenCalledWith(
      expect.objectContaining({ tool_call_id: "tool-1" }),
      expect.objectContaining({ userId: "user-1" }),
    );
    expect(finishDesktopOntologyToolAuditSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: "audit-1" }),
      expect.objectContaining({ ok: true }),
    );
  });

  it("rejects full response detail before invoking the ontology executor", async () => {
    const response = await POST(
      request({
        local_session_id: "session-1",
        local_run_id: "run-1",
        tool_call_id: "tool-1",
        tool_name: "krw_ontology_query",
        arguments: {
          topic: "AAPL",
          response_detail: "full",
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      ok: false,
      error: {
        code: "invalid_tool_arguments",
      },
    });
    expect(executeDesktopOntologyTool).not.toHaveBeenCalled();
    expect(checkDesktopOntologyRateLimit).not.toHaveBeenCalled();
    expect(createDesktopOntologyToolAuditStart).not.toHaveBeenCalled();
  });

  it("rejects unsupported tool names with a policy error", async () => {
    const response = await POST(
      request({
        local_session_id: "session-1",
        local_run_id: "run-1",
        tool_call_id: "tool-1",
        tool_name: "krw_ontology_retrieve",
        arguments: {},
      }),
    );

    expect(response.status).toBe(403);
    expect(await json(response)).toMatchObject({
      ok: false,
      error: {
        code: "tool_not_allowed",
      },
    });
    expect(executeDesktopOntologyTool).not.toHaveBeenCalled();
    expect(checkDesktopOntologyRateLimit).not.toHaveBeenCalled();
  });

  it("returns a Desktop rate-limit response before auditing or execution", async () => {
    vi.mocked(checkDesktopOntologyRateLimit).mockResolvedValue({
      ok: false,
      response: Response.json(
        {
          ok: false,
          error: {
            code: "rate_limited",
            public_message: "Too many requests",
            retryable: true,
          },
        },
        { status: 429, headers: { "Retry-After": "42" } },
      ),
    });

    const response = await POST(
      request({
        local_session_id: "session-1",
        local_run_id: "run-1",
        tool_call_id: "tool-1",
        tool_name: "krw_ontology_query_context",
        arguments: {
          question: "AAPL demand",
        },
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(await json(response)).toMatchObject({
      ok: false,
      error: {
        code: "rate_limited",
      },
    });
    expect(createDesktopOntologyToolAuditStart).not.toHaveBeenCalled();
    expect(executeDesktopOntologyTool).not.toHaveBeenCalled();
  });

  it("marks the audit row failed when execution throws", async () => {
    const error = new Error("executor failed");
    vi.mocked(executeDesktopOntologyTool).mockRejectedValue(error);

    const response = await POST(
      request({
        local_session_id: "session-1",
        local_run_id: "run-1",
        tool_call_id: "tool-1",
        tool_name: "krw_ontology_query_context",
        arguments: {
          question: "AAPL demand",
        },
      }),
    );

    expect(response.status).toBe(500);
    expect(finishDesktopOntologyToolAuditFailure).toHaveBeenCalledWith(
      expect.objectContaining({ id: "audit-1" }),
      error,
    );
    expect(finishDesktopOntologyToolAuditSuccess).not.toHaveBeenCalled();
  });
});
