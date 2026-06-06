import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/news-discovery/stock-news-client", () => ({
  readNewsSources: vi.fn(),
}));

import { readNewsSources } from "@/lib/news-discovery/stock-news-client";
import { buildSelectedNewsSourcePack } from "./source-pack";

describe("buildSelectedNewsSourcePack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads selected preferred market-news sources and stores original reader text", async () => {
    vi.mocked(readNewsSources).mockResolvedValue({
      reads: [
        {
          url: "https://www.reuters.com/markets/mu-drop",
          ok: true,
          title: "Micron shares fall on HBM margin concerns",
          text: "Full Reuters reader text about HBM margin concerns and demand.",
          published_at: "2026-06-04T12:00:00.000Z",
        },
      ],
    });

    const pack = await buildSelectedNewsSourcePack({
      id: "mu-hbm-margin",
      ticker: "MU",
      company_name: "Micron Technology",
      event_title: "HBM 마진 우려가 MU 약세 요인으로 부각",
      event_title_ko: "HBM 마진 우려가 MU 약세 요인으로 부각",
      summary_ko:
        "시장 뉴스는 HBM 투자 부담과 단기 마진 우려를 MU 약세 요인으로 다뤘습니다.",
      primary_source: {
        url: "https://www.reuters.com/markets/mu-drop",
        publisher: "Reuters",
        domain: "reuters.com",
        title_original: "Micron shares fall on HBM margin concerns",
      },
      source_previews: [
        {
          url: "https://www.reuters.com/markets/mu-drop",
          publisher: "Reuters",
          domain: "reuters.com",
          title_original: "Micron shares fall on HBM margin concerns",
        },
      ],
      ontology_bridge_brief_en: {
        ticker: "MU",
        company_name: "Micron Technology",
        event: "MU shares fell on HBM margin concerns.",
        likely_financial_axes: ["gross_margin", "capex"],
        likely_business_axes: ["demand", "pricing"],
        suggested_ontology_questions: [
          "Check Micron filings for HBM margin and capex disclosures.",
        ],
        source_urls: ["https://www.reuters.com/markets/mu-drop"],
      },
    });

    expect(readNewsSources).toHaveBeenCalledWith({
      urls: ["https://www.reuters.com/markets/mu-drop"],
    });
    expect(pack).toMatchObject({
      version: "news-source-pack/v1",
      selected_event_id: "mu-hbm-margin",
      source_read_status: "read",
      source_urls: ["https://www.reuters.com/markets/mu-drop"],
    });
    expect(pack.original_text_for_ontology).toContain("Full Reuters reader text");
    expect(pack.ontology_search_brief_en).toContain("gross_margin");
    expect(pack.ontology_search_brief_en).toContain("Original reader text");
  });

  it("falls back to card source snippets when the reader is unavailable", async () => {
    vi.mocked(readNewsSources).mockRejectedValue(new Error("fetch failed"));

    const pack = await buildSelectedNewsSourcePack({
      id: "googl-capex",
      event_title: "AI 투자 부담 우려로 알파벳 약세",
      event_title_ko: "AI 투자 부담 우려로 알파벳 약세",
      summary_ko: "AI 투자 부담과 FCF 우려가 시장 뉴스에서 언급됐습니다.",
      source_previews: [
        {
          url: "https://www.cnbc.com/alphabet-ai-capex",
          publisher: "CNBC",
          domain: "cnbc.com",
          title_original: "Alphabet shares fall on AI capex concerns",
          snippet_summary: "CNBC snippet about AI capex concerns.",
        },
      ],
    });

    expect(pack.source_read_status).toBe("fallback");
    expect(pack.original_text_for_ontology).toContain("CNBC snippet");
    expect(pack.reads[0]).toMatchObject({
      url: "https://www.cnbc.com/alphabet-ai-capex",
      ok: false,
    });
  });
});
