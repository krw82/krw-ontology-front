# KRW Agent Front Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Do not run live DeepSeek calls. Stop at each rollout gate and let the operator run the listed commands.

**Goal:** Keep `krw-ontology-front` as the multi-user product and chat-room source of truth while moving every new chat room to the `krw-agent` harness for research execution, same-room follow-up memory, skills/MCP use, and terminal answer delivery. Existing rooms are closed for new input and retained only as read-only historical records until the product owner removes them.

**Architecture:** The browser talks only to the existing Next.js API and product database. The server authenticates the user, persists the user message, assigns a sticky backend to the chat room, and submits a frozen run to `krw-agent` through the pinned `@krw-agent/host` contract. The Rust worker owns planning, session-memory reconstruction, skills, MCP calls, model selection, and final answer generation. A persistent outbox worker projects authoritative terminal results back into the existing `messages`, `agent_runs`, and `agent_run_events` tables. A deterministic market-snapshot MCP materializes already-operated valuation data without adding another model decision.

**Tech Stack:** Next.js/TypeScript, Supabase/Postgres, `pg`, esbuild workers, Rust `krw-agent`, Anthropic Messages-compatible GLM/DeepSeek providers, MCP over HTTP.

**Implementation checkpoint (2026-08-12):** The direct new-room route, closed-room
cutover, v7 enqueue compatibility wrapper, durable outbox projection, pinned host
archive, and deployment service are implemented on the cutover branches. The
operator still owns migration application, the compatibility gate, and GLM-only
quality verification; no live provider call is made by this implementation pass.

---

## 0. Non-negotiable boundaries

- [ ] Change only `~/krw-ontology-front` plus the deployment binding/artifact handoff in `~/krw-agnet` when the front endpoint must be registered.
- [ ] Do not modify `~/krw-ontology` or any ontology schema.
- [ ] Do not copy ontology data into a new product-owned research memory. Follow-up context is the same `chat_sessions.id`, resolved by the agent worker after it claims the run.
- [ ] Keep `auth.users.id -> principal_id`, `chat_sessions.id -> session_id`, and `agent_runs.id -> daemon run_id` exact. Use one deployment-scoped `tenant_id`; never use the member ID as tenant ID.
- [ ] Never accept ownership IDs, release hashes, capability lists, model profiles, session memory, or canonical prior answers from browser JSON.
- [ ] Persist `rust_agent` on every new chat room. Never switch a room's execution backend midway through a conversation.
- [ ] Treat `krw-agent` as execution authority and the product DB as UI/billing authority. Do not create a second chat sidebar or message history in the agent runtime.
- [ ] Keep model/tool/reasoning budgets unchanged. Performance work in this plan removes builds, duplicate context reads, duplicate projections, and unnecessary process startup only.
- [ ] Real provider quality tests use GLM only. DeepSeek receives contract/unit tests and production configuration validation, but no live test call.
- [ ] There is no canary percentage, legacy fallback, or rollback route in this cutover. If the new Rust runtime is not ready, the question is still persisted and receives a bounded assistant status message; it never silently sends the question to Claude.
- [ ] Once the API accepts a run and creates an assistant placeholder, every terminal path must end with a completed assistant row: normal answer, cancelled answer, or clearly labelled degraded answer.

## 1. Target request flow

```text
Browser
  -> POST /api/chat/run
  -> authenticate + resolve owned chat room
  -> persist user message idempotently
  -> new room (rust_agent only):
          -> load pinned release descriptor from process singleton
          -> prepareEnqueueRun(question + trusted context)
          -> public.enqueue_agent_v1_product_run_v7(jsonb)
          -> agent_v1 queue
          -> Rust worker claims run and rebuilds same-session memory
          -> company ontology map -> planner -> skills/MCP -> answer
          -> agent_v1 outbox
          -> persistent front outbox worker
          -> authoritative final read + atomic public projection RPC
          -> messages/agent_runs/agent_run_events
          -> existing SSE/reconnect UI
```

Existing rooms are marked `closed_at` during the cutover migration and cannot accept another user message. They are omitted from the active chat list but remain readable until an explicit data-retention job removes them. The company ontology map remains the first research preflight inside `krw-agent`. The front supplies only trusted scope such as the selected ticker and product run kind; it does not choose document sections or individual research tools for the model.

---

### Task 1: Pin the canonical host package and add a compatibility gate

**Files:**

- Modify: `~/krw-agnet/packages/host-ts/package.json`
- Create: `~/krw-agnet/packages/host-ts/tsconfig.build.json`
- Create: `~/krw-agnet/scripts/package-host-ts.mjs`
- Create: `~/krw-ontology-front/vendor/krw-agent-host/README.md`
- Modify: `~/krw-ontology-front/package.json`
- Modify: `~/krw-ontology-front/package-lock.json`
- Create: `~/krw-ontology-front/scripts/verify-agent-v1-compatibility.mjs`
- Create: `~/krw-ontology-front/src/lib/agent-v1/compatibility.test.ts`

