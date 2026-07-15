import { beforeEach, describe, expect, it } from "vitest";
import {
  getClientIp,
  hasTrustedClientIp,
  hasTrustedClientIpConfiguration,
} from "./client-ip";

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

  it("does not trust the default client IP header in production", () => {
    expect(
      getClientIp(
        new Headers({
          "x-krw-client-ip": "203.0.113.20",
        }),
        { NODE_ENV: "production" },
      ),
    ).toBe("unknown");
  });

  it("requires the Caddy-owned header name in production", () => {
    const env = {
      NODE_ENV: "production",
      TRUSTED_CLIENT_IP_HEADER: "x-forwarded-for",
    };
    const headers = new Headers({
      "x-krw-client-ip": "203.0.113.20",
      "x-forwarded-for": "198.51.100.9",
    });

    expect(hasTrustedClientIpConfiguration(env)).toBe(false);
    expect(hasTrustedClientIp(headers, env)).toBe(false);
    expect(getClientIp(headers, env)).toBe("unknown");
  });

  it("accepts a valid Caddy-owned IP in production", () => {
    const env = {
      NODE_ENV: "production",
      TRUSTED_CLIENT_IP_HEADER: "x-krw-client-ip",
    };
    const headers = new Headers({ "x-krw-client-ip": "2001:db8::1" });

    expect(hasTrustedClientIpConfiguration(env)).toBe(true);
    expect(hasTrustedClientIp(headers, env)).toBe(true);
    expect(getClientIp(headers, env)).toBe("2001:db8::1");
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

  it("rejects a trusted header with a forwarded chain", () => {
    const headers = new Headers({
      "x-krw-client-ip": "203.0.113.20, 10.0.0.1",
    });

    expect(hasTrustedClientIp(headers)).toBe(false);
    expect(getClientIp(headers)).toBe("unknown");
  });

  it("uses a stable unknown bucket when no client IP header exists", () => {
    expect(getClientIp(new Headers())).toBe("unknown");
  });
});
