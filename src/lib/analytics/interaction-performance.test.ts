import { describe, expect, it } from "vitest";
import {
  navigationTargetMatches,
  normalizeSameOriginNavigationTarget,
} from "./interaction-performance";

describe("interaction performance navigation helpers", () => {
  it("normalizes same-origin app destinations without hashes", () => {
    expect(
      normalizeSameOriginNavigationTarget({
        href: "/pulse?source=tab#new",
        origin: "https://krwontology.com",
      }),
    ).toBe("/pulse?source=tab");
  });

  it("rejects external and non-http destinations", () => {
    expect(
      normalizeSameOriginNavigationTarget({
        href: "https://example.com/pulse",
        origin: "https://krwontology.com",
      }),
    ).toBeNull();
    expect(
      normalizeSameOriginNavigationTarget({
        href: "mailto:research@example.com",
        origin: "https://krwontology.com",
      }),
    ).toBeNull();
  });

  it("matches the exact committed route including search state", () => {
    expect(navigationTargetMatches("/companies?q=aapl", "/companies?q=aapl"))
      .toBe(true);
    expect(navigationTargetMatches("/companies?q=aapl", "/companies?q=msft"))
      .toBe(false);
  });
});
