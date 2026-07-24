# Operations

이 문서는 서버/Web 운영 절차를 다룬다. macOS Desktop 앱은 별도 제품/배포
단위이며, Web app이 Desktop 설치 여부에 의존하지 않는 것을 목표 경계로 둔다.
Desktop/Web 분리 설계는
[`docs/DESKTOP_WEB_BOUNDARY.md`](./DESKTOP_WEB_BOUNDARY.md)를 기준으로 한다.

## Current Production Boundary

KRW Ontology Front is operated with GCP web/API as the control-plane entry point
and this Mac as the production agent/runtime machine.

```text
User
  -> GCP web/API
  -> Supabase queue/catalog
  -> Mac agent workers
  -> local prod MCP HTTP sidecar
  -> ~/krw-ontology-data/releases/prod/current
```

GCP web/API must not read the full ontology SQLite indexes. It reads only
Supabase control-plane data such as the active web catalog. The v3
`global_spine.sqlite` and company shards are served only by the Mac prod runtime.

The detailed deploy command reference is
[`docs/DEPLOY_COMMANDS.md`](./DEPLOY_COMMANDS.md).

## Deployment Gate

Run the broad local release gate when the change warrants it:

```bash
npm run prod:preflight
```

For a no-mutation target and migration check, run:

```bash
npm run prod:deploy:dry
```

The fast deploy path runs a Supabase migration dry-run before an actual
`db push`, then runs the schema smoke after it. GCP image builds happen while
the current containers continue to serve traffic. Redis remains persistent;
the document, filing, billing, and LLM application services are recreated with
the new web image.

## Data Deploy

Production ontology data is deployed as an immutable local release. Do not
rebuild or overwrite `prod/current` in place.

```bash
cd ~/krw-ontology
uv run krw-ontology release force
uv run krw-ontology release watch
uv run krw-ontology quality check
uv run krw-ontology release materialize-prod <release_id>

cd ~/krw-ontology-front
npm run prod:release:publish
```

The expected production index paths are:

```text
~/krw-ontology-data/releases/prod/current/indexes/global_spine.sqlite
~/krw-ontology-data/releases/prod/current/indexes/shard_manifest.json
~/krw-ontology-data/releases/prod/current/indexes/companies/<TICKER>.sqlite
```

`prod:release:publish` verifies the already-active `prod/current`, exports a
compact `web_catalog.json`, and publishes that catalog to Supabase. It does not
promote another release or restart prod MCP/Mac workers.

It does not upload the v3 SQLite indexes to GCP.

## Web And Plugin Deploy

The normal deploy driver is `scripts/deploy-production-fast.sh`. It retains the
legacy sealed scripts only for bootstrap and interrupted-cutover recovery.

For GCP web/API and application worker containers only:

```bash
npm run prod:deploy:web
```

```bash
npm run prod:deploy:runtime
```

This restarts only the Mac MCP/worker runtime. It materializes a versioned
Ontology plugin from the same source as the MCP, verifies the live fingerprint,
and requires a fresh worker heartbeat before marking the runtime active.

For routine code deploys with pending migrations but without catalog publication:

```bash
npm run prod:deploy:code
```

For DB migration, active catalog publication, web, and runtime together:

```bash
npm run prod:deploy:full
```

The full path builds the new GCP image before it applies a migration, publishes
only the already-active catalog, switches the application containers, restarts
the Mac runtime, and checks private deep health plus both public origins.
If public GCP health fails during the switch, it retags and starts the previous
GCP image automatically. Database migrations are not automatically reversed.

If this Mac is still running the legacy mutable launchd paths and has no sealed
immutable runtime pointer, the first cutover must instead be:

```bash
npm run prod:deploy:bootstrap
```

This is a one-time full cutover. It prepares and seals the new Mac runtime and
the exact GCP rollback before stopping legacy launchd. The legacy Mac runtime is
never restarted after that boundary: a pre-migration failure restores GCP only
and leaves Mac fail-closed; a post-migration failure leaves both lanes
fail-closed. Never delete the permanent bootstrap marker or repeat this command
after a successful immutable activation.

If the orchestrator is killed or the host reboots before the migration marker,
recover under a new kernel lock by adopting the owner recorded in
`.deploy/cutover-phase-<deployment_id>.env`:

```bash
npm run prod:deploy:recover -- \
  --recover-cutover <deployment_id> \
  --recovery-action resume \
  --previous-lock-owner <recorded_lock_owner>
```

Use `resume-remote` instead of `resume` for the one-time unsealed bootstrap
boundary. Recovery revalidates every local and remote seal before changing the
durable owner and is refused after migration has started.

## Health Checks

Shallow web health:

```bash
curl -fsS https://krwontology.com/api/healthz
```

Deep health requires `INTERNAL_API_KEY`.

```bash
curl -fsS \
  -H "x-internal-key: $INTERNAL_API_KEY" \
  https://krwontology.com/api/healthz/deep
```

Deep health must verify Supabase, plugin files, MCP command execution, v3 global
spine/company shard access, and MCP tool exposure.

## SEC Filing Notification Rollout

