# Desktop / Web Boundary

## Status

This is the target product architecture for KRW Ontology after the local worker
redesign.

The important decision is:

```text
Web app and Desktop app are separate products.

The server owns data, search, auth, entitlement, audit, release metadata,
news discovery, indicator snapshots, chat/session/artifact storage.

The user Mac owns local agent execution, local LLM connector, local MCP proxy,
device credentials, logs, and small ephemeral runtime state.
```

Desktop is not a hidden worker that claims Web chat jobs. Web chat must not
depend on whether the user's Desktop app is online. Desktop runs Desktop
sessions, not Web sessions.

## Why The Boundary Changed

The earlier queue-claim model treated the user's PC as a worker for Web app
runs:

```text
Browser asks question
  -> server enqueues agent_run
  -> user PC claims that Web run
  -> user PC executes answer
  -> Web browser waits for events/results
```

That model is too coupled for the product we want:

- Web UX becomes dependent on Desktop availability.
- Browser chat and Desktop chat share run semantics even though their runtime
  assumptions are different.
- Cancellation, retry, billing, support, and privacy become harder to explain.
- Queue ownership logic has to prove that the right user's device claimed the
  right Web run.
- The Desktop app starts looking like infrastructure for the Web app instead of
  a separate power-user product.

The corrected model is:

```text
Web app:
  Browser talks to Web API.
  Web API runs or orchestrates the Web analysis path server-side.

Desktop app:
  Desktop talks to Desktop API.
  Desktop runs local agent/LLM/MCP proxy for Desktop sessions only.
```

The two products share the same server data plane, but not the same execution
queue.

## Product Split

### Web App

The Web app is the browser product.

Responsibilities:

- User login through normal Web auth.
- Watchlist, company pages, public pages, chat UI.
- Server-side chat/session/artifact persistence.
- Server-side entitlement checks.
- Server-side news discovery and indicator access.
- Server-side ontology search access.
- Web-specific rate limits and budget reservations.
- SSE or polling for Web-visible run events.

The Web app may use server workers internally, but those workers are server
infrastructure. They are not user Desktop devices.

### Desktop App

The Desktop app is the local macOS product.

Responsibilities:

- Native macOS shell and local supervisor.
- Device login against the server.
- Secure storage of desktop access/refresh tokens.
- Local agent runner.
- Local LLM connector, using either user-provided API keys or a future server
  LLM proxy.
- Per-session or per-run local MCP proxy.
- Calls to `/api/desktop/*` with server-issued desktop device tokens.
- Local logs and diagnostics.
- Small in-memory caches during a run.

Desktop must not store:

- `SUPABASE_SERVICE_ROLE_KEY`.
- Server admin keys.
- Full ontology SQLite/index data.
- Large indicator DBs.
- Other users' data.
- Master data-provider keys such as Finnhub/Z.ai server keys.

### Server

The server is the source of truth.

Responsibilities:

- Web auth and Desktop device auth.
- Billing and entitlement checks.
- Desktop token issuance, refresh, revocation, and audit.
- Ontology data/index/release management.
- Ontology search API.
- News discovery pipeline.
- Indicator store and snapshots.
- Chat/session/artifact/citation storage.
- Rate limits and usage counters.
- Audit logs for Desktop ontology tool calls.

The server can internally use Supabase, local service processes, MCP sidecars,
or Python/FastAPI services. That is an implementation detail. The product
contract is that Desktop receives bounded search results through server APIs,
not raw index files.

## Target Architecture

```text
Browser Web Product
  -> Next.js web routes
  -> Web auth/session
  -> Web chat/session APIs
  -> Server-side ontology/news/indicator services
  -> Supabase/Postgres storage

macOS Desktop Product
  -> Swift/SwiftUI shell
  -> bundled local runtime
  -> local agent runner
  -> local LLM connector
  -> local MCP proxy
  -> /api/desktop/ontology/tool-call
  -> Server-side ontology search service
  -> Supabase/Postgres storage for auth, usage, audit
```

The Desktop MCP is a tool interface, not a data server:

```text
Local agent
  -> local MCP tool: krw_ontology_query_context
  -> local MCP proxy forwards request
  -> /api/desktop/ontology/tool-call
  -> server ontology service executes search
  -> compact evidence result returns to local agent
```

## Repository Roles

### `krw-ontology-front`

This repo owns the Web app and server APIs:

- Browser UI.
- Web chat APIs.
- Desktop device-auth APIs.
- Desktop ontology bridge APIs.
- Supabase schema/migrations and server-side data access.
- Server-side ontology catalog/search wrappers.
- Server deploy scripts.

Desktop-specific server APIs live under:

