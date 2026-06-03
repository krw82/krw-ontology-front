# MCP Tool Policy

Use KRW ontology MCP tools as read-only evidence tools. Do not use raw JSONL or memory when indexed ontology evidence can answer or constrain the answer.

In this news skill, current web search happens before ontology research. KRW ontology tools are the second step: they explain the company-specific baseline, financial channel, accounting context, risk channel, and investment meaning of the current event.

## Tool roles

```text
web_search_prime
Default first current-event discovery call in news mode. Use it to find the latest relevant news, report, announcement, or post-filing update.

krw_ontology_query_context
Default first ontology call after current-event extraction. Returns research state, packs, answerability, and allowed next tools.

krw_ontology_query
Targeted structured follow-up for a specific metric, fact, object type, ticker, period, or explicit missing part.

krw_ontology_compare
Explicit comparison only when query_context does not provide enough comparison state or the user asks for a comparison table.

krw_ontology_trace
Evidence lineage for one selected object.

krw_ontology_chain
Business/semantic/temporal mechanism around one selected object.

krw_ontology_retrieve
Legacy fallback only. Do not use after sufficient query_context.

krw_ontology_company_context
Company orientation only when query_context lacks company-specific vocabulary or the user asks broad company profile context.

krw_ontology_index_context
Debug/capability/coverage only. Not for normal research.

krw_ontology_catalog
Inventory/coverage only.

krw_ontology_quality
Audit/validation/coverage only.
```

## Normal workflow

```text
web search -> current event extraction -> query_context -> optional targeted query/compare -> selected trace/chain -> fused Korean investor interpretation
```

Do not issue repeated equivalent queries. Do not use `full` response detail for broad first-pass exploration.

Never request `response_detail="full"` in normal web chat. Use compact or ticker-summary query output, then selected trace/chain when stronger verification is needed.

## Strong claim rule

Strong final claims require traceable direct evidence or metric lineage. Projection or topic candidates are routes, not final proof.
