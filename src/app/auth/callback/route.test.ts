import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { createClient } from "@/lib/supabase/server";
import { GET } from "./route";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/analytics/server", () => ({
  recordAnalyticsEventFromRequest: vi.fn().mockResolvedValue({ ok: true }),
}));

const ORIGINAL_AUTH_REDIRECT_ORIGIN = process.env.AUTH_REDIRECT_ORIGIN;
const ORIGINAL_NEXT_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
const ORIGINAL_NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

function mockChatSessionLookup(
  sessions: Array<{ id: string }> = [{ id: "session-1" }],
) {
  return vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue({
            data: sessions,
            error: null,
          }),
        })),
      })),
    })),
  }));
}

function mockSuccessfulExchange(options: {
  sessions?: Array<{ id: string }>;
} = {}) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      exchangeCodeForSession: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
        error: null,
      }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    from: mockChatSessionLookup(options.sessions),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    delete process.env.AUTH_REDIRECT_ORIGIN;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    vi.clearAllMocks();
    vi.mocked(recordAnalyticsEventFromRequest).mockResolvedValue({ ok: true });
    mockSuccessfulExchange();
  });

  afterEach(() => {
    process.env.AUTH_REDIRECT_ORIGIN = ORIGINAL_AUTH_REDIRECT_ORIGIN;
    process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_NEXT_PUBLIC_APP_URL;
  });

  it("ignores forwarded host headers when building OAuth redirects", async () => {
    const response = await GET(
      new Request("http://internal.local/auth/callback?code=ok&next=/companies", {
        headers: {
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
        },
      }),
    );

    expect(response.headers.get("location")).toBe(
      "http://internal.local/companies",
    );
  });

  it("prefers an explicitly configured redirect origin", async () => {
    process.env.AUTH_REDIRECT_ORIGIN = "https://app.example";

    const response = await GET(
      new Request("http://internal.local/auth/callback?code=ok&next=/companies"),
    );

    expect(response.headers.get("location")).toBe(
      "https://app.example/companies",
    );
  });

  it("rejects absolute and protocol-relative next paths", async () => {
    const absoluteResponse = await GET(
      new Request(
        "http://internal.local/auth/callback?code=ok&next=https%3A%2F%2Fevil.example%2F",
      ),
    );
    const protocolRelativeResponse = await GET(
      new Request(
        "http://internal.local/auth/callback?code=ok&next=%2F%2Fevil.example%2F",
      ),
    );

    expect(absoluteResponse.headers.get("location")).toBe(
      "http://internal.local/companies",
    );
    expect(protocolRelativeResponse.headers.get("location")).toBe(
      "http://internal.local/companies",
    );
  });

  it("normalizes recursive next params before redirecting", async () => {
    const response = await GET(
      new Request(
        "http://internal.local/auth/callback?code=ok&next=%2Fcompanies%3Fnext%3D%252Fcompanies%253Fnext%253D%25252Fcompanies",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "http://internal.local/companies",
    );
  });

  it("preserves desktop approval code redirects after OAuth", async () => {
    mockSuccessfulExchange({ sessions: [] });

    const response = await GET(
      new Request(
        "http://internal.local/auth/callback?code=ok&next=%2Flogin%3Fdesktop_code%3DABCD-1234",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "http://internal.local/login?desktop_code=ABCD-1234",
    );
  });

  it("sends first-run web users to product onboarding with their original destination", async () => {
    mockSuccessfulExchange({ sessions: [] });

    const response = await GET(
      new Request(
        "http://internal.local/auth/callback?code=ok&next=%2Fchat%2Fnew%3Fticker%3DTSLA",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "http://internal.local/companies?onboarding=1&continue=%2Fchat%2Fnew%3Fticker%3DTSLA",
    );
    expect(recordAnalyticsEventFromRequest).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        eventName: "login_completed",
        properties: expect.objectContaining({
          next_path: "/chat/new?ticker=TSLA",
        }),
      }),
    );
  });

  it("reports OAuth provider errors without trying code exchange", async () => {
    const exchangeCodeForSession = vi.fn();
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        exchangeCodeForSession,
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const response = await GET(
      new Request(
        "http://internal.local/auth/callback?error=access_denied&error_description=Denied",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "http://internal.local/login?error=oauth&reason=provider",
    );
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("falls back to an existing session when code exchange is retried", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "auth code already used" },
        }),
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const response = await GET(
      new Request("http://internal.local/auth/callback?code=used&next=/chat"),
    );

    expect(response.headers.get("location")).toBe("http://internal.local/chat");
  });

  it("redirects authenticated callback re-entry without showing an OAuth error", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi.fn(),
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const response = await GET(
      new Request("http://internal.local/auth/callback?next=/companies"),
    );

    expect(response.headers.get("location")).toBe(
      "http://internal.local/companies",
    );
  });

  it("uses a reasoned login redirect when callback has no code and no session", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi.fn(),
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const response = await GET(
      new Request("http://internal.local/auth/callback?next=/companies"),
    );

    expect(response.headers.get("location")).toBe(
      "http://internal.local/login?error=oauth&reason=missing_code",
    );
  });
});
