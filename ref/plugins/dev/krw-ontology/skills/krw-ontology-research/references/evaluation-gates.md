# Evaluation Gates

Use these gates for web-chat quality checks and E2E harnesses.

## Normal answer gates

```text
Korean Markdown only
no internal terms
no mode/tool/pack names
no budget/fallback/error labels
no generic limitation heading
no FY as primary user-facing label
answers start from the most recent available filing unless the user explicitly asks for a historical period, long-term evolution, or a specific filing period
a newer 10-Q beats an older 10-K for current drivers, financial impact, cost structure, cash flow, risk, and management commentary
the latest 10-K is primary only when no newer 10-Q exists or when the question asks for annual baseline/full-year context
three follow-up questions present
strong claims traceable or metric-lineage grounded
direct vs related context separated
normal answers, comparison tables, and follow-up questions do not introduce non-covered companies or tickers unless explicitly requested by the user
normal answers are interpretation-first, not raw-number dumps
tables use interpretation columns unless exact numbers are requested or required for the conclusion
exact numbers are limited to the few figures needed to support, qualify, or correct the conclusion
material numbers are translated into business/investor meaning
MCP research uses an internal English investment brief that preserves user intent, tickers, periods, metrics, and comparison axes
the English investment brief is ontology/MCP-aware and optimized for evidence retrieval, not literal translation
final answers do not expose the internal English brief
```

## Financial statement interpretation gates

```text
P&L expenses, OCF/FCF calculation items, investing cash-flow items, and financing cash-flow items are separated
R&D is not added again as a post-FCF cash use
actual M&A cash spending uses acquisition cash-flow lines, not business-combination-related FCF addbacks
company-defined non-GAAP FCF is labeled separately from simple OCF minus capex
buybacks are not treated as pure shareholder return when disclosures describe dilution management
capital-allocation inflection claims compare prior annual periods before emphasizing the latest quarter
```

## Tool behavior gates

```text
query_context first
retrieve is legacy fallback only; do not use after sufficient query_context
trace/chain selected roots only; never brute-force every candidate
no repeated equivalent query
no broad full-response first pass
open tool result missing completed runs = 0
tool budget / fallback / retry wording visible to user = 0
overflow or oversized tool result becomes split-and-continue behavior, not a final-answer failure
```

## Latency and quality targets

```text
internal leak cases = 0
runtime setting leak cases = 0
budget/error/fallback/overflow wording cases = 0
B-grade cases <= 1 in 30Q smoke
```
