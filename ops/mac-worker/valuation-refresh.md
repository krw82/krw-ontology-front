# Local valuation refresh worker

The valuation worker runs on the same Mac as the local MCP workers. It calls
the configured FMP statement/quote endpoints, calculates the TTM metrics, and
writes the normalized snapshot to Supabase using the server-only service-role
key. The browser never receives the FMP key and does not call FMP directly.

## One-shot verification

Build the worker bundle and refresh a small, explicit ticker set:

```sh
npm run build:worker
scripts/start-valuation-refresh-worker.sh \
  --env-file .env.mac-worker.production \
  --once \
  --tickers AAPL,ABBV
```

Use `--log-file /tmp/valuation-refresh-worker.log` when you want a disposable
foreground log. The script validates the env, bundle, interval, batch size,
and log directory before making the API calls.

## Foreground operation

```sh
npm run valuation:mac:preflight -- --env-file .env.mac-worker.production
npm run valuation:mac:start -- --env-file .env.mac-worker.production
```

The start script uses a worker-id lock under `/tmp` so two local processes do
not refresh the same schedule concurrently. Set
`VALUATION_REFRESH_TICKERS` in the env file for a bounded recurring watchlist;
otherwise the worker selects a rotating batch from `ontology_companies`.

## launchd operation (macOS)

`npm run prod:deploy:full` now builds this worker, validates the FMP/Supabase
runtime environment, installs the launchd service, and verifies that the
process is running. If the deployment env was generated before valuation was
added, copy only the valuation settings into it with:

```sh
npm run valuation:mac:sync-env -- \
  --from .env \
  --out .env.mac-worker.production
```

The deployment intentionally fails instead of silently publishing a web build
with no valuation data.

Generate and inspect the plist first:

```sh
npm run valuation:mac:launchd:install -- \
  --env-file .env.mac-worker.production \
  --dry-run
```

After the foreground one-shot succeeds, install and load it:

```sh
npm run valuation:mac:launchd:install -- \
  --env-file .env.mac-worker.production \
  --load
npm run valuation:mac:launchd:status -- \
  --env-file .env.mac-worker.production
npm run valuation:mac:verify -- \
  --env-file .env.mac-worker.production
```

The service is `com.krwontology.valuation-refresh-worker`. launchd keeps one
process alive; the worker itself performs the configured interval schedule.
Stop it with:

```sh
npm run valuation:mac:launchd:uninstall
```

Logs default to `~/krw-ontology-log/valuation-refresh/`. Override the
directory with `VALUATION_REFRESH_LOG_DIR` in the env file.
