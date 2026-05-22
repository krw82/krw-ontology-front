import { describe, expect, it } from "vitest";
import { normalizeInternalNextPath } from "./redirect-path";

describe("normalizeInternalNextPath", () => {
  it("strips recursive next params from protected paths", () => {
    expect(
      normalizeInternalNextPath(
        "/companies?next=%2Fcompanies%3Fnext%3D%252Fcompanies",
      ),
    ).toBe("/companies");
  });

  it("keeps non-next query params while removing nested next", () => {
    expect(
      normalizeInternalNextPath(
        "/chat?sessionId=abc&next=%2Fcompanies",
      ),
    ).toBe("/chat?sessionId=abc");
  });

  it("unwraps login callback targets before returning the final path", () => {
    expect(
      normalizeInternalNextPath(
        "/login?next=%2Fcompanies%3Fnext%3D%252Fcompanies",
      ),
    ).toBe("/companies");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(normalizeInternalNextPath("https://evil.example")).toBe("/companies");
    expect(normalizeInternalNextPath("//evil.example")).toBe("/companies");
  });
});
