import { beforeEach, describe, expect, it } from "vitest";
import { getClientIp } from "./client-ip";

describe("getClientIp", () => {
  beforeEach(() => {
    delete process.env.TRUSTED_CLIENT_IP_HEADER;
  });

  it("uses the trusted ingress-set client IP header", () => {
    const headers = new Headers({
      "x-krw-client-ip": "203.0.113.20",
      "cf-connecting-ip": "198.51.100.9",
      "x-real-ip": "198.51.100.8",
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
    });

    expect(getClientIp(headers)).toBe("203.0.113.20");
  });

  it("ignores directly supplied proxy headers", () => {
    expect(
      getClientIp(
        new Headers({
          "cf-connecting-ip": "198.51.100.9",
          "x-real-ip": "198.51.100.8",
          "x-forwarded-for": "203.0.113.10, 10.0.0.1",
        }),
      ),
    ).toBe("unknown");
  });

  it("supports a configured trusted header name", () => {
    process.env.TRUSTED_CLIENT_IP_HEADER = "x-ingress-client-ip";

    expect(
      getClientIp(
        new Headers({
          "x-ingress-client-ip": "2001:db8::1",
        }),
      ),
    ).toBe("2001:db8::1");
  });

  it("rejects malformed trusted client IP values", () => {
    expect(
      getClientIp(
        new Headers({
          "x-krw-client-ip": "not-an-ip",
        }),
      ),
    ).toBe("unknown");
  });

  it("uses a stable unknown bucket when no client IP header exists", () => {
    expect(getClientIp(new Headers())).toBe("unknown");
  });
});
