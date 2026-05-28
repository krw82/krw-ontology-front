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

Production is split into separate deploy lanes:

```sh
npm run deploy:web      # GCP web/API only
npm run deploy:worker   # Mac worker bundle + launchd workers only
npm run deploy:plugin   # ~/krw-ontology plugin/MCP/skills + Mac workers only
npm run deploy:prod     # deploy:web, then deploy:plugin
```

The old VM plugin sync is kept as `npm run deploy:plugin:gcp` only for
compatibility. Normal plugin, skill, and MCP changes should use
`npm run deploy:plugin`.

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
- `MAC_WORKER_COUNT=5` and `GLOBAL_CONCURRENT_RUN_LIMIT=5` for the current Mac
  worker setup
- local queue writer is stopped while Mac worker serves production
- GCP web keeps valid plugin/data until web admission no longer depends on local
  MCP health
- GCP `agent-worker` stays stopped while Mac workers own production execution
