import { describe, expect, it } from "vitest";
import {
  getConfiguredAppOrigin,
  getConfiguredRedirectOrigin,
  normalizeRedirectOrigin,
} from "./origin";

describe("auth origin helpers", () => {
  it("normalizes safe http and https origins", () => {
    expect(normalizeRedirectOrigin("https://krwontology.com/chat")).toBe(
      "https://krwontology.com",
    );
    expect(normalizeRedirectOrigin("http://localhost:3000/login")).toBe(
      "http://localhost:3000",
    );
  });

  it("rejects unsafe or malformed origins", () => {
    expect(normalizeRedirectOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeRedirectOrigin("https://user:pass@example.com")).toBeNull();
    expect(normalizeRedirectOrigin("not a url")).toBeNull();
  });

  it("uses the public site URL as the canonical app origin", () => {
    expect(
      getConfiguredAppOrigin({
        NEXT_PUBLIC_SITE_URL: "https://krwontology.com/path",
        NEXT_PUBLIC_APP_URL: "https://app.krwontology.com",
      }),
    ).toBe("https://krwontology.com");
  });

  it("prefers the explicit auth redirect origin for callbacks", () => {
    expect(
      getConfiguredRedirectOrigin("https://request.example", {
        AUTH_REDIRECT_ORIGIN: "https://auth.krwontology.com",
        NEXT_PUBLIC_SITE_URL: "https://krwontology.com",
      }),
    ).toBe("https://auth.krwontology.com");
  });
});
