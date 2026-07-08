# Guru MCP Tool Policy

Use the dedicated Guru MCP as a read-only ontology lens layer. It is separate from the KRW Ontology filing MCP.

## Default Workflow

```text
English-first private internal guru consultation brief
-> if company-specific: use app-provided company context when it already exists; do not call KRW Ontology filing MCP directly from the main Guru run
-> normalize company_context_json only from app-provided runtime context, without ticker hard-coding
-> krw_guru_query_context with English-first query text and company_context_json when available
-> optional krw_guru_trace or krw_guru_chain on selected reviewed_ids
-> if company-specific: krw_guru_company_brief with the same company_context_json
-> app-provided company_evidence_researcher subagent calls KRW Ontology company filing research
-> if company evidence is available: krw_guru_company_pack with the same company_context_json
-> answer
```

Use `krw_guru_search` only for fallback discovery or debugging. Do not use broad search after `krw_guru_query_context` returns a sufficient or partial pack.

The brief is private. Do not expose it to the user. Guru source materials are English-first, so the actual query text passed to Guru MCP should lead with the English internal investment brief and English retrieval terms. Korean original wording may be included only as secondary context.

All MCP usage is silent. Do not tell the user that you are calling tools, reading files, checking `research_status`, retrying JSON parameters, or waiting for a bridge. Tool outputs are internal materials for the final answer only.

## Tool Roles

```text
krw_guru_query_context
- Default first Guru MCP call after the English-first internal guru consultation brief. For company-specific questions, pass company_context_json only when the app runtime already supplied bounded company context. Returns ResearchPack, answerability, allowed next tools, selected lenses, source anchors, runtime mode, and company bridge needs.

krw_guru_company_brief
- Company-specific bridge. Converts selected guru lenses, data_needs, company_context_json, and company_bridge requirements into a KRW Ontology company filing research question. It does not retrieve company facts.

krw_guru_company_pack
- Optional post-company-evidence bridge. Combines the Guru ResearchPack, company_context_json, opaque company filing evidence supplied by the app-provided company_evidence_researcher subagent, missing evidence, judgment conditions, and render_plan. It does not call the company MCP itself.

krw_guru_trace
- Source support and bounded related objects for one selected ontology object.

krw_guru_chain
- Compact semantic neighbors around one selected ontology object.

krw_guru_search
- Fallback discovery only.

krw_guru_status
- Coverage and curation health only.

krw_guru_index_context
- Debug/capability/index health only. Not for normal answers. `krw_guru_query_context` is already shard-aware.

krw_guru_data_needs
- Compatibility bridge for filing evidence needs. Prefer the company_bridge section in query_context.
```

## Index And Shard Policy

The Guru MCP is optimized internally:

```text
reviewed JSONL = source of truth
author SQLite shards = read-optimized serving layer
guru_shard_manifest.json = lightweight global map
```

Skills must not read shard files directly. Always call `krw_guru_query_context` with the fixed `author_keys` for the selected skill. The MCP will use the author shard when available and fall back to reviewed JSONL if needed.

## Stop Rules

```text
sufficient_lens:
answer without broad follow-up

partial_lens:
answer narrowly; do not fill missing lenses from memory

needs_clarification:
ask the returned clarifying question before strong advice

needs_company_evidence:
call krw_guru_company_brief with company_context_json when available, let the app-provided company_evidence_researcher subagent obtain KRW Ontology filing evidence, then you must use krw_guru_company_pack before final writing when evidence is available

ontology_gap:
state that the current guru ontology did not return enough support
```

Trace or chain only selected reviewed_ids from the ResearchPack. Do not trace every candidate.

## Hard Boundary

The Guru MCP does not answer company facts, current financials, valuation, market prices, or latest filings. `company_context_json` is orientation only, not evidence. `krw_guru_company_brief` only prepares the company filing research brief. `krw_guru_company_pack` only combines already-supplied company evidence with guru lenses. The app-provided company_evidence_researcher subagent owns the actual KRW Ontology company filing MCP call.
