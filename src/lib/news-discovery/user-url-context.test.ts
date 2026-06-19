import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  isPrivateIpAddress,
  normalizeUserUrlForFetch,
  UserUrlContextError,
} from "./user-url-context";

describe("user URL context safety helpers", () => {
  it("normalizes http and https URLs while dropping fragments", () => {
    expect(normalizeUserUrlForFetch(" https://example.com/news#section ")).toBe(
      "https://example.com/news",
    );
  });

  it("rejects non-http protocols and credential URLs", () => {
    expect(() => normalizeUserUrlForFetch("file:///etc/passwd")).toThrow(
      UserUrlContextError,
    );
    expect(() =>
      normalizeUserUrlForFetch("https://user:pass@example.com/news"),
    ).toThrow(UserUrlContextError);
  });

  it("classifies local and private IP ranges as private", () => {
    expect(isPrivateIpAddress("127.0.0.1")).toBe(true);
    expect(isPrivateIpAddress("10.0.0.1")).toBe(true);
    expect(isPrivateIpAddress("172.16.0.1")).toBe(true);
    expect(isPrivateIpAddress("192.168.1.10")).toBe(true);
    expect(isPrivateIpAddress("169.254.1.1")).toBe(true);
    expect(isPrivateIpAddress("8.8.8.8")).toBe(false);
  });
});