- [ ] **Step 1: Write the failing compatibility tests.**

  Test exact accepted values, not ranges:

  ```ts
  expect(report).toMatchObject({
    abiVersion: 1,
    protocolVersion: 7,
    immutableClaimVersion: 7,
    releaseDescriptorVersion: 3,
    sessionMemoryVersion: 3,
  });
  expect(report.models.sort()).toEqual(["deepseek-v4-flash", "glm-5.2"]);
  ```

  Add rejection cases for a missing migration, hash mismatch, claim v3, an unpinned package archive, and an unknown physical model.

- [ ] **Step 2: Build a real distributable host archive.**

  Change `@krw-agent/host` from TypeScript-source-only exports to built ESM plus `.d.ts` exports. `package-host-ts.mjs` must run the package build, run `npm pack`, calculate SHA-256, and emit a small manifest containing archive name, package version, package hash, protocol version, and claim version. No runtime network fetch is allowed.

- [ ] **Step 3: Vendor and pin the archive in the front.**

  Use a checked-in or release-injected archive under `vendor/krw-agent-host/`, pin it with a `file:` dependency in `package.json`, and commit the resulting lockfile integrity. Do not depend on `file:../krw-agnet`; sibling paths are not reproducible in CI or deployment images.

- [ ] **Step 4: Replace the structural claim encoder.**

  The front composition root must import canonical `prepareEnqueueRun`, `prepareCancelRun`, `loadPinnedReleaseArtifact`, `HostAgentClient`, `createProjectionAuthorityResolver`, and `createProductProjectionHandlers` from `@krw-agent/host`. Remove the local assumption that the package exposes `buildEnqueueRunRequest`; the canonical public API is the only encoder.

- [ ] **Step 5: Add the deployment preflight.**

  `verify-agent-v1-compatibility.mjs` must validate, in one bounded DB connection:

  - `agent_store.schema_migrations` contains every required version through `16`;
  - `agent_v1.enqueue_run(jsonb)`, `request_cancel(jsonb)`, `read_committed_outcome(jsonb)`, `claim_outbox(jsonb)`, and `ack_outbox(jsonb)` exist;
  - the pinned descriptor is canonical, readable, non-symlinked, and matches the configured artifact/release hashes;
  - the selected route model is exactly `glm-5.2` or `deepseek-v4-flash`;
  - the product projection function exists before Rust routing can be enabled.

  Print hashes and versions only. Never print descriptor contents, endpoints, credentials, or local secret paths.

- [ ] **Step 6: Wire the gate before deployment, not per request.**

  Add `agent-v1:compat:verify` to `package.json` and call it from the production release gate. Load the validated descriptor once at process boot and cache the parsed immutable value. Do not re-read or re-hash it for every question.

- [ ] **Operator verification (not run by the implementation agent):**

  ```bash
  npm run test:unit -- src/lib/agent-v1/compatibility.test.ts
  npm run agent-v1:compat:verify
  ```

**Completion criterion:** A bad DB version, descriptor, model, or package hash prevents enabling Rust rooms before traffic arrives; valid pinned artifacts add no per-question filesystem work.

---

### Task 2: Upgrade the DB contract with forward-only migrations

**Files:**

- Create: `~/krw-ontology-front/supabase/migrations/20260812090000_agent_v1_contract_v7_compatibility.sql`
- Create: `~/krw-ontology-front/supabase/migrations/20260812090100_chat_session_agent_backend.sql`
- Create: `~/krw-ontology-front/supabase/tests/agent_v1_contract_v7_compatibility.test.sql`
- Modify: `~/krw-ontology-front/src/types/api-contracts.ts`
- Modify: `~/krw-ontology-front/src/types/database.ts`

- [ ] **Step 1: Write DB regression tests first.**

  Cover claim v7, exact two-model acceptance, all seven outbox kinds, closed-room backfill, Rust session stickiness, cross-user rejection, and idempotent enqueue replay.

- [ ] **Step 2: Add only new migrations.**

  Do not edit `20260802225400_agent_v1_abi.sql` or `20260802230000_agent_v1_product_projection.sql`. The new compatibility migration replaces affected functions/constraints after checking that agent runtime migrations `0001` through `0016` have been applied by the `krw-agent` release process.

- [ ] **Step 3: Correct the stale product contract.**

  Update the enqueue wrapper to require immutable claim schema `7`, and accept only:

  ```sql
  v_model in ('glm-5.2', 'deepseek-v4-flash')
  ```

  Expand the receipt event constraint to:

  ```sql
  ('answer.committed', 'answer.presentation', 'answer.billing',
   'answer.notification', 'run.cancelled', 'run.failed', 'run.deferred')
  ```

  Add constraints through catalog-checked `DO` blocks because Postgres has no `ADD CONSTRAINT IF NOT EXISTS`.

