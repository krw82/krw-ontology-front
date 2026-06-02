import { describe, expect, it } from "vitest";
import { getClientIp } from "./client-ip";

describe("getClientIp", () => {
  it("prefers Cloudflare's connecting IP when present", () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.20",
      "x-real-ip": "198.51.100.8",
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
    });

    expect(getClientIp(headers)).toBe("203.0.113.20");
  });

  it("falls back to x-real-ip and then the first forwarded IP", () => {
    expect(
      getClientIp(
        new Headers({
          "x-real-ip": "198.51.100.8",
          "x-forwarded-for": "203.0.113.10, 10.0.0.1",
        }),
      ),
    ).toBe("198.51.100.8");

    expect(
      getClientIp(
        new Headers({
          "x-forwarded-for": "203.0.113.10, 10.0.0.1",
        }),
      ),
    ).toBe("203.0.113.10");
  });

  it("uses a stable unknown bucket when no client IP header exists", () => {
    expect(getClientIp(new Headers())).toBe("unknown");
  });
});