```text
src/app/api/desktop/*
src/lib/desktop/*
```

### `krw-local-worker`

This repo owns the macOS Desktop/local runtime:

- Native macOS shell.
- Bundled Node/runtime payload.
- Agent runner.
- Local MCP proxy.
- Runtime updater.
- Local diagnostics.
- Release packaging, signing, notarization, and update feed.

It should not carry a copy of the full ontology search index as a product
requirement.

### `krw-ontology`

This repo remains the ontology data/search implementation source:

- Ontology extraction and indexing.
- Release creation.
- Search engine internals.
- MCP implementation that can be wrapped server-side.

In the target product, its search/index output is deployed to server-controlled
infrastructure, not distributed wholesale to every user Mac.

## Auth Boundary

Desktop APIs must accept only Desktop credentials.

Accepted:

- Server-issued `desktop_access_token`.
- Explicit development token from `KRW_DESKTOP_DEV_TOKEN` in local/dev
  environments.

Rejected:

- Normal Web Supabase bearer tokens.
- Browser cookies/session tokens.
- Service role keys.
- Admin keys.

Current server code enforces this in:

```text
src/lib/desktop/auth.ts
```

The auth context is intentionally narrow:

```ts
authMethod: "desktop_access_token" | "dev_token";
```

There is no `"supabase_bearer"` Desktop auth method. If a user has a valid Web
session, they still have to complete the Desktop device login flow to receive
Desktop tokens.

## Desktop Device Login Flow

The Desktop app should use device-style login:

```text
1. Desktop calls POST /api/desktop/auth/device/start
2. Server creates a short-lived device code and user code.
3. Desktop opens the Web login/approval URL.
4. User signs into the Web app and approves the code.
5. Desktop polls POST /api/desktop/auth/device/poll.
6. Server returns desktop_access_token and desktop_refresh_token.
7. Desktop stores tokens in macOS secure storage.
```

After login:

```text
Desktop request
  Authorization: Bearer <desktop_access_token>
  -> /api/desktop/account
  -> /api/desktop/entitlement
  -> /api/desktop/ontology/health
  -> /api/desktop/ontology/tool-call
```

Refresh:

```text
POST /api/desktop/auth/refresh
  { device_id, desktop_refresh_token }
```

Logout/revoke:

```text
POST /api/desktop/auth/logout
```

## Desktop API Surface

The Desktop product talks to Desktop endpoints:

```text
POST /api/desktop/auth/device/start
POST /api/desktop/auth/device/poll
POST /api/desktop/auth/refresh
POST /api/desktop/auth/logout
GET  /api/desktop/account
GET  /api/desktop/entitlement
GET  /api/desktop/ontology/health
GET  /api/desktop/ontology/catalog
POST /api/desktop/ontology/tool-call
```

These endpoints are for Desktop sessions. They are not Web chat queue endpoints.

## Web API Surface

The Web product continues to use Web endpoints:

```text
/api/chat/*
/api/sessions/*
/api/watchlist/*
/api/share/*
/api/healthz/*
```

Web auth may use browser session cookies or normal Web bearer/session mechanics.
That does not imply access to `/api/desktop/*`.

## Ontology Tool Bridge

The Desktop ontology bridge is intentionally generic and Desktop-scoped:

```text
POST /api/desktop/ontology/tool-call
```

Example request:

```json
{
  "local_session_id": "desktop-session-123",
  "local_run_id": "desktop-run-456",
  "tool_call_id": "tool-call-789",
  "tool_name": "krw_ontology_query_context",
  "arguments": {
    "search_plan": {
      "question": "AAPL demand weakness and China exposure",
      "intent": "company_demand_exposure",
      "clauses": [
        {
          "clause_id": "demand_exposure",
          "retrieval_query": "AAPL China demand weakness affects revenue",
          "required_concepts": ["China demand weakness", "revenue"],
          "required_predicates": ["affects"],
          "required": true,
          "tickers": ["AAPL"],
          "directness": "direct_preferred",
          "object_types": ["ResearchClaim", "EvidenceQuote"],
          "metrics": [],
          "metric_dimensions": [],
          "metric_scope": "company_total",
          "calculation_window": null
        }
      ],
      "tickers": ["AAPL"],
      "document_types": [],
      "periods": [],
      "universe": null,
      "comparison_axes": [],
      "answer_scope": "direct",
      "uncertainty": "low",
      "limit_results": 12,
      "limit_tickers": 20
    }
  },
  "desktop_context": {
    "analysis_mode": "company"
  }
}
```

Example response:

```json
{
  "ok": true,
  "tool_call_id": "tool-call-789",
  "tool_name": "krw_ontology_query_context",
  "result_text": "contract_version: research-state/v2\n\nanswerability: answerable\n\nevidence_units: 1",
  "result_json": {
    "contract_version": "research-state/v2",
    "plan": {
      "question": "AAPL demand weakness and China exposure",
      "intent": "company_demand_exposure",
      "clauses": [
        {
          "clause_id": "demand_exposure",
          "retrieval_query": "AAPL China demand weakness affects revenue",
          "required_concepts": ["China demand weakness", "revenue"],
          "required_predicates": ["affects"],
          "required": true,
          "tickers": ["AAPL"],
          "directness": "direct_preferred",
          "object_types": ["ResearchClaim", "EvidenceQuote"],
          "metrics": [],
          "metric_dimensions": [],
          "metric_scope": "company_total",
          "calculation_window": null
        }
      ],
      "tickers": ["AAPL"],
      "document_types": [],
      "periods": [],
      "universe": null,
      "comparison_axes": [],
      "answer_scope": "direct",
      "uncertainty": "low",
      "limit_results": 12,
      "limit_tickers": 20
    },
    "resolved_scope": { "resolved_tickers": ["AAPL"] },
    "source_anchors": [],
    "answerability": { "status": "answerable" },
    "clause_coverage": [],
    "evidence_units": [],
    "computed_values": [],
    "calculation_coverage": [],
    "missing_parts": [],
    "recommended_actions": [],
    "continuation": null,
    "warnings": [],
    "executor": "mcp",
    "citations": []
  },
  "ontology_release": {
    "release_id": "release-2026-06-10",
    "api_version": "ontology-search/v2"
  },
  "usage": {
    "remaining_today": 499
  },
  "audit": {
    "server_tool_call_id": "audit-1",
    "latency_ms": 123
  }
}
```

The server must:

- Verify the Desktop access token.
- Verify the device is active.
- Verify entitlement.
- Apply rate limits and usage accounting.
- Validate the tool name and arguments.
- Enforce compact/bounded response policy.
- Execute server-side ontology search.
- Attach release metadata and citations.
- Record an audit row.

The Desktop app must:

- Treat the response as evidence, not as raw database access.
- Pass only bounded evidence to the local LLM.
- Surface auth/entitlement/rate-limit errors clearly.
- Redact tokens and user secrets from logs.

## Why Not Run Web Jobs On Desktop

Do not build this flow as the long-term product default:

```text
Browser question
  -> Web run queued
  -> Desktop claims run
  -> Desktop answers Web browser
```

Reasons:

- Web and Desktop availability become coupled.
- Web users get inconsistent behavior depending on local app state.
- Support has to debug both browser and local runtime for a single Web action.
- It is harder to explain where private evidence and prompts go.
- A future mobile/tablet Web user cannot rely on Desktop execution.
- Server-side Web reliability targets become hostage to consumer machines.

Desktop may still upload Desktop artifacts to the server so the user can view
history on the Web later. That is synchronization, not Web-run execution.

## LLM Privacy Boundary

When Desktop runs a local LLM connector, server-provided evidence can be sent to
the user's chosen model provider.

The product must disclose this clearly:

```text
Ontology evidence returned by KRW servers may be sent to the LLM provider you
configure in KRW Desktop.
```

Supported options can evolve:

- User-provided API key: best for power users, clear cost ownership.
- Local model: best privacy, more hardware/product constraints.
- Server LLM proxy: best UX, highest server cost and compliance burden.

The initial Desktop MVP should prefer user-provided API keys or a clearly
labeled server proxy path, but the API boundary should not require raw ontology
indexes on the user's Mac.

## Runtime Health Model

Desktop readiness is not local index readiness.

Correct Desktop health dimensions:

```json
{
  "local_runtime": {
    "agent_runner_ok": true,
    "llm_auth_ok": true,
    "mcp_proxy_ok": true,
    "network_ok": true
  },
  "remote_services": {
    "ontology_search_api_ok": true,
    "active_ontology_release_id": "release-2026-06-10",
    "ontology_api_version": "ontology-search/v2",
    "news_discovery_api_ok": true,
    "indicator_snapshot_api_ok": true
  }
}
```

Desktop readiness must not depend on:

- Local `agent_index.sqlite`.
- Local `global_spine.sqlite`.
- Local `manifest_path`.
- Local `index_path`.
- Local `sqliteOk`.

Those may exist in developer or server operations, but they are not Desktop
product requirements.

## Local Caching Policy

MVP:

- No persistent evidence cache.
- In-memory cache for the current Desktop run/session only.
- Clear memory cache when the run/session ends.

