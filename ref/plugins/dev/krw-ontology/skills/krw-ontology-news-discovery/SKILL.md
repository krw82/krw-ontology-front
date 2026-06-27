---
name: krw-ontology-news-discovery
description: Use for first-pass recent/current market-news discovery about a ticker, company, or named market issue. Use Yahoo Finance MCP at runtime when available, write a compact Korean investor news brief, do not call KRW Ontology tools, and guide the next turn into company filing research or scenario sensitivity.
---

# KRW Ontology News Discovery Skill

This skill is only for first-pass market-news discovery. It answers what recent/current news appears relevant and why it may matter to investors, but it stops before filing-grounded revenue, margin, cash-flow, balance-sheet, valuation, or long-term thesis conclusions.

```text
market-news discovery -> Korean first-pass investor brief -> follow-up prompts into company research or scenario sensitivity
```

Do not call KRW Ontology tools in this skill.

## Operating Contract

Default visible output is a compact but complete Korean Markdown investor brief.

Use this rough shape when useful:

```text
첫 문단: 최근 뉴스 흐름을 한 문장으로 판단
직접 관련된 뉴스: 회사/티커에 직접 닿는 내용
같이 작용한 시장 맥락: 섹터/시장 전반 요인
투자자가 봐야 할 의미: 어떤 투자자 가정에 닿는지
아직 단정하면 안 되는 부분: 뉴스와 회사 실적/재무 영향 사이의 간격
이어서 볼 질문
```

If the search result has zero usable recent/news context after filtering, say that directly:

```text
최근 뉴스에서 확인할 만한 직접 이슈를 찾지 못했습니다. 더 구체적인 기업명이나 이슈를 넣어 다시 물어봐 주세요.
```

Do not write a long filing report, investment conclusion, valuation judgment, filing baseline, or card-selection UI. Do not write "분석이 필요하신 주제를 골라주세요", "선택해주세요", or "후보를 골라주세요".

## Source Priority

Discovery cards must be based on market-news, financial-news, or app-normalized provider results. Provider names and raw API payloads are internal implementation details, not visible card content.

Prefer:

```text
Yahoo Finance
Google News-like aggregated market results
Reuters
Bloomberg
CNBC
WSJ
MarketWatch
AP
Barron's
Financial Times
major financial portals and market-news sites
```

Never show these as user-facing discovery cards:

```text
SEC Filings
Form 8-K
Form 10-Q
Form 10-K
Investor Relations
company IR pages
annual reports
quarterly reports
old filing pages
standalone company press-release pages
```

Filings and IR are verification material for the later analysis step, not discovery cards.

## Tool Policy

Allowed tools:

```text
route_news_question
resolve_news_entities
search_company_news_events
search_market_news_events
build_news_timeline
audit_news_sources
```

Forbidden tools:

```text
read_news_sources
search_news_by_domain
krw_ontology_query_context
krw_ontology_query
krw_ontology_retrieve
krw_ontology_trace
krw_ontology_chain
krw_ontology_compare
```

For company/ticker questions, use the app-provided market/news card pipeline when available. If this skill is running with stock-news tools instead, call `search_company_news_events` with market-news discovery intent:

```json
{
  "mode": "market_narrative_discovery",
  "exclude_official_sources": true,
  "price_move_direction": "down | up | unknown"
}
```

Use `price_move_direction: "down"` for Korean/English wording such as:

```text
왜 떨어져, 왜 빠져, 하락, 조정, 급락, 약세, why down, why falling, stock drops
```

Use `price_move_direction: "up"` for:

```text
왜 올라, 상승, 급등, 강세, why up, rally, jumps, gains
```

Use `"unknown"` for neutral latest-news questions.

## Card Quality

Each card should describe a market narrative, not a raw page title.

Bad:

```text
SEC Filings - Apple Investor Relations
Form 8-K - SEC.gov
Apple shares rise after ...
```

Good:

```text
중국 경쟁과 아이폰 판매 둔화 우려가 AAPL 약세 요인으로 부각
AI 투자 부담과 서비스 성장 기대가 엇갈리며 밸류에이션 논쟁
```

Cards are market narrative candidates. Use cautious wording:

```text
시장 뉴스는 ... 요인으로 언급했습니다.
... 우려가 투자심리에 부담으로 부각됐습니다.
```

Do not state a news narrative as confirmed company fact.

## Required Hidden Brief

Every card must carry an internal English ontology bridge brief for the later filing-analysis step.

Required meaning:

```text
ticker
company_name
market narrative
source URLs
likely financial axes
likely business/risk axes
suggested ontology questions
```

If the card is generated from an app-normalized provider result, the hidden brief must also preserve:

```text
candidate explanation
source timing when available
whether the event appears company-specific, market-driven, sector-driven, mixed, or unknown
```

Do not expose the English brief in visible chat text.

## Final Output

End normal answers with:

```text
### 이어서 볼 질문
```

Include exactly 3 numbered Korean follow-up prompts. Use this role mix:

```text
1. one same-company continuation prompt about what to check next in revenue, margin, cash flow, balance sheet, dilution, capital allocation, risk factors, or company comments
2. one scenario-sensitivity prompt using plain Korean wording such as "상승·하락·횡보 시나리오별로 이 뉴스의 영향을 나눠줘" or "좋게 볼 때와 나쁘게 볼 때를 나눠줘"
3. one opposite-view prompt about why the news may be overreaction, incomplete evidence, or a thesis-break signal
```

Write for general retail investors. Avoid unexplained English finance acronyms, raw filing labels, valuation-model jargon, provider names as proof, and tool/plugin terminology.

Do not print JSON or Markdown cards yourself.
