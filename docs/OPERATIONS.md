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

Production deploys must pass these checks before traffic is considered healthy.

```bash
npm run verify:sdk-freeze
npm run supabase:db:push:dry
npm run supabase:schema:smoke
npm run check
npm run test:e2e
```

`scripts/deploy-all-production.sh` runs migration drift checks and schema smoke by default. Use `--skip-db-check` only for emergency static asset rollback where no DB-dependent code changed.
The GCP compose deploy also starts the persistent Redis document queue,
BullMQ `document-worker`, and `document-outbox-dispatcher`; treat the deploy as
incomplete if either document service is not running.

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
npm run prod:release:publish -- --release-id <release_id>
```

The expected production index paths are:

```text
~/krw-ontology-data/releases/prod/current/indexes/global_spine.sqlite
~/krw-ontology-data/releases/prod/current/indexes/shard_manifest.json
~/krw-ontology-data/releases/prod/current/indexes/companies/<TICKER>.sqlite
```

`prod:release:publish` verifies the release, exports a compact
`web_catalog.json`, publishes that catalog to Supabase, restarts prod MCP, then
restarts Mac workers.

It does not upload the v3 SQLite indexes to GCP.

## Web And Plugin Deploy

For GCP web/API only:

```bash
npm run prod:deploy:web
```

For plugin/skills/MCP/worker runtime only:

```bash
npm run prod:deploy:runtime
```

For routine code deploys without ontology release changes:

```bash
npm run prod:deploy:code
```

For DB migration, ontology release, web, and runtime together:

```bash
npm run prod:deploy:full -- --release-id <release_id>
```

This path applies pending Supabase migrations before code deploy, then brings up
GCP web/API, Redis, `document-worker`, `document-outbox-dispatcher`, billing, and
the prod runtime.

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

Rollback order:

1. If the issue is ontology/index related, roll back `prod/current` to the
   previous release and run `npm run prod:deploy:runtime`.
2. If the issue is catalog publication, republish the previous release with
   `npm run prod:release:publish -- --release-id <previous_release_id>`.
3. If the issue is web/runtime code, deploy the previous Git revision with
   `npm run prod:deploy:code`.
4. Verify `npm run prod:status`, `/api/healthz`, and a real chat smoke test
   before declaring recovery.

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