Future optional cache:

- Encrypted.
- TTL-bound.
- Size-bound, for example 100 MB.
- Cleared on logout.
- Never stores service-role keys or raw full index data.

Do not add persistent caches until the server audit, redaction, and logout
semantics are mature.

## Failure Modes

### Desktop Not Installed

Web app still works. Desktop-only buttons can invite install, but Web chat must
not require Desktop.

### Desktop Offline

Desktop sessions cannot run local agent work. Web sessions are unaffected.

### Server Ontology Search Down

Desktop can authenticate and show account state, but ontology tool calls fail
with a retryable service error. The Desktop UI should show "server ontology
connection unavailable", not "local index missing".

### LLM Key Missing

Desktop can log in and check server services, but cannot run local agent
sessions that require the local LLM connector.

### Desktop Token Expired

Desktop refreshes tokens. If refresh fails, it returns to device login.

### User Revokes Device

All Desktop APIs reject the old access token. Refresh also fails. The Desktop
app clears local credentials and returns to login.

## Security Requirements

Desktop token scope:

```text
desktop:account:read
desktop:entitlement:read
desktop:ontology:tool-call
desktop:ontology:catalog
desktop:device:logout
desktop:token:refresh
```

Desktop token must not grant:

```text
admin operations
arbitrary DB reads
service-role behavior
other-user data access
arbitrary raw ontology dumps
Web session impersonation
```

Server requirements:

- Hash Desktop access/refresh tokens at rest.
- Rotate refresh tokens.
- Revoke all device tokens on logout/revoke.
- Rate limit ontology tool calls.
- Audit tool call start, success, and failure.
- Validate all tool-call arguments.
- Bound response sizes.
- Avoid logging raw bearer tokens or LLM provider keys.

## Implementation Rules

Do:

- Keep `/api/desktop/*` isolated from browser session auth.
- Use `DesktopAuthContext` for Desktop API handlers.
- Use server-side ontology service wrappers for search.
- Keep Desktop responses compact and citation-friendly.
- Treat Desktop `local_session_id` and `local_run_id` as Desktop-local
  correlation IDs, not Web `agent_runs.id`.
- Add tests for auth rejection, entitlement, rate limits, and audit.

Do not:

- Reintroduce Supabase `auth.getUser(token)` fallback in Desktop auth.
- Put `SUPABASE_SERVICE_ROLE_KEY` in Desktop env or update payloads.
- Require full ontology index download for Desktop readiness.
- Make Web chat wait for Desktop app availability.
- Let Desktop claim arbitrary server/Web runs.
- Let Desktop call unscoped raw ontology search endpoints outside the Desktop
  entitlement/rate-limit/audit path.

## Current Code Anchors

Desktop auth:

```text
src/lib/desktop/auth.ts
src/lib/desktop/device-auth.ts
```

Desktop ontology bridge:

```text
src/app/api/desktop/ontology/tool-call/route.ts
src/lib/desktop/ontology-contracts.ts
src/lib/desktop/ontology-service.ts
src/lib/desktop/ontology-usage.ts
```

Desktop service checks:

```text
src/app/api/desktop/account/route.ts
src/app/api/desktop/entitlement/route.ts
src/app/api/desktop/ontology/health/route.ts
src/app/api/desktop/ontology/catalog/route.ts
```

Tests that must remain green when this boundary changes:

```text
src/lib/desktop/auth.test.ts
src/lib/desktop/device-auth.test.ts
src/lib/desktop/ontology-service.test.ts
src/app/api/desktop/**/route.test.ts
```

## Migration Notes

Old Mac worker operations may continue to exist as server/developer
infrastructure while the product transitions. That does not make those scripts
the Desktop product architecture.

When touching old worker code, classify it explicitly:

```text
server/internal worker
  allowed to use server credentials in controlled production infrastructure

user Desktop runtime
  never allowed to use server admin credentials or full raw data sync
```

If a command or script requires `SUPABASE_SERVICE_ROLE_KEY`, it is not suitable
for the shipped Desktop app.

## Acceptance Criteria

The boundary is correctly implemented when:

- `/api/desktop/*` rejects normal Web bearer tokens.
- `/api/desktop/*` accepts active server-issued Desktop access tokens.
- Web chat works without Desktop installed or running.
- Desktop can run local sessions using server ontology evidence.
- Desktop ontology tool calls are entitlement checked, rate limited, bounded,
  and audited.
- Desktop readiness checks remote ontology API health, not local SQLite files.
- No Desktop package contains service-role keys or full ontology indexes.
- User-facing privacy copy explains that evidence may be sent to the configured
  Desktop LLM provider.