- [ ] **Step 4: Make the cutover direct, not percentage based.**

  Add `agent_backend` and `closed_at`:

  ```sql
  alter table public.chat_sessions
    add column if not exists agent_backend text,
    add column if not exists closed_at timestamptz;

  update public.chat_sessions
     set agent_backend = 'rust_agent',
         closed_at = coalesce(closed_at, clock_timestamp())
   where agent_backend is null;

  alter table public.chat_sessions
    alter column agent_backend set default 'rust_agent',
    alter column agent_backend set not null;
  ```

  Add a checked constraint for exactly `rust_agent`. Existing rows are closed by the same migration; new rows have `closed_at is null`. Backend changes are rejected after insert.

- [ ] **Step 5: Add indexes matching real access paths.**

  Use equality columns first and range/order columns last:

  ```sql
  create index concurrently if not exists idx_chat_sessions_user_backend_updated
    on public.chat_sessions (user_id, agent_backend, updated_at desc)
    where deleted_at is null;

  create index concurrently if not exists idx_agent_v1_mapping_session_created
    on public.agent_v1_product_run_mappings (session_id, created_at desc);

  create index concurrently if not exists idx_agent_v1_receipts_run_outbox
    on public.agent_v1_product_outbox_receipts (run_id, outbox_id);
  ```

  If the migration runner wraps all files in one transaction, split `CREATE INDEX CONCURRENTLY` into its supported non-transactional migration form. Do not silently downgrade production indexes to blocking table-wide creation.

- [ ] **Step 6: Apply least privilege.**

  Enable RLS on internal mapping/receipt tables, revoke direct access from `public`, `anon`, and `authenticated`, and grant execute on fixed `SECURITY DEFINER` wrappers to `service_role` only. Every definer function must set a fixed `search_path` and verify `user_id`, `session_id`, and `run_id` together.

- [ ] **Step 7: Update generated/manual types.**

  Add `agentBackend: "rust_agent"` and `closedAt: string | null` to the resolved room type and allow `AgentRunExecutorType = "rust_agent"` for new product runs.

- [ ] **Operator verification:**

  ```bash
  supabase db reset
  npm run test:unit -- src/lib/agent-v1
  npm run typecheck
  ```

**Completion criterion:** A claim v7 GLM or DeepSeek request can be enqueued atomically, all current outbox event types are representable, old rooms are closed for new input, and no member can access another member's mapping rows or change a new room's backend.

---

### Task 3: Build one server-only agent composition root

**Files:**

- Create: `~/krw-ontology-front/src/lib/agent-v1/runtime.ts`
- Create: `~/krw-ontology-front/src/lib/agent-v1/runtime.test.ts`
- Modify: `~/krw-ontology-front/src/lib/agent-v1/product-host.ts`
- Modify: `~/krw-ontology-front/src/lib/agent-v1/postgres-transport.ts`
- Modify: `~/krw-ontology-front/.env.example`

- [ ] **Step 1: Define a minimal product-facing interface.**

  ```ts
  export interface AgentV1Runtime {
    enqueue(input: {
      runId: string;
      requestId: string;
      userId: string;
      sessionId: string;
      userMessageId: string;
      runKind: SupportedAgentRunKind;
      locale: string;
      question: string;
      context: TrustedProductContext;
    }): Promise<{ runId: string; assistantMessageId: string; queuedAt: string }>;

    cancel(input: {
      runId: string;
      userId: string;
      sessionId: string;
      reasonCode: "user_cancelled";
    }): Promise<AgentV1CancelResult>;
  }
  ```

  `TrustedProductContext` contains only server-derived scope: `scope_type`, normalized `tickers`, bounded document types, optional trusted filing ID, and optional source-run selection. It contains no tools, capabilities, model profile, prompt, session memory, or release hashes.

- [ ] **Step 2: Create the process singleton.**

  At first import, validate required environment variables, load the pinned descriptor once, create one bounded `pg.Pool`, and construct the canonical host. Reuse the pool and release object for every request. Set connection timeout, idle timeout, max lifetime, and a small max pool size appropriate to the web instance; never create a DB client per request.

- [ ] **Step 3: Make provider switching descriptor-driven.**

  The front does not branch on GLM versus DeepSeek. Deployment chooses the pinned route in the release descriptor:

  ```text
  KRW_AGENT_RELEASE_DESCRIPTOR_PATH
  KRW_AGENT_RELEASE_ARTIFACT_HASH
  KRW_AGENT_RELEASE_SET_HASH
  KRW_AGENT_TENANT_ID
  AGENT_V1_DATABASE_URL
  ```

  GLM test descriptor resolves `glm-5.2`; production descriptor resolves `deepseek-v4-flash`. Changing provider means rotating the descriptor and restarting the process, not editing route code or accepting a browser model field.

