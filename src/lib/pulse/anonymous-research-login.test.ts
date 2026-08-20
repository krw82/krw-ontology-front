import { describe, expect, it } from "vitest";
import { anonymousResearchLoginHref } from "./anonymous-research-login";

describe("anonymous research login href", () => {
  it("keeps the research intent in the post-login destination", () => {
    const href = anonymousResearchLoginHref({
      ticker: "MRVL",
      title: "마벨, 구글과 맞춤형 반도체 상업 계약 체결",
    });
    expect(href).toBeTruthy();
    if (!href) throw new Error("expected a login href");
    const next = new URL(href, "https://krwontology.com").searchParams.get("next");
    expect(next?.startsWith("/chat/new?")).toBe(true);
    const chatParams = new URLSearchParams(next!.slice("/chat/new?".length));
    expect(chatParams.get("ticker")).toBe("MRVL");
    expect(chatParams.get("query")).toBe(
      "MRVL 마벨, 구글과 맞춤형 반도체 상업 계약 체결의 투자 관점과 근거를 확인해줘",
    );
  });

  it("returns null without a ticker so the caller keeps its current-path fallback", () => {
    expect(anonymousResearchLoginHref({ ticker: null, title: "제목" })).toBeNull();
    expect(anonymousResearchLoginHref({ ticker: "", title: "제목" })).toBeNull();
  });
});
