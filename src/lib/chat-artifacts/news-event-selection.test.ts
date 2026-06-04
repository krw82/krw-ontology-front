import { describe, expect, it } from "vitest";
import { createAccumulator } from "@/lib/agent/stream-handler";
import { buildNewsEventSelectionArtifact } from "./news-event-selection";

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
              headline: "Alphabet raises AI infrastructure spending plan",
              summary: "CapEx guidance moved higher with cloud demand.",
              investment_axes: ["capex", "cloud"],
              key_facts: [
                { text: "$180B-$190B CapEx guide" },
                { fact: "Cloud demand exceeds supply" },
              ],
              source_previews: [
                {
                  publisher: "Reuters",
                  title: "Alphabet plans AI infrastructure raise",
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
      event_title: "Alphabet raises AI infrastructure spending plan",
      short_summary: "CapEx guidance moved higher with cloud demand.",
      investment_axes: ["capex", "cloud"],
      source_previews: [
        {
          publisher: "Reuters",
          title: "Alphabet plans AI infrastructure raise",
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
});