- [ ] **Step 4: Ensure enqueue is retry-safe.**

  Generate `run_id`, `mutation_id`, and `request_id` once on the server. Prepare the exact canonical request once and retry those same bytes only. A network timeout after DB commit must replay to `already_enqueued`, not create another message or another budget reservation.

- [ ] **Step 5: Reject invalid trusted context before DB work.**

  Normalize tickers once; bound counts and string lengths; require one trusted ticker for the first signed Rust contexts. Reject URL, uploaded-document, market-issue, and wide-research shapes until their signed contracts exist.

- [ ] **Operator verification:**

  ```bash
  npm run test:unit -- src/lib/agent-v1/runtime.test.ts src/lib/agent-v1/product-host.test.ts
  ```

**Completion criterion:** All Rust enqueue/cancel calls pass through one cached, pinned, server-only runtime and the API cannot override the model or agent behavior.

---

### Task 4: Close old rooms and make every new room Rust-owned

**Files:**

- Modify: `~/krw-ontology-front/src/lib/api/chat/resolve-session.ts`
- Modify: `~/krw-ontology-front/src/app/api/chat/run/route.ts`
- Modify: `~/krw-ontology-front/src/app/api/sessions/route.ts`
- Modify: `~/krw-ontology-front/src/app/api/sessions/[sessionId]/route.ts`
- Modify the existing room-creation helper extracted from: `~/krw-ontology-front/src/app/api/chat/run/route.ts`
- Create: `~/krw-ontology-front/src/lib/chat/session-lifecycle.test.ts`

- [ ] **Step 1: Test the direct cutover policy.**

  Test that every newly inserted room has `agent_backend='rust_agent'`, every pre-cutover room with `closed_at` rejects a send with `410 chat_session_closed`, closed rooms are absent from the active list, and a configuration change cannot reopen a room.

- [ ] **Step 2: Implement server-side assignment.**

  ```ts
  const NEW_SESSION_BACKEND = "rust_agent" as const;
  ```

  Persist this value in the same room insert that creates the session. Do not calculate a percentage or consult the browser for an executor choice.

- [ ] **Step 3: Extend session resolution.**

  Select `agent_backend` and `closed_at` with the existing ownership check. If `closed_at` is non-null, return a typed `chat_session_closed` result before rate limits, budget reservations, message writes, or model work.

- [ ] **Step 4: Add one cutover configuration.**

  ```text
  KRW_AGENT_BACKEND_MODE=rust
  KRW_AGENT_TENANT_ID=<deployment-scoped-id>
  ```

  Invalid or missing settings fail deployment preflight. There is no legacy fallback.

- [ ] **Step 5: Close existing rooms.**

  Backfill all current rooms with `closed_at = clock_timestamp()` and hide them from the active room list. A send request against a closed room returns `410 chat_session_closed`; it never queues a legacy run. Existing messages remain read-only until the explicit retention purge.

- [ ] **Operator verification:**

  ```bash
  npm run test:unit -- src/lib/chat/session-lifecycle.test.ts src/lib/api/chat/resolve-session.test.ts
  ```

**Completion criterion:** Concurrent users and multiple new chat rooms are isolated, follow-ups retain the Rust room identity, and closed historical rooms cannot create new runs.

---

### Task 5: Persist the user message and dispatch directly to Rust

**Files:**

- Modify: `~/krw-ontology-front/src/lib/api/chat/fetch-history.ts`
- Create: `~/krw-ontology-front/src/lib/api/chat/persist-user-message.test.ts`
- Create: `~/krw-ontology-front/src/lib/agent-dispatch/enqueue.ts`
- Create: `~/krw-ontology-front/src/lib/agent-dispatch/enqueue.test.ts`
- Modify: `~/krw-ontology-front/src/app/api/chat/run/route.ts`

- [ ] **Step 1: Split the current combined helper.**

  Export:

  ```ts
  persistUserMessage(sessionId, content, requestId, metadata)
  fetchLegacyPromptHistory(sessionId, excludedMessageId)
  ```

  The Rust backend persists the user message and sends `session_memory: null`; the owned worker rebuilds same-session memory after claim/fence. The old Claude history path is no longer reachable from the new chat route.

- [ ] **Step 2: Introduce a dispatcher with two adapters.**

  ```ts
  dispatchChatRun({ backend, authenticatedRun, trustedContext })
  ```

  The only production adapter is `rust_agent`, which calls the Task 3 runtime. The old Claude adapter is not reachable from the new chat route. Keep the API response contract identical so the current client/SSE code does not need a new branch.

- [ ] **Step 3: Remove the legacy MCP readiness gate from the Rust route.**

  The current legacy readiness checks must not run before a Rust enqueue. The Rust runtime performs its own signed capability preflight and treats optional capability unavailability as data, not an API rejection.

