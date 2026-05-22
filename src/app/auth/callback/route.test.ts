import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { GET } from "./route";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

const ORIGINAL_AUTH_REDIRECT_ORIGIN = process.env.AUTH_REDIRECT_ORIGIN;
const ORIGINAL_NEXT_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
const ORIGINAL_NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

function mockSuccessfulExchange() {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    delete process.env.AUTH_REDIRECT_ORIGIN;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    vi.clearAllMocks();
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
});
