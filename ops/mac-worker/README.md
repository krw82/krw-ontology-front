# Mac worker (legacy agent supervisor) — RETIRED 2026-08-19

리서치 실행은 Rust 엔진(`~/krw-agnet`, launchd `com.krw.agentd`)으로 완전히 이전되었습니다.
레거시 agent-worker 설치/기동 스크립트는 retired stub입니다.
제거: `scripts/uninstall-mac-worker-launchd.sh`. 아래 내용은 역사적 참고용입니다.

# Mac Production Worker

This setup keeps `krwontology.com` on GCP for web/API, but moves agent execution
to this Mac.

```text
User -> GCP web/API -> Supabase durable queue -> Postgres NOTIFY -> Mac supervisor -> Supabase events
```

The Mac does not need inbound networking. It keeps one long-lived Postgres
LISTEN session open to Supabase, then connects out to Claude and local MCP
processes only when queued work is claimed.

## First-Time Setup

1. Generate the local production env:

   ```sh
   scripts/init-mac-worker-env.sh
   ```

2. Stop any local ontology queue writer before using this Mac as production
   worker:

   ```sh
   krw-ontology queue stop --wait --timeout 7200
   ```

3. Run preflight:

   ```sh
   scripts/mac-worker-preflight.sh
   ```

   Preflight requires the pinned local `claude-krw` Claude Code version. The
   current Mac worker pin is `2.1.204`.

4. Start the Mac supervisor in the foreground:

   ```sh
   scripts/start-mac-worker-production.sh
   ```

5. For stable operation, install the launchd supervisor:

   ```sh
   scripts/install-mac-worker-launchd.sh --load
   ```

   This starts one `com.krwontology.agent-worker` launchd service. The
   supervisor controls concurrency with `AGENT_SUPERVISOR_CONCURRENCY`.

6. Test `1Q -> 3Q -> 30Q` from `https://krwontology.com`.

## Deployment Lanes

Production command UX is documented in detail at
[`docs/DEPLOY_COMMANDS.md`](../../docs/DEPLOY_COMMANDS.md).

Use the env-first aliases for routine work:

```sh
npm run prod:deploy:web      # GCP web/API only
npm run prod:deploy:runtime  # plugin/skills + Mac-local MCP service + Mac workers
npm run prod:deploy:code     # web + runtime, no ontology release switch
npm run prod:release:publish -- --release-id <release_id>
npm run prod:deploy:full -- --release-id <release_id>  # web + Mac runtime + migrations + catalog
```

Compatibility aliases such as `npm run deploy:runtime`, `npm run deploy:mcp`,
and `npm run deploy:plugin` are still kept, but new automation and runbooks
should use `prod:deploy:runtime`.

GCP ontology MCP and GCP agent-worker sidecars are retired. Normal plugin,
skill, and MCP changes always use `npm run prod:deploy:runtime`.

## Rollback

Stop the Mac foreground supervisor with `Ctrl-C`, or stop launchd:

```sh
scripts/uninstall-mac-worker-launchd.sh
```

The Mac runtime is the only production agent executor; do not start a GCP
agent-worker as a fallback.

## Stable Operation

After foreground testing passes, install the launchd plist generated from
`ops/launchd/com.krwontology.agent-worker.plist.template`.

Keep these invariants:

- only one production worker class claims jobs at a time
- one Mac supervisor process owns production execution
- `GLOBAL_CONCURRENT_RUN_LIMIT` is at least `AGENT_SUPERVISOR_CONCURRENCY`
- worker wakeup uses Postgres `LISTEN/NOTIFY`; Supabase Realtime is not used for
  worker wakeup
- local queue writer is stopped while Mac worker serves production
- GCP web never mounts the ontology plugin or full ontology data
- only the Mac supervisor owns production execution

## Valuation refresh worker

The FMP-backed TTM valuation worker has its own one-shot, foreground, and
launchd commands. Follow [`valuation-refresh.md`](valuation-refresh.md) for
preflight, logs, duplicate-process protection, and the macOS service lifecycle.
Before a full production deploy, sync its key into the existing Mac runtime
env with `npm run valuation:mac:sync-env -- --from .env --out .env.mac-worker.production`.