- [ ] **Step 4: Preserve reservation semantics.**

  Keep rate-limit, execution-budget, and credit reservation before enqueue. On a hard pre-enqueue validation error, release them. On an ambiguous transport error, do not immediately release; retry the same prepared request and reconcile by `request_id` to avoid a committed run with released credits.

- [ ] **Step 5: Keep unsupported context shapes explicit.**

  Route every supported new room through Rust. If a question shape (wide research, uploaded document, URL, or market issue) has no signed agent context contract yet, return a bounded validation response before creating a run; do not route it to a legacy executor.

- [ ] **Step 6: Add failure-injection tests.**

  Cover DB timeout before commit, timeout after commit, duplicate HTTP retry, user-message duplicate request ID, Rust unavailable, and optional MCP unavailable. Optional MCP unavailability must still return an accepted run; hard enqueue failure must not leave a pending assistant placeholder. A missing mandatory Rust contract returns a deterministic 503 before the assistant placeholder is inserted.

- [ ] **Operator verification:**

  ```bash
  npm run test:unit -- src/lib/api/chat/persist-user-message.test.ts src/lib/agent-dispatch/enqueue.test.ts
  ```

**Completion criterion:** A Rust question performs one user-message write and one atomic enqueue, skips duplicate legacy history/MCP work, and presents the same frontend run contract as before.

---

### Task 6: Implement authoritative outbox projection and the terminal-answer invariant

**Files:**

- Create: `~/krw-ontology-front/supabase/migrations/20260812090200_agent_v1_product_outbox_projection.sql`
- Create: `~/krw-ontology-front/supabase/tests/agent_v1_product_outbox_projection.test.sql`
- Modify: `~/krw-ontology-front/src/lib/agent-v1/product-outbox.ts`
- Create: `~/krw-ontology-front/src/lib/agent-v1/product-projection.ts`
- Create: `~/krw-ontology-front/src/lib/agent-v1/product-projection.test.ts`
- Modify: `~/krw-ontology-front/src/worker/agent-v1-outbox-worker.ts`
- Modify: `~/krw-ontology-front/package.json`

- [ ] **Step 1: Test every event and replay first.**

  For all seven event kinds, test first delivery, exact replay, altered-payload replay, wrong owner, stale fence, out-of-order presentation/billing/notification, worker crash after product commit but before agent ack, and two workers racing on the same outbox event.

- [ ] **Step 2: Do not trust raw outbox payload as final content.**

  For `answer.committed`, use the canonical host authority resolver to read the final projection from `agent_v1` by exact tenant/principal/session/run ownership and verify final/bundle/IR hashes. The event is a notification and hash claim; it is not the Markdown source.

- [ ] **Step 3: Add one fixed product projection RPC.**

  Create `public.apply_agent_v1_product_outbox(jsonb)`. It accepts only the already-validated product outbox event, then in one short transaction:

  - lock the one mapping and one `agent_runs` row in a fixed order;
  - validate run/session/user ownership, event hash, version, cancel generation, and fencing token;
  - insert the dedupe receipt with `ON CONFLICT` semantics;
  - update the existing assistant message;
  - update the run status/usage and mapping terminal fields;
  - append the corresponding `agent_run_events` row;
  - settle or release execution budget and analysis credit exactly once;
  - return `applied` or `already_applied`.

  Do no model call, network fetch, or large agent-DB read inside this transaction.

- [ ] **Step 4: Define terminal user messages explicitly.**

  - `answer.committed`: verified final Markdown, status `completed`.
  - `run.cancelled`: “요청에 따라 리서치를 중단했습니다.”, status `completed`, metadata `answer_status=cancelled`.
  - `run.failed`: a bounded Korean degraded answer explaining which stage failed and what evidence was retained, status `completed`, metadata `answer_status=degraded`; never expose stack traces, paths, prompts, or secrets.
  - `run.deferred`: non-terminal activity update only; keep the placeholder pending.
  - presentation/billing/notification events update their own idempotent projection fields and cannot overwrite committed answer content.

- [ ] **Step 5: Complete the persistent worker.**

  Build `src/worker/agent-v1-outbox-worker.ts` to `.worker/agent-v1-outbox-worker.mjs`; add `start:agent-v1-outbox` and a development command. Reuse one pool, claim bounded batches, use bounded concurrency, and let lease expiry replay an event after a crash. A successful product commit followed by ack failure is safe because the receipt makes replay a no-op.

- [ ] **Step 6: Add a terminal watchdog.**

  A periodic bounded reconciliation query finds Rust runs whose agent state is terminal but whose product assistant message is still pending beyond a threshold. It replays the authoritative projection; if authoritative read itself is permanently unavailable after the retry window, it commits the degraded terminal message and releases product reservations. It never fabricates research claims.