The filing worker reads only the official per-issuer
`data.sec.gov/submissions/CIK##########.json` endpoint. It should be deployed
with all three switches off, then enabled in this order:

```text
FILING_DETECTION_ENABLED=1
FILING_NOTIFICATION_CREATION_ENABLED=0
FILING_PUSH_ENABLED=0
```

Run that shadow state for one trading day. Inspect recent events, duplicate
accessions, `sec_filing_poll_state`, and the `filing_notification_worker_heartbeats`
row. Then enable in-app notification creation; enable browser push only after
a real internal-device test succeeds.

The worker tick is 15 seconds and each active CIK is due every five minutes.
Keep `SEC_FILING_REQUEST_DELAY_MS` at or above 650ms. A stale filing worker
heartbeat (older than 75 seconds) makes the deep health endpoint fail only
when `FILING_DETECTION_ENABLED=1`.

Emergency rollback is independent by stage:

```text
FILING_PUSH_ENABLED=0                         # stop device push
FILING_NOTIFICATION_CREATION_ENABLED=0        # stop new inbox entries
FILING_DETECTION_ENABLED=0                    # stop SEC polling
```

## SDK Freeze

Pinned versions:

```text
Node @anthropic-ai/claude-agent-sdk: 0.3.204
Python claude-agent-sdk: 0.2.85
Claude Code native binary: 2.1.204
```

Use `npm run verify:sdk-freeze` before deploying. Do not update the SDK as part of routine dependency maintenance.

## Supabase Hosted Settings

The hosted project should match these production constraints:

```text
Site URL: https://krwontology.com
Redirect URLs:
  https://krwontology.com/auth/callback
  https://www.krwontology.com/auth/callback
  http://localhost:3000/auth/callback
  http://127.0.0.1:3000/auth/callback
DB network restrictions: enable when stable operator/VPC egress IPs are known
SSL enforcement: enabled
Signup policy: explicitly chosen before public launch
```

Do not leave old VM IP redirect URLs in hosted Auth settings.

## Rollback

If the fast GCP container switch or public health check fails, the script
retags the previous `krw-ontology-front-web:local` image and recreates the
application services using the previous simple release configuration (or the
standard live Compose configuration on the first fast deploy). Do not manually
restart containers while that rollback is in progress.

After `supabase db push`, schema rollback is deliberately manual: use a
forward-compatible follow-up migration or the legacy recovery process if the
incident requires a sealed runtime investigation. Do not manually repoint
`prod/current`. For current-release catalog publication only, rerun
`npm run prod:release:publish`.

Before declaring recovery, verify `npm run prod:status`, both public
`/api/healthz` origins, private deep health, exact worker deployment/runtime
identity, and one real chat smoke test.

## Deployment Lock And Recovery

Normal production mutation enters through `scripts/deploy-production-fast.sh`.
It holds a macOS kernel `lockf` lock and does not pause the local ontology queue:
normal code deploys do not change `prod/current`. The large
`deploy-production-simple.sh` and `deploy-with-queue-pause.sh` paths are
reserved for sealed bootstrap or interrupted-cutover recovery, not everyday
deployment. Do not invoke low-level GCP, Mac runtime, data, Compose, or restart
scripts as bypass lanes.

## Schema Cache Gate

The post-migration smoke test uses bounded requests and exact non-mutating RPC
signature probes for document ingestion claims. A stale PostgREST schema cache
that would surface as `PGRST202` blocks the container switch. The orchestrator
retries the smoke briefly for cache convergence; if it still fails, the current
GCP runtime remains running and the operator must assess the applied schema.

## Incident Notes

For agent failures, inspect:

```sql
select id, status, error_code, error_message, sdk_diagnostics, started_at, finished_at
from agent_runs
order by started_at desc
limit 20;
```

`sdk_diagnostics` is recorded only when `CLAUDE_SDK_DIAGNOSTICS=1` is set
before the run starts. Persisted diagnostics exclude prompt previews and local
filesystem paths.

Agent SDK runs use `permissionMode: "dontAsk"` with an explicit allow-list of
KRW Ontology MCP tools, disabled built-in tools, and no filesystem setting
sources. Do not enable global bypass permissions for production workers.

Execution budget reservations are mode-based before durable chat work starts:
fast defaults to `$0.05`, standard to `$0.15`, and deep to `$0.50`. Override
with `FAST_RESEARCH_RESERVE_COST_USD`, `STANDARD_RESEARCH_RESERVE_COST_USD`,
and `DEEP_RESEARCH_RESERVE_COST_USD` only after checking observed costs.

For rate limiting, inspect:

```sql
select key, bucket, window_start, count, updated_at
from rate_limit_counters
order by updated_at desc
limit 50;
```

Durable chat-run policy is enforced through `increment_rate_limit` using
`CHAT_RUNS_PER_USER_PER_MINUTE`, `CHAT_RUNS_PER_IP_PER_MINUTE`, and
`CHAT_RUNS_PER_SESSION_PER_MINUTE`. The Next proxy does not keep an
in-process rate-limit bucket; do not add product policy there because Proxy can
run independently of application render workers.
