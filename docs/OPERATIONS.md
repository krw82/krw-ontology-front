# Operations

## Current Production Boundary

KRW Ontology Front is currently operated as a single-VM service.

```text
Caddy
  -> Docker Compose web container
  -> Claude Agent SDK process
  -> local Claude plugin
  -> stdio MCP command
  -> /srv/krw-ontology-data/current
```

This is intentional for the pre-launch service. Do not run multiple web replicas until cancellation, reconnect, SDK session state, and rate limiting are moved to shared infrastructure.

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

## Data Deploy

The ontology snapshot is deployed from `~/krw-ontology-data`. Queue workers must be stopped before publishing a stable snapshot.

```bash
krw-ontology queue stop --wait --timeout 7200
krw-ontology queue status
npm run deploy:data -- --replace-remote-data
krw-ontology queue start
```

The expected stable index path is:

```text
~/krw-ontology-data/indexes/agent_index.sqlite
```

On the VM, the serving symlink should resolve to:

```text
/srv/krw-ontology-data/current/indexes/agent_index.sqlite
```

## Web And Plugin Deploy

For web/plugin/MCP code changes without data replacement:

```bash
npm run deploy:all -- --skip-data
```

The deploy script materializes `~/krw-ontology` into a temporary Docker build context. Do not rely on Docker following an external symlink.

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

Deep health must verify Supabase, plugin files, MCP command execution, SQLite index access, and MCP tool exposure.

## SDK Freeze

Pinned versions:

```text
Node @anthropic-ai/claude-agent-sdk: 0.2.141
Python claude-agent-sdk: 0.2.85
Claude Code native binary: 2.1.141
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

1. Repoint `/srv/krw-ontology-data/current` to the previous data release if the issue is data/index related.
2. Rebuild/restart the previous Git revision if the issue is web/plugin related.
3. Verify `/api/healthz/deep` and a real chat smoke test before declaring recovery.

## Incident Notes

For agent failures, inspect:

```sql
select id, status, error_code, error_message, sdk_diagnostics, started_at, finished_at
from agent_runs
order by started_at desc
limit 20;
```

For rate limiting, inspect:

```sql
select key, bucket, window_start, count, updated_at
from rate_limit_counters
order by updated_at desc
limit 50;
```
