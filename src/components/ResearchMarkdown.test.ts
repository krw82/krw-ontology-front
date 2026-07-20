import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ResearchMarkdown, {
  getSafeMarkdownHref,
  getSafeMarkdownImageSrc,
  normalizeResearchMarkdown,
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
    expect(
      getSafeMarkdownHref("https://krwontology.com/ko/companies/NVDA"),
    ).toBe("https://krwontology.com/ko/companies/NVDA");
  });

  it("rejects unsafe link and image schemes", () => {
    expect(getSafeMarkdownHref("javascript:alert(1)")).toBeUndefined();
    expect(getSafeMarkdownHref("java\nscript:alert(1)")).toBeUndefined();
    expect(getSafeMarkdownHref("//evil.example/path")).toBeUndefined();
    expect(getSafeMarkdownImageSrc("data:image/svg+xml,<svg />")).toBeUndefined();
    expect(getSafeMarkdownImageSrc("javascript:alert(1)")).toBeUndefined();
  });

  it("rejects placeholder company links", () => {
    expect(getSafeMarkdownHref("/companies/UNKNOWN")).toBeUndefined();
    expect(getSafeMarkdownHref("/ko/companies/unknown")).toBeUndefined();
    expect(
      getSafeMarkdownHref("https://krwontology.com/ko/companies/UNKNOWN"),
    ).toBeUndefined();
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

  it("defers decoding and loading safe answer images", () => {
    const html = renderToStaticMarkup(
      createElement(ResearchMarkdown, {
        content: "![실적 차트](https://example.com/chart.png)",
        normalizePlainText: false,
      }),
    );

    expect(html).toContain('src="https://example.com/chart.png"');
    expect(html).toContain('alt="실적 차트"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });
});

describe("ResearchMarkdown plain-text normalization", () => {
  it("promotes likely plain section labels into markdown headings", () => {
    const normalized = normalizeResearchMarkdown(
      [
        "이뮤놀로지는 애브비 최대 매출원입니다. 다만 휴미라 매출이 감소하고 있습니다.",
        "종양학은 고성장 파이프라인으로 전환 중",
        "종양학 포트폴리오는 임브루비카와 벤클렉스타가 주력입니다.",
      ].join("\n"),
    );

    expect(normalized).toContain(
      "### 종양학은 고성장 파이프라인으로 전환 중",
    );
    expect(normalized).toContain(
      "종양학 포트폴리오는 임브루비카와 벤클렉스타가 주력입니다.",
    );
  });

  it("converts bare list lines after an intro into markdown bullets", () => {
    const normalized = normalizeResearchMarkdown(
      [
        "CY2025 10-K 기준 주요 파이프라인 행보:",
        "",
        "Ichnos Glenmark와 ISB-2001 라이선스 계약",
        "RemeGen과 RC148 글로벌 라이선스",
        "파이프라인은 R&D 비용 부담을 수반하지만 중장기 성장 동력입니다",
      ].join("\n"),
    );

    expect(normalized).toContain(
      "- Ichnos Glenmark와 ISB-2001 라이선스 계약",
    );
    expect(normalized).toContain("- RemeGen과 RC148 글로벌 라이선스");
    expect(normalized).toContain(
      "\n파이프라인은 R&D 비용 부담을 수반하지만 중장기 성장 동력입니다",
    );
    expect(normalized).not.toContain(
      "- 파이프라인은 R&D 비용 부담을 수반하지만 중장기 성장 동력입니다",
    );
  });

  it("formats follow-up question blocks as a section with bullets", () => {
    const normalized = normalizeResearchMarkdown(
      [
        "다음으로 파고들 질문",
        "",
        "Skyrizi와 Rinvoq의 분기별 매출 성장률은 어느 정도인가요?",
        "미용의학의 지역별 매출 비중은 공시상 확인 가능한가요?",
      ].join("\n"),
    );

    expect(normalized).toContain("### 다음으로 파고들 질문");
    expect(normalized).toContain(
      "- Skyrizi와 Rinvoq의 분기별 매출 성장률은 어느 정도인가요?",
    );
    expect(normalized).toContain(
      "- 미용의학의 지역별 매출 비중은 공시상 확인 가능한가요?",
    );
  });

  it("leaves existing markdown and fenced code intact", () => {
    const markdown = [
      "### 이미 있는 제목",
      "",
      "- 이미 있는 항목",
      "",
      "```text",
      "다음으로 파고들 질문",
      "```",
    ].join("\n");

    expect(normalizeResearchMarkdown(markdown)).toBe(markdown);
  });
});