- [ ] **Operator verification:**

  ```bash
  npm run test:unit -- src/lib/agent-v1/product-outbox.test.ts src/lib/agent-v1/product-projection.test.ts
  node .worker/agent-v1-outbox-worker.mjs --once
  ```

**Completion criterion:** Killing the worker at any point and restarting it yields exactly one visible terminal assistant message and exactly one budget settlement.

---

### Task 7: Branch cancellation correctly and reuse reconnect/SSE projection

**Files:**

- Modify: `~/krw-ontology-front/src/app/api/chat/run/cancel/route.ts`
- Modify: `~/krw-ontology-front/src/app/api/chat/[sessionId]/cancel/route.ts`
- Modify: `~/krw-ontology-front/src/lib/agent/run-events.ts`
- Create: `~/krw-ontology-front/src/lib/agent-v1/cancel-routing.test.ts`
- Create: `~/krw-ontology-front/src/lib/agent-v1/reconnect.test.ts`

- [ ] **Step 1: Resolve executor ownership before cancelling.**

  Read the owned `agent_runs` row once and call canonical `prepareCancelRun` through the Task 3 runtime. Browser JSON supplies only the run/session identity already cross-checked against authenticated ownership.

- [ ] **Step 2: Make cancel retries idempotent.**

  Return a successful product response for `cancelled`, `already_cancelled`, `already_final`, and `already_failed`. The outbox remains responsible for the visible terminal message and final credit release.

- [ ] **Step 3: Keep existing SSE/reconnect endpoints.**

  Rust results are projected into the same `agent_run_events` and `messages` tables, so the browser should not learn agent-v1 protocols. Update event derivation so a failed engine run with a completed degraded assistant message emits `done`, not an endless generic error. `run.deferred` emits activity only.

- [ ] **Step 4: Test refresh and multi-tab behavior.**

  Cover browser refresh during queued/running/final states, two tabs reconnecting, cancel from a second tab, dropped SSE followed by polling, and a projection committed before the client reconnects.

- [ ] **Operator verification:**

  ```bash
  npm run test:unit -- src/lib/agent-v1/cancel-routing.test.ts src/lib/agent-v1/reconnect.test.ts
  ```

**Completion criterion:** Refreshing, reconnecting, or cancelling a Rust room behaves exactly like the existing product experience without exposing engine-specific client logic.

---

### Task 8: Materialize operated valuation data as a soft-fail market MCP

**Files:**

- Create: `~/krw-ontology-front/src/company-data-mcp/market-snapshot-reader.ts`
- Create: `~/krw-ontology-front/src/company-data-mcp/market-snapshot-reader.test.ts`
- Create: `~/krw-ontology-front/src/company-data-mcp/server.ts`
- Create: `~/krw-ontology-front/src/company-data-mcp/server.test.ts`
- Create: `~/krw-ontology-front/src/worker/company-data-mcp-server.ts`
- Modify: `~/krw-ontology-front/package.json`
- Create: `~/krw-ontology-front/scripts/start-company-data-mcp-production.sh`
- Create: `~/krw-ontology-front/scripts/verify-company-data-mcp-production.sh`
- Create: `~/krw-ontology-front/ops/mac-worker/company-data-mcp.md`
- Deployment handoff only: update the `krw_market_snapshot` endpoint/credential binding in `~/krw-agnet` after the service is healthy.

- [ ] **Step 1: Test the exact existing agent contract.**

  Input is only `{ "ticker": "AVGO" }`. Output must be `market-snapshot/v1`, exact normalized ticker, `source: "fmp"`, `source_usage: "research_only"`, and `advisory_only: true`. Supported metric names are only:

  ```text
  last_price
  previous_close
  market_cap
  trailing_pe
  forward_pe
  price_to_book
  ```

- [ ] **Step 2: Read existing operated tables, not a new research store.**

  Reuse the repository/calculation conventions in:

  - `src/lib/valuation/repository.ts`
  - `src/lib/valuation/calculator.ts`
  - `src/lib/valuation/refresh.ts`

  Make one bounded read for the latest snapshot and the latest/previous price. Do not call a model, scrape the web, or recompute the entire valuation pipeline per research question.

- [ ] **Step 3: Validate freshness and units.**

  Emit a metric only when finite, appropriately positive, current within `KRW_MARKET_SNAPSHOT_MAX_AGE_HOURS` (default 96), and currency is an uppercase three-letter code where required. If `last_price / previous_close` is outside `[0.25, 4.0]`, return unavailable to avoid a symbol/unit/split error contaminating research.

- [ ] **Step 4: Make missing data a normal result.**

  Missing ticker rows, stale rows, or invalid metrics return:

  ```json
  {
    "schema_version": "market-snapshot/v1",
    "ticker": "AVGO",
    "status": "unavailable",
    "metrics": []
  }
  ```

  Do not throw an MCP protocol error for ordinary data absence. This lets the agent continue ontology research and tell the user what was unavailable.

