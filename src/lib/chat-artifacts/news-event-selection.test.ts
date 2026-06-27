import { describe, expect, it } from "vitest";
import { createAccumulator } from "@/lib/agent/stream-handler";
import type { AtomicNewsEventCard } from "@/types/api-contracts";
import {
  buildNewsEventDisplayText,
  buildNewsEventSelectionArtifact,
  buildNewsEventSelectionUserMessage,
} from "./news-event-selection";

describe("buildNewsEventSelectionArtifact", () => {
  it("builds a news event selection artifact from the latest Stock News event result", () => {
    const acc = createAccumulator();
    acc.toolCalls.push(
      {
        id: "tool-1",
        toolName: "route_news_question",
        argumentsJson: "{}",
        resultSummary: null,
        resultJson: { routed: true },
        resultText: null,
        startedAt: "2026-06-04T00:00:00.000Z",
        finishedAt: "2026-06-04T00:00:01.000Z",
        errorMessage: null,
      },
      {
        id: "tool-2",
        toolName: "search_company_news_events",
        argumentsJson: "{}",
        resultSummary: null,
        resultJson: {
          resolved_entities: [{ ticker: "GOOGL", company_name: "Alphabet" }],
          lookback: { days: 7 },
          atomic_events: [
            {
              event_id: "googl-capex-raise",
              ticker: "GOOGL",
              event_title_ko: "AI 인프라 투자 확대가 알파벳 주가 변수로 부각",
              headline: "Alphabet raises AI infrastructure spending plan",
              original_headline: "Alphabet plans AI infrastructure raise",
              summary_ko:
                "시장 뉴스는 알파벳의 AI 인프라 투자 확대가 현금흐름 부담과 Cloud 성장 기대를 동시에 키웠다고 다뤘습니다.",
              investment_axes: ["capex", "cloud"],
              key_facts: [
                { text: "$180B-$190B CapEx guide" },
                { fact: "Cloud demand exceeds supply" },
              ],
              source_previews: [
                {
                  publisher: "Reuters",
                  title_original: "Alphabet plans AI infrastructure raise",
                  url: "https://www.reuters.com/technology/alphabet-ai-capex/",
                  domain: "reuters.com",
                  published_at: "2026-06-01T21:11:00.000Z",
                },
              ],
              official_source_urls: ["https://abc.xyz/investor/"],
            },
          ],
        },
        resultText: null,
        startedAt: "2026-06-04T00:00:02.000Z",
        finishedAt: "2026-06-04T00:00:03.000Z",
        errorMessage: null,
      },
    );

    const artifact = buildNewsEventSelectionArtifact({
      acc,
      originalQuestion: "GOOGL 최근 AI 투자 뉴스를 공시 기준으로 분석해줘",
    });

    expect(artifact).toMatchObject({
      type: "news_event_selection",
      payload: {
        kind: "news_event_selection",
        version: 1,
        original_question: "GOOGL 최근 AI 투자 뉴스를 공시 기준으로 분석해줘",
        resolved_entities: [{ ticker: "GOOGL", company_name: "Alphabet" }],
        lookback: { days: 7 },
        discovery_summary: {
          event_count: 1,
          source_count: 1,
          has_official_candidates: true,
          has_major_news_candidates: false,
        },
      },
    });
    expect(artifact?.payload.events).toHaveLength(1);
    expect(artifact?.payload.events[0]).toMatchObject({
      id: "googl-capex-raise",
      ticker: "GOOGL",
      event_title: "AI 인프라 투자 확대가 알파벳 주가 변수로 부각",
      event_title_ko: "AI 인프라 투자 확대가 알파벳 주가 변수로 부각",
      original_headline: "Alphabet plans AI infrastructure raise",
      short_summary: expect.stringContaining("시장 뉴스"),
      primary_source: {
        publisher: "Reuters",
        domain: "reuters.com",
      },
      investment_axes: ["capex", "cloud"],
      source_previews: [
        {
          publisher: "Reuters",
          title_original: "Alphabet plans AI infrastructure raise",
          url: "https://www.reuters.com/technology/alphabet-ai-capex/",
        },
      ],
    });
    expect(artifact?.payload.raw_result).toMatchObject({
      atomic_events: [expect.objectContaining({ event_id: "googl-capex-raise" })],
    });
  });

  it("returns null when no event-bearing Stock News result exists", () => {
    const acc = createAccumulator();
    acc.toolCalls.push({
      id: "tool-1",
      toolName: "route_news_question",
      argumentsJson: "{}",
      resultSummary: null,
      resultJson: { routed: true },
      resultText: null,
      startedAt: "2026-06-04T00:00:00.000Z",
      finishedAt: "2026-06-04T00:00:01.000Z",
      errorMessage: null,
    });

    expect(
      buildNewsEventSelectionArtifact({
        acc,
        originalQuestion: "뉴스 찾아줘",
      }),
    ).toBeNull();
  });

  it("prefers market-news cards and removes filing or IR discovery candidates", () => {
    const acc = createAccumulator();
    acc.toolCalls.push({
      id: "tool-1",
      toolName: "search_company_news_events",
      argumentsJson: "{}",
      resultSummary: null,
      resultJson: {
        discovery_policy: {
          market_news_only: true,
        },
        cards: [
          {
            id: "aapl-demand-risk",
            ticker: "AAPL",
            company_name: "Apple",
            event_title_ko: "수요 둔화 우려가 AAPL 약세 요인으로 부각",
            summary_ko: "Reuters 등 시장 뉴스는 수요 둔화를 약세 내러티브로 다뤘습니다.",
            price_impact_direction: "negative",
            source_summary: {
              publishers_ko: ["Reuters", "Yahoo Finance"],
              source_count: 2,
              display_time_ko: "6월 4일 오후 9:00",
            },
            source_previews: [
              {
                publisher: "Reuters",
                title_original: "Apple shares fall on China demand concerns",
                title_ko: "Reuters 보도: 약세 요인 후보",
                url: "https://www.reuters.com/markets/apple-shares-fall/",
                domain: "reuters.com",
                summary_ko: "시장 뉴스 요약",
                source_kind: "market_news",
              },
            ],
            ontology_bridge_brief_en: {
              ticker: "AAPL",
              company_name: "Apple",
              event: "Market narrative: Apple shares fell on demand concerns.",
              likely_financial_axes: ["revenue", "gross_margin"],
              likely_business_axes: ["customer_demand"],
              suggested_ontology_questions: [
                "How has Apple disclosed China demand risk?",
              ],
              source_urls: ["https://www.reuters.com/markets/apple-shares-fall/"],
            },
            ui: {
              button_label_ko: "공시 기준으로 분석",
              badge_ko: "약세 요인",
            },
          },
          {
            id: "aapl-sec-filing",
            ticker: "AAPL",
            event_title_ko: "SEC Filings - Apple Investor Relations",
            summary_ko: "Form 8-K - SEC.gov",
            source_previews: [
              {
                publisher: "SEC",
                title_original: "Form 8-K - SEC.gov",
                url: "https://www.sec.gov/ixviewer/doc/action",
              },
            ],
          },
          {
            id: "aapl-generic-domain",
            ticker: "AAPL",
            event_title_ko: "최근 시장 반응이 AAPL 약세 요인으로 부각",
            summary_ko:
              "최근 tradingview.com 등 시장 뉴스는 이 이슈를 AAPL 약세 내러티브로 다뤘습니다. 공시 기준 분석에서는 매출과 마진을 확인합니다.",
            source_previews: [
              {
                publisher: "tradingview.com",
                title_ko: "tradingview.com 보도: 약세 요인 후보",
                title: "tradingview.com",
                domain: "tradingview.com",
              },
            ],
          },
        ],
      },
      resultText: null,
      startedAt: "2026-06-04T00:00:00.000Z",
      finishedAt: "2026-06-04T00:00:01.000Z",
      errorMessage: null,
    });

    const artifact = buildNewsEventSelectionArtifact({
      acc,
      originalQuestion: "AAPL 왜 떨어져?",
    });

    expect(artifact?.payload.discovery_policy).toMatchObject({
      market_news_only: true,
    });
    expect(artifact?.payload.events).toHaveLength(1);
    expect(artifact?.payload.cards).toHaveLength(1);
    expect(artifact?.payload.events[0]).toMatchObject({
      id: "aapl-demand-risk",
      event_title: "수요 둔화 우려가 AAPL 약세 요인으로 부각",
      event_title_ko: "수요 둔화 우려가 AAPL 약세 요인으로 부각",
      summary_ko: expect.stringContaining("시장 뉴스"),
      price_impact_direction: "negative",
      ontology_bridge_brief_en: {
        event: expect.stringContaining("Apple shares fell"),
      },
      ui: {
        button_label_ko: "공시 기준으로 분석",
      },
    });
    expect(
      artifact?.payload.events.some((event) =>
        event.event_title.includes("SEC Filings"),
      ),
    ).toBe(false);
  });

  it("treats English-heavy composer output as source-language fallback", () => {
    const event = {
      id: "aapl-intel-foxconn",
      ticker: "AAPL",
      event_title:
        "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
      event_title_ko:
        "AAPL 관련 시장 뉴스: Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
      summary_ko:
        "Intel is teaming up with Apple supplier Foxconn to develop artificial-intelligence infrastructure, but that was not enough to stop the chip manufacturer stock from sliding.",
      short_summary:
        "Intel is teaming up with Apple supplier Foxconn to develop artificial-intelligence infrastructure.",
      original_headline:
        "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
      price_impact_direction: "negative",
      source_previews: [
        {
          publisher: "Yahoo",
          domain: "finance.yahoo.com",
          title_original:
            "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
          title:
            "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
          snippet_summary:
            "Intel is teaming up with Apple supplier Foxconn to develop artificial-intelligence infrastructure.",
        },
      ],
    } satisfies AtomicNewsEventCard;

    const display = buildNewsEventDisplayText(event);

    expect(display).toMatchObject({
      title:
        "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
      originalHeadline:
        "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
      isSourceLanguageFallback: true,
    });
    expect(display.title).not.toContain("AAPL 관련 시장 뉴스");
    expect(display.summary).toContain("Intel is teaming up");

    const userMessage = buildNewsEventSelectionUserMessage(event);
    expect(userMessage).toContain(
      "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
    );
    expect(userMessage).not.toContain("AAPL 관련 시장 뉴스");
  });
});
