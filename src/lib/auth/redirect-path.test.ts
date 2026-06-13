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

  it("preserves desktop approval codes on login paths", () => {
    expect(normalizeInternalNextPath("/login?desktop_code=ABCD-1234")).toBe(
      "/login?desktop_code=ABCD-1234",
    );
  });

  it("unwraps OAuth callbacks to desktop approval login paths", () => {
    expect(
      normalizeInternalNextPath(
        "/auth/callback?next=%2Flogin%3Fdesktop_code%3DABCD-1234",
      ),
    ).toBe("/login?desktop_code=ABCD-1234");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(normalizeInternalNextPath("https://evil.example")).toBe("/companies");
    expect(normalizeInternalNextPath("//evil.example")).toBe("/companies");
  });
});
