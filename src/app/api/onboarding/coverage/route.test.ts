import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  handleAuthError: vi.fn(() =>
    Response.json({ error: { code: "unauthorized" } }, { status: 401 }),
  ),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/coverage/activation", () => ({
  tryRecordCoverageActivation: vi.fn().mockResolvedValue(false),
}));

import { getAuthUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { GET } from "./route";

describe("GET /api/onboarding/coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as never);
  });

  it("does not report completion from counts without the persisted milestone", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      adminWithProgress({ achievedAt: null }),
    );

    const response = await GET(request());
    const payload = (await response.json()) as {
      progress: { activated: boolean; coverage_count: number };
    };

    expect(response.status).toBe(200);
    expect(payload.progress).toMatchObject({
      activated: false,
      coverage_count: 3,
    });
  });

  it("reports completion only when coverage_activated exists", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      adminWithProgress({ achievedAt: "2026-07-18T03:00:00.000Z" }),
    );

    const response = await GET(request());
    const payload = (await response.json()) as {
      progress: { activated: boolean; achieved_at: string | null };
    };

    expect(payload.progress).toMatchObject({
      activated: true,
      achieved_at: "2026-07-18T03:00:00.000Z",
    });
  });

  it("reports durable evidence for the requested filing only", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      adminWithProgress({ achievedAt: null }),
    );

    const response = await GET(
      request("00000000-0000-4000-8000-000000000001"),
    );
    await expect(response.json()).resolves.toMatchObject({
      progress: {
        evidence_opened: true,
        filing_evidence_opened: true,
      },
    });
  });
});

function request(filingEventId?: string) {
  const url = new URL("https://krwontology.com/api/onboarding/coverage");
  if (filingEventId) url.searchParams.set("filing_event_id", filingEventId);
  return new NextRequest(url);
}

function adminWithProgress({ achievedAt }: { achievedAt: string | null }) {
  const results: Record<
    string,
    { data: unknown; count: number | null; error: null }
  > = {
    user_retention_milestones: {
      data: achievedAt ? { achieved_at: achievedAt } : null,
      count: null,
      error: null,
    },
    user_company_marks: { data: null, count: 3, error: null },
    user_filing_judgments: { data: null, count: 1, error: null },
    user_company_monitoring_rules: { data: null, count: 1, error: null },
    user_filing_source_opens: { data: null, count: 1, error: null },
  };
  return {
    from(table: string) {
      return query(results[table] ?? { data: null, count: 0, error: null });
    },
  } as unknown as ReturnType<typeof getSupabaseAdmin>;
}

function query<T>(result: T) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    not: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve(result),
    then: <TResult1 = T, TResult2 = never>(
      onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve(result).then(onfulfilled, onrejected),
  };
  return builder;
}
