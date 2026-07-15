import { describe, expect, it } from "vitest";

import { normalizeDiscoverUrl } from "./discover-guide";

describe("normalizeDiscoverUrl", () => {
  it("adds https to a bare host while preserving the canonical URL", () => {
    expect(normalizeDiscoverUrl(" example.com/report ")).toBe(
      "https://example.com/report",
    );
  });

  it("keeps valid http and https URLs", () => {
    expect(normalizeDiscoverUrl("http://example.com/report")).toBe(
      "http://example.com/report",
    );
    expect(normalizeDiscoverUrl("https://example.com/report?source=chat")).toBe(
      "https://example.com/report?source=chat",
    );
  });

  it("rejects empty and malformed URLs", () => {
    expect(normalizeDiscoverUrl(" ")).toBeNull();
    expect(normalizeDiscoverUrl("https://")).toBeNull();
  });
});
