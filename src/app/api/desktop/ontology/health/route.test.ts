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
vi.mock("@/lib/ontology/catalog", () => ({
  getActiveOntologyCatalogRelease: vi.fn(),
}));
vi.mock("@/lib/desktop/ontology-mcp-client", () => ({
  checkKrwOntologyMcpHealth: vi.fn(),
  shouldUseDesktopOntologyMcp: vi.fn(),
}));

import {
  authenticateDesktopRequest,
  requireDesktopEntitlement,
} from "@/lib/desktop/auth";
import {
  checkKrwOntologyMcpHealth,
  shouldUseDesktopOntologyMcp,
} from "@/lib/desktop/ontology-mcp-client";
import { getActiveOntologyCatalogRelease } from "@/lib/ontology/catalog";
import { GET } from "./route";

function request() {
  return new NextRequest("http://localhost/api/desktop/ontology/health", {
    headers: {
      authorization: "Bearer token",
    },
  });
}

describe("GET /api/desktop/ontology/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateDesktopRequest).mockResolvedValue({
      userId: "user-1",
      userEmail: "user@example.test",
      deviceId: "device-1",
      authMethod: "desktop_access_token",
    });
    vi.mocked(requireDesktopEntitlement).mockResolvedValue({} as never);
    vi.mocked(shouldUseDesktopOntologyMcp).mockReturnValue(false);
    vi.mocked(checkKrwOntologyMcpHealth).mockResolvedValue({
      ok: true,
      releaseId: "release-1",
      indexGeneratedAt: "2026-06-10T00:00:00.000Z",
      toolNames: ["krw_ontology_query_context"],
    });
    vi.mocked(getActiveOntologyCatalogRelease).mockResolvedValue({
      env: "prod",
      release_id: "release-1",
      active: true,
      format: "krw-ontology-web-catalog/v1",
      generated_at: "2026-06-10T00:00:00.000Z",
      release_created_at: "2026-06-10T00:00:00.000Z",
      index_generated_at: "2026-06-10T00:00:00.000Z",
      company_count: 12,
      document_count: 30,
      index_document_count: 30,
      object_count: 100,
      manifest_json: {},
      summary_json: {},
      source_json: {},
      catalog_json: {},
      created_at: "2026-06-10T00:00:00.000Z",
      updated_at: "2026-06-10T00:00:00.000Z",
    });
  });

  it("returns active release metadata for authorized Desktop clients", async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      ontology_search_api_ok: true,
      ontology_api_version: "ontology-search/v1",
      active_ontology_release_id: "release-1",
      executor: "catalog",
      release_matches_executor: true,
      mcp: null,
      catalog: {
        company_count: 12,
        document_count: 30,
        object_count: 100,
      },
    });
  });

  it("reports MCP readiness and release agreement when MCP execution is enabled", async () => {
    vi.mocked(shouldUseDesktopOntologyMcp).mockReturnValue(true);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      ontology_search_api_ok: true,
      executor: "mcp",
      release_matches_executor: true,
      mcp: {
        ok: true,
        release_id: "release-1",
        tool_count: 1,
        error: null,
      },
    });
    expect(checkKrwOntologyMcpHealth).toHaveBeenCalledOnce();
  });

  it("reports not ready when MCP is unavailable", async () => {
    vi.mocked(shouldUseDesktopOntologyMcp).mockReturnValue(true);
    vi.mocked(checkKrwOntologyMcpHealth).mockResolvedValue({
      ok: false,
      releaseId: null,
      indexGeneratedAt: null,
      toolNames: [],
      error: "connection refused",
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: false,
      ontology_search_api_ok: false,
      executor: "mcp",
      mcp: {
        ok: false,
        error: "connection refused",
      },
    });
  });

  it("reports not ready when catalog and MCP releases disagree", async () => {
    vi.mocked(shouldUseDesktopOntologyMcp).mockReturnValue(true);
    vi.mocked(checkKrwOntologyMcpHealth).mockResolvedValue({
      ok: true,
      releaseId: "different-release",
      indexGeneratedAt: "2026-06-09T00:00:00.000Z",
      toolNames: ["krw_ontology_query_context"],
    });

    const response = await GET(request());
    const body = await response.json();

    expect(body).toMatchObject({
      ok: false,
      ontology_search_api_ok: false,
      release_matches_executor: false,
      active_ontology_release_id: "release-1",
      mcp: {
        release_id: "different-release",
      },
    });
  });

  it("reports not ready when an otherwise healthy MCP omits its release id", async () => {
    vi.mocked(shouldUseDesktopOntologyMcp).mockReturnValue(true);
    vi.mocked(checkKrwOntologyMcpHealth).mockResolvedValue({
      ok: true,
      releaseId: null,
      indexGeneratedAt: "2026-06-10T00:00:00.000Z",
      toolNames: ["krw_ontology_query_context"],
    });

    const response = await GET(request());
    const body = await response.json();

    expect(body).toMatchObject({
      ok: false,
      ontology_search_api_ok: false,
      release_matches_executor: false,
      active_ontology_release_id: "release-1",
      mcp: {
        ok: true,
        release_id: null,
      },
    });
  });
});
