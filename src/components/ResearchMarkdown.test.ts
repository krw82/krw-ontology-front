import { describe, expect, it } from "vitest";
import {
  getSafeMarkdownHref,
  getSafeMarkdownImageSrc,
} from "@/components/ResearchMarkdown";

describe("ResearchMarkdown URL sanitization", () => {
  it("allows expected link schemes and local anchors", () => {
    expect(getSafeMarkdownHref("https://example.com/report")).toBe(
      "https://example.com/report",
    );
    expect(getSafeMarkdownHref("mailto:analyst@example.com")).toBe(
      "mailto:analyst@example.com",
    );
    expect(getSafeMarkdownHref("#risk-factors")).toBe("#risk-factors");
    expect(getSafeMarkdownHref("/companies/NVDA")).toBe("/companies/NVDA");
  });

  it("rejects unsafe link and image schemes", () => {
    expect(getSafeMarkdownHref("javascript:alert(1)")).toBeUndefined();
    expect(getSafeMarkdownHref("java\nscript:alert(1)")).toBeUndefined();
    expect(getSafeMarkdownHref("//evil.example/path")).toBeUndefined();
    expect(getSafeMarkdownImageSrc("data:image/svg+xml,<svg />")).toBeUndefined();
    expect(getSafeMarkdownImageSrc("javascript:alert(1)")).toBeUndefined();
  });

  it("allows only http and https image URLs", () => {
    expect(getSafeMarkdownImageSrc("https://example.com/chart.png")).toBe(
      "https://example.com/chart.png",
    );
    expect(getSafeMarkdownImageSrc("http://example.com/chart.png")).toBe(
      "http://example.com/chart.png",
    );
    expect(getSafeMarkdownImageSrc("mailto:analyst@example.com")).toBeUndefined();
  });
});