- [ ] **Step 5: Run it as a persistent loopback service.**

  Bundle once, start alongside the Mac agent daemon, bind `127.0.0.1:8797`, require a bearer credential reference, reuse a bounded Supabase/Postgres pool, and add launchd/preflight/status scripts based on the existing valuation/feed services. Never compile or start the MCP server for each question.

- [ ] **Step 6: Bind without adding a model choice.**

  Point the existing automatic `market.snapshot` preflight binding in `krw-agent` to this endpoint. The harness already invokes this deterministically for singleton company scope; do not add a new planner tool or prompt instruction.

- [ ] **Operator verification:**

  ```bash
  npm run test:unit -- src/company-data-mcp
  npm run build:company-data-mcp
  npm run company-data-mcp:prod:verify
  ```

**Completion criterion:** Fresh supported valuation data appears automatically before research, while absent data adds neither a failed run nor another model decision.

---

### Task 9: Separate builds from runtime and deploy persistent processes

**Files:**

- Modify: `~/krw-ontology-front/package.json`
- Modify: `~/krw-ontology-front/docker-compose.yml`
- Modify: `~/krw-ontology-front/scripts/deploy-production-fast.sh`
- Modify: `~/krw-ontology-front/scripts/run-production-release-gates.sh`
- Create: `~/krw-ontology-front/scripts/build-agent-v1-workers.mjs`
- Create: `~/krw-ontology-front/ops/krw-agent-front-cutover.md`
- Modify: `~/krw-ontology-front/src/lib/deploy-scripts.test.ts`

- [ ] **Step 1: Stop rebuilding every worker for one change.**

  Replace the single long `build:worker` chain as the only entry point with targeted scripts:

  ```text
  build:agent-v1-outbox
  build:company-data-mcp
  build:document-workers
  build:all-workers
  ```

  Development start commands run existing bundles by default and rebuild only when `--build` is explicitly supplied. CI/release still runs the complete build once.

- [ ] **Step 2: Keep processes warm.**

  Run the Rust daemon, product outbox worker, and company-data MCP continuously. Use restart policies/launchd health checks. A code or skill release produces a pinned artifact, restarts the affected process once, and then serves many questions; it must not trigger a Rust compile or full Next build per question.

- [ ] **Step 3: Add outbox worker near the product DB.**

  Run `agent-v1-outbox-worker.mjs` as a separate service with its own small pooled connection budget. It has no public port, read-only filesystem where possible, dropped Linux capabilities, and bounded claim/concurrency values.

- [ ] **Step 4: Add readiness with correct semantics.**

  Deployment readiness checks pinned descriptor/DB compatibility, daemon heartbeat, outbox lag, and market MCP health. Optional market data being unavailable must not mark the whole research system down. A missing mandatory runtime contract keeps new-room creation disabled until repaired.

- [ ] **Step 5: Record operational metrics.**

  At minimum emit counters/gauges for:

  - accepted/enqueued/already-enqueued by backend and run kind;
  - queue wait, execution time, projection lag, end-to-end time;
  - outbox claimed/replayed/released/ack-failed;
  - terminal answer/degraded/cancelled/watchdog-finalized;
  - session-memory revision used and restore failure class;
  - market snapshot available/unavailable/stale;
  - DB pool active/idle/waiting and process RSS.

  Do not log user question/answer bodies by default. Correlate with run/session IDs and redacted failure classes.

- [ ] **Operator verification:**

  ```bash
  npm run build:agent-v1-workers
  npm run agent-v1:compat:verify
  scripts/run-production-release-gates.sh
  ```

**Completion criterion:** Editing front adapter code rebuilds seconds-worth of TypeScript bundles rather than the whole Rust/Next/MCP stack, and normal testing reuses persistent processes.

---

### Task 10: Direct 100% cutover, GLM quality gate, and forward recovery

**Files:**

- Create: `~/krw-ontology-front/scripts/smoke-agent-v1-glm.mjs`
- Create: `~/krw-ontology-front/scripts/audit-agent-v1-terminal-invariant.mjs`
- Create: `~/krw-ontology-front/src/lib/agent-v1/rollout.test.ts`
- Modify: `~/krw-ontology-front/ops/krw-agent-front-cutover.md`

- [ ] **Step 1: Complete non-live tests before traffic.**

  Run unit, type, DB contract, replay, ownership, cancellation, reconnect, and failure-injection suites. These tests may use either model name as data but must not contact DeepSeek.

- [ ] **Step 2: Run GLM-only live smoke tests.**

  Use a dedicated test member and new Rust rooms for:

  1. “AVGO를 간단히 분석해줘.”
  2. same-room follow-up: “그럼 밸류에이션은?”
  3. same-room follow-up: “앞 답변에서 가장 취약한 가정은?”
  4. Guru question on the same company.
  5. market snapshot unavailable case.
  6. optional MCP failure case.

  Capture question, final answer, run/chain trace IDs, skills loaded, tool results, model turns, projection lag, and terminal status. Do not reduce model calls, reasoning level, or tool budget to pass latency.

