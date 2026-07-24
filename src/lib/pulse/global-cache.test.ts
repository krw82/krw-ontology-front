import { describe, expect, it } from "vitest";
import { pulseGlobalCacheKey, pulseRedisUrl } from "@/lib/pulse/global-cache";

describe("Pulse global candidate cache", () => {
  it("uses a revision- and time-window-scoped key with no user identity", () => {
    expect(pulseGlobalCacheKey({ env: "prod", globalRevision: 41, timeBucket: 123 })).toBe(
      "krwo:pulse:global-filing-candidates:v4:prod:41:123",
    );
  });

  it("prefers the dedicated Pulse Redis URL without requiring it", () => {
    expect(pulseRedisUrl({
      PULSE_REDIS_URL: "redis://pulse:6379/2",
      REDIS_QUEUE_URL: "redis://queue:6379/0",
    })).toBe("redis://pulse:6379/2");
    expect(pulseRedisUrl({})).toBeNull();
  });
});
