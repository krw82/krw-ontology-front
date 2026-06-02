# Evidence to Analyst Synthesis

This reference preserves the old skill's core discipline while keeping normal web-chat answers clean.

## Principle

KRW ontology evidence is not the final answer. It is the research state the analyst uses to write the final answer.

```text
MCP output = evidence workbench
AI agent = analyst judgment and final Korean explanation
Final answer = business interpretation grounded in filing evidence
```

Do not copy ontology internals into user-facing prose.

## Internal-only ontology knowledge

The agent may use these internally for evidence selection, reliability judgment, and caveat strength:

```text
ontology schema
ontology quality signals
artifact contracts
validation reports
rejected-object details
index internals
pipeline stages
registry/build details
MCP implementation details
```

Normal investor-facing answers must not mention those concepts. Convert them into analyst language about filing evidence strength, directness, uncertainty, and business meaning.

## Candidate route vs evidence

Projection and lookup tables are routing aids.

```text
metric_lookup
metric_dimension_lookup
company_dimension_catalog
exposure_lookup
agreement_lookup
event_lookup
factor_lookup
company_topic_index
object_search_text
```

These can identify likely objects, metrics, topics, or companies. They are not by themselves enough for strong claims.

Strong claims need at least one of:

```text
traced filing evidence
metric lineage
direct source object support
consistent cross-object support with caveat
```

## Translation rule

Convert internal evidence into analyst language.

```text
Internal: ExternalFactorExposure exists for input_cost_pressure.
User-facing: The company flags input-cost pressure as a margin risk.

Internal: directness = related_context.
User-facing: This supports a related pressure channel, not a directly quantified company impact.

Internal: specificity_score = 0.78.
User-facing: The disclosure is specific enough to support the direction of the risk, but not a precise quantified impact.

Internal: candidate route from company_topic_index.
User-facing: The company disclosures point to the topic as a recurring business issue.

Internal: validation or rejected-object details reduce confidence.
User-facing: The confirmed filing evidence is not strong enough to support that claim.

Internal: schema/artifact/index coverage does not expose a direct candidate.
User-facing: The available company disclosures do not directly support that point.
```

## Numeric evidence to investor language

Use numbers internally to judge magnitude, direction, and confidence. In normal answers, translate most numeric evidence into Korean investor language unless exact figures are necessary.

```text
subscription revenue growing 20%+ -> 구독 매출 고성장 유지
cost of revenue growing faster than revenue -> 매출총이익률 하방 압력
FCF remains strong despite investment -> 투자 확대에도 현금창출력 방어
M&A cash outflow rising -> 외부 역량 확보 병행
R&D or SBC rising -> 성장 재투자와 인재 확보 비용 증가
buyback rising with dilution language -> 희석 관리 성격의 자사주 매입
margin improving with revenue growth -> 영업 레버리지 개선
deferred revenue or RPO rising -> 향후 매출 가시성 강화
```

Do not turn a normal answer into a raw-number inventory. Use a small number of figures only when they change the conclusion, correct a misconception, or make the investment judgment more trustworthy.

When a table helps, prefer interpretation tables:

```text
분석 축 | 공시에서 보이는 신호 | 투자 해석
```

Avoid raw period-by-period numeric tables unless the user asks for exact figures or the comparison depends on the numbers.

## Explanation-and-notes-first investigation

For normal investor-facing analysis, read explanatory filing text and notes before raw metric extraction.

The priority is not "comments over numbers"; it is "explanatory filing context before raw numbers."

Prioritize:

```text
MD&A / management discussion
financial statement notes
segment notes and segment tables
revenue recognition notes
RPO / backlog discussion
SBC notes
acquisition notes
share repurchase notes
debt / liquidity notes
risk-factor updates
demand, pricing, cost, margin, cash-flow, and balance-sheet explanations
product, platform, AI, customer, or go-to-market descriptions
capital-allocation rationale
```

Then use key numbers to validate, size, or challenge the explanation.

```text
explanatory text/notes + numbers agree -> stronger conclusion
explanatory text/notes without numeric confirmation -> directional but not yet quantified
numbers move without explanatory text/notes -> avoid strong causal attribution
explanatory text/notes and numbers conflict -> key investor watchpoint
```

## Sector/global answers

For sector, macro, discovery, or multi-company basket questions, do not summarize object inventory.

Use this synthesis shape:

```text
1. conclusion
2. common macro signal
3. company-by-company evidence signal
4. financial channel
5. interpretation and caveat
```

Example:

```text
Bad:
COST has ExternalFactorExposure objects for trade_down and input cost pressure.

Good:
Costco's disclosures point to a value-oriented consumer and price investment strategy: demand can hold up, but gross margin can be pressured when the company absorbs part of input-cost inflation to preserve traffic.
```

## What to hide

Never expose these in normal answers:

```text
object type names
ontology layer names
specificity scores
directness labels
traceable/non-traceable labels
candidate route mechanics
lookup/index/table names
raw object IDs
tool routing
coverage diagnostics
ontology quality terms
schema or artifact terms
validation report details
rejected-object details
index internals
pipeline, registry, or build details
MCP implementation details
```

Use them only for debug, audit, raw evidence, structured handoff, or developer-facing output.