- [ ] **Step 3: Enforce quality/termination gates.**

  A run passes only when:

  - the initial company ontology map was consumed;
  - the answer addresses the user question and adds relevant implications/counterpoints;
  - cited claims map to retrieved evidence;
  - the follow-up stays on AVGO without the user repeating the ticker;
  - absence of valuation data is stated precisely without blocking other research;
  - exactly one completed assistant message exists;
  - no reservation remains attached to a terminal run;
  - no cross-user/session data appears.

- [ ] **Step 4: Enable direct 100% cutover.**

  Set `KRW_AGENT_BACKEND_MODE=rust`, run the compatibility gate, and create every new room with `agent_backend='rust_agent'`. Existing rooms are closed in the migration. Hold traffic until the GLM quality and terminal-answer audits pass, then open the service to all new rooms at once.

- [ ] **Step 5: Use forward-only recovery, not rollback.**

  There is no legacy rollback path. If cutover validation fails, keep new-room creation disabled, repair the Rust contract, and resume only after the same GLM and terminal-answer gates pass. Do not reopen closed rooms or kill accepted Rust runs; let the outbox/watchdog finish them.

- [ ] **Step 6: Validate DeepSeek production configuration without a live call.**

  Load the production descriptor, verify exact `deepseek-v4-flash`, Anthropic Messages-compatible wire mode, structured-output contract, route/image/profile hashes, and DB acceptance. The first real DeepSeek request happens only after production cutover authorization, not during this test plan.

- [ ] **Operator verification:**

  ```bash
  npm run test:unit
  npm run typecheck
  npm run agent-v1:compat:verify
  node scripts/smoke-agent-v1-glm.mjs
  node scripts/audit-agent-v1-terminal-invariant.mjs
  ```

**Completion criterion:** A GLM room completes initial and follow-up research with correct same-room context, every accepted failure is terminally visible, and production can switch to a pinned DeepSeek descriptor without code changes.

---

## Implementation order and release gates

| Order | Work | Can ship alone? | Gate before next step |
|---:|---|---|---|
| 1 | Host package + compatibility preflight | Yes, disabled | Exact hashes/versions pass |
| 2 | Forward DB migrations + closed-room cutover | Yes, new rooms disabled | Existing rooms are read-only |
| 3 | Runtime composition + direct Rust dispatcher | Yes, service disabled | Enqueue replay/ownership tests pass |
| 4 | Outbox projection + cancellation/reconnect | Required before Rust traffic | Crash/replay and terminal invariant pass |
| 5 | Persistent process/deploy separation | Yes | Outbox lag/readiness visible |
| 6 | Company-data MCP | Yes, soft-fail | Missing data cannot fail a run |
| 7 | Internal GLM rooms | No external traffic | Quality and follow-up audit pass |
| 8 | Direct 100% new-room cutover | One switch | SLO and isolation gates pass |
| 9 | DeepSeek production descriptor | After authorization | Contract validation passes; no code diff |

## Explicitly deferred work

- Wide research without a ticker, uploaded-document research, URL research, and market-issue sessions are rejected with a bounded validation response until each has a small trusted context contract; they are never silently sent to a legacy engine.
- Broader OpenBB-style fundamentals, estimates, reverse DCF, and peer-comparison payloads require a future versioned agent input/MCP schema; they are not smuggled through `market-snapshot/v1`.
- No personal cross-chat research memory, embedding search across a member's rooms, or ontology schema change is part of this integration.
- No front-end redesign is required. Existing chat list, message renderer, SSE, polling, auth, billing UI, and Supabase product history remain the interface.

## Definition of done

- [ ] Existing production rooms are closed for new input and preserve read-only history until retention purge.
- [ ] Every new Rust room persists one backend and retains it for every follow-up.
- [ ] `krw-agent` restores same-session context after worker claim; the front does not resend or rank personal memories.
- [ ] GLM and DeepSeek are selected solely through pinned release descriptors; route code is provider-neutral.
- [ ] Skills, MCPs, ontology map, model turns, tool count, and reasoning budgets remain agent-owned and unchanged.
- [ ] Every accepted run produces exactly one completed user-visible assistant message, including cancellation and permanent failure.
- [ ] Outbox delivery is idempotent across crashes and concurrent workers.
- [ ] Product credits/budgets settle or release exactly once.
- [ ] Company data is deterministic, advisory, freshness-checked, and soft-failing.
- [ ] No request rebuilds Rust, Next.js, worker bundles, MCP images, or release artifacts.
- [ ] No route contains a legacy fallback, canary percentage, or rollback-to-Claude branch.
- [ ] No change is made to `~/krw-ontology` or its schema.
