import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStaticPulseE2EFeed,
  isStaticPulseE2EFixtureConfigured,
} from "@/lib/pulse/e2e-fixture";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Pulse production E2E fixture", () => {
  it("is disabled unless the explicit auth-bypass fixture flags are present", () => {
    vi.stubEnv("KRW_E2E_STATIC_PULSE", "1");
    vi.stubEnv("DEV_AUTH_BYPASS", "0");

    expect(isStaticPulseE2EFixtureConfigured()).toBe(false);
  });

  it("requires the locked production E2E runtime configuration in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KRW_E2E_STATIC_PULSE", "1");
    vi.stubEnv("DEV_AUTH_BYPASS", "1");
    vi.stubEnv("KRW_E2E_PRODUCTION_AUTH_BYPASS", "1");
    vi.stubEnv("KRW_E2E_SERVER_BIND", "0.0.0.0");
    vi.stubEnv("KRW_E2E_AUTH_TOKEN", "a".repeat(64));

    expect(isStaticPulseE2EFixtureConfigured()).toBe(false);

    vi.stubEnv("KRW_E2E_SERVER_BIND", "127.0.0.1");
    expect(isStaticPulseE2EFixtureConfigured()).toBe(true);
  });

  it("returns one deterministic P0 card without a legacy checkup", () => {
    const first = createStaticPulseE2EFeed();
    const second = createStaticPulseE2EFeed();

    expect(second).toEqual(first);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      kind: "filing",
      metadata: { development_showcase: true },
    });
    expect(first.items.some((item) => item.kind === "checkup")).toBe(false);
  });
});
