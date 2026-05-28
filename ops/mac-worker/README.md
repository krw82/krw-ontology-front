# Mac Production Worker

This setup keeps `krwontology.com` on GCP for web/API, but moves agent execution
to this Mac.

```text
User -> GCP web/API -> Supabase queue -> Mac agent-workers -> Supabase events
```

The Mac does not need inbound networking. It only connects out to Supabase,
Claude, and local MCP processes.

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
   current Mac worker pin is `2.1.111`.

4. Stop the GCP worker:

   ```sh
   scripts/stop-gcp-agent-worker.sh
   ```

5. Start one Mac worker in the foreground:

   ```sh
   scripts/start-mac-worker-production.sh
   ```

6. For stable operation, install five launchd workers:

   ```sh
   scripts/install-mac-worker-launchd.sh --load
   ```

   This starts `mac-worker-jwc-1` through `mac-worker-jwc-5`, each with its own
   launchd label, lock, log file, and heartbeat row.

7. Test `1Q -> 3Q -> 30Q` from `https://krwontology.com`.

## Deployment Lanes

Production command UX is documented in detail at
[`docs/DEPLOY_COMMANDS.md`](../../docs/DEPLOY_COMMANDS.md).

Use the env-first aliases for routine work:

```sh
npm run prod:deploy:web      # GCP web/API only
npm run prod:deploy:runtime  # plugin/skills + MCP sidecar + Mac workers
npm run prod:deploy:code     # web + runtime, no ontology release switch
npm run prod:release:publish -- --release-id <release_id>
npm run prod:deploy:full -- --release-id <release_id>
```

Compatibility aliases such as `npm run deploy:runtime`, `npm run deploy:mcp`,
and `npm run deploy:plugin` are still kept, but new automation and runbooks
should use `prod:deploy:runtime`.

The old VM plugin sync is kept as `npm run legacy:gcp-mcp` only for
compatibility. Normal plugin, skill, and MCP changes should use
`npm run prod:deploy:runtime`.

## Rollback

Stop the Mac foreground worker with `Ctrl-C`, or stop all launchd workers:

```sh
scripts/uninstall-mac-worker-launchd.sh
```

Then restart the GCP worker:

```sh
scripts/start-gcp-agent-worker.sh
```

## Stable Operation

After foreground testing passes, install the launchd plists generated from
`ops/launchd/com.krwontology.agent-worker.plist.template`.

Keep these invariants:

- only one production worker class claims jobs at a time
- `MAC_WORKER_COUNT=8` and `GLOBAL_CONCURRENT_RUN_LIMIT=8` for the current Mac
  worker setup
- local queue writer is stopped while Mac worker serves production
- GCP web keeps valid plugin/data until web admission no longer depends on local
  MCP health
- GCP `agent-worker` stays stopped while Mac workers own production execution
