import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  handleAuthError: vi.fn((error: unknown) =>
    Response.json(
      {
        error: {
          code: "auth_required",
          message: error instanceof Error ? error.message : "Auth failed",
        },
      },
      { status: 401 },
    ),
  ),
}));
vi.mock("@/lib/ontology/catalog", () => ({
  getIndexedCompany: vi.fn(),
  searchIndexedCompanies: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth";
import {
  getIndexedCompany,
  searchIndexedCompanies,
} from "@/lib/ontology/catalog";
import { GET } from "./route";

function request(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

async function json(response: Response) {
  return response.json() as Promise<{
    companies?: Array<{ ticker: string }>;
    count?: number;
    error?: { code: string; message: string };
  }>;
}

describe("GET /api/companies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as Awaited<ReturnType<typeof getAuthUser>>);
  });

  it("uses a direct ticker lookup for ticker validation requests", async () => {
    vi.mocked(getIndexedCompany).mockResolvedValue({
      ticker: "AAPL",
      name: "Apple Inc.",
    } as Awaited<ReturnType<typeof getIndexedCompany>>);

    const response = await GET(request("/api/companies?ticker=AAPL"));

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      companies: [{ ticker: "AAPL" }],
      count: 1,
    });
    expect(getIndexedCompany).toHaveBeenCalledWith("AAPL");
    expect(searchIndexedCompanies).not.toHaveBeenCalled();
  });

  it("delegates general company search to a bounded catalog query", async () => {
    vi.mocked(searchIndexedCompanies).mockResolvedValue([
      { ticker: "AAPL", name: "Apple Inc." },
    ] as Awaited<ReturnType<typeof searchIndexedCompanies>>);

    const response = await GET(request("/api/companies?q=apple&limit=200"));

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      companies: [{ ticker: "AAPL" }],
      count: 1,
    });
    expect(searchIndexedCompanies).toHaveBeenCalledWith({
      query: "apple",
      limit: 200,
    });
  });

  it("returns a clear 500 when catalog loading fails", async () => {
    vi.mocked(searchIndexedCompanies).mockRejectedValue(
      new Error("catalog unavailable"),
    );

    const response = await GET(request("/api/companies?q=apple"));

    expect(response.status).toBe(500);
    expect(await json(response)).toMatchObject({
      error: {
        code: "internal_error",
        message: "회사 목록을 불러오지 못했습니다.",
      },
    });
  });
});
