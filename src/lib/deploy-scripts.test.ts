import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("production deploy scripts", () => {
  it("routes production code deploys through split web and Mac worker lanes", () => {
    const deployProd = read("scripts/deploy-production.sh");
    const deployAll = read("scripts/deploy-all-production.sh");
    const packageJson = read("package.json");
    const restartCompose = read("scripts/restart-production-compose.sh");

    expect(deployProd).toContain("deploy-web-production.sh");
    expect(deployProd).toContain("deploy-plugin-worker-production.sh");
    expect(deployProd).toContain("supabase-cli.sh\" db push --dry-run");
    expect(deployProd).toContain("npm run supabase:schema:smoke");
    expect(deployProd).toContain("intentionally does not start the GCP agent-worker");

    expect(deployAll).toContain("deploy-web-production.sh");
    expect(deployAll).toContain("deploy-plugin-worker-production.sh");
    expect(deployAll).toContain("deploy-data-release-production.sh");
    expect(deployAll).toContain("Mac worker/plugin validation");
    expect(deployAll.indexOf("Applying Supabase migrations")).toBeLessThan(
      deployAll.indexOf("deploy-web-production.sh"),
    );
    expect(deployAll.indexOf("npm run supabase:schema:smoke")).toBeLessThan(
      deployAll.indexOf("deploy-web-production.sh"),
    );

    expect(packageJson).toContain('"prod:status": "npm run mcp:prod:status && npm run worker:prod:status"');
    expect(packageJson).toContain('"prod:deploy:web": "scripts/deploy-web-production.sh"');
    expect(packageJson).toContain('"prod:deploy:runtime": "scripts/deploy-plugin-worker-production.sh"');
    expect(packageJson).toContain('"prod:deploy:code": "scripts/deploy-production.sh"');
    expect(packageJson).toContain('"prod:deploy:full": "scripts/deploy-all-production.sh --apply-migrations"');
    expect(packageJson).toContain('"prod:deploy:safe": "scripts/deploy-with-queue-pause.sh"');
    expect(packageJson).toContain('"prod:release:publish": "scripts/deploy-data-release-production.sh"');
    expect(packageJson).toContain('"deploy:data": "scripts/deploy-data-release-production.sh"');
    expect(packageJson).toContain('"deploy:worker": "scripts/deploy-worker-production.sh"');
    expect(packageJson).toContain('"deploy:plugin": "scripts/deploy-plugin-worker-production.sh"');
    expect(packageJson).toContain('"deploy:mcp": "scripts/deploy-plugin-worker-production.sh"');
    expect(packageJson).toContain('"legacy:gcp-mcp": "scripts/deploy-plugin-production.sh"');
    expect(packageJson).not.toContain("deploy-data-production.sh");
    expect(packageJson).toContain('"deploy:plugin:gcp": "scripts/deploy-plugin-production.sh"');
    expect(packageJson).toContain('"deploy:legacy:gcp-mcp": "scripts/deploy-plugin-production.sh"');
    expect(packageJson).toContain('"publish:web-catalog": "node scripts/publish-web-catalog.mjs"');
    expect(packageJson).toContain('"verify:web-catalog": "node scripts/verify-web-catalog-release.mjs"');
    expect(packageJson).toContain('"billing:prod:readiness": "scripts/verify-billing-production-readiness.sh"');
    expect(packageJson).toContain('"mcp:prod:start": "scripts/start-mcp-server-production.sh"');
    expect(packageJson).toContain('"mcp:prod:verify": "scripts/verify-mcp-server-production.sh"');
    expect(packageJson).toContain('"mcp:prod:logs": "scripts/tail-mcp-logs.sh prod"');
    expect(packageJson).toContain('"mcp:prod:launchd:install": "scripts/install-mcp-server-launchd.sh"');
    expect(packageJson).toContain('"mcp:dev:start": "scripts/start-mcp-server-dev.sh"');
    expect(packageJson).toContain('"mcp:dev:verify": "scripts/verify-mcp-server-dev.sh"');
    expect(packageJson).toContain('"mcp:dev:logs": "scripts/tail-mcp-logs.sh dev"');
    expect(packageJson).toContain('"mcp:dev:launchd:install": "scripts/install-mcp-server-dev-launchd.sh"');
    expect(packageJson).toContain('"stock-news:coverage:export": "node scripts/export-stock-news-coverage.mjs"');
    expect(packageJson).toContain(
      '"news:translation:verify": "node scripts/verify-news-translation.mjs --env-file .env.mac-worker.production"',
    );
    expect(packageJson).toContain('"@modelcontextprotocol/sdk"');

    expect(restartCompose).toContain("restart reverse-proxy web");
    expect(restartCompose).not.toContain("restart reverse-proxy web agent-worker");
  });

  it("keeps dev data publish local and catalog-only", () => {
    const script = read("scripts/deploy-dev-data-release.sh");
    const packageJson = read("package.json");
    const commandDocs = read("docs/DEPLOY_COMMANDS.md");

    expect(packageJson).toContain('"dev:catalog": "scripts/deploy-dev-data-release.sh"');
    expect(packageJson).toContain('"dev:data": "scripts/deploy-dev-data-release.sh"');
    expect(packageJson).toContain('"dev:runtime": "scripts/deploy-dev-runtime.sh"');
    expect(packageJson).toContain('"dev:release": "scripts/deploy-dev-data-release.sh"');
    expect(packageJson).toContain('"dev:release:publish": "scripts/deploy-dev-data-release.sh"');
    expect(commandDocs).toContain("npm run dev:runtime");
    expect(commandDocs).toContain("npm run dev:release:publish -- --release-id <release_id>");
    expect(commandDocs).toContain("npm run prod:release:publish -- --release-id <release_id>");
    expect(commandDocs).toContain("deploy:data             -> prod:release:publish");

    expect(script).toContain("release export-web-catalog");
    expect(script).toContain("publish-web-catalog.mjs");
    expect(script).toContain("verify-web-catalog-release.mjs");
    expect(script).toContain("--env dev");
    expect(script).toContain("release promote \"$RELEASE_ID\"");
    expect(script).toContain("--releases-root \"$RELEASES_ROOT\"");
    expect(script).toContain("ensure_local_supabase_env");
    expect(script).toContain("KRW_DEV_ALLOW_REMOTE_SUPABASE");
    expect(script).toContain("local Supabase");
    expect(script).not.toContain("deploy-worker-production.sh");
    expect(script).not.toContain("gcloud");
    expect(script).not.toContain(".env.mac-worker.production");
    expect(script).not.toContain("--env prod");
  });

  it("publishes ontology data as Supabase web catalog and keeps full SQLite local", () => {
    const script = read("scripts/deploy-data-release-production.sh");
    const publishScript = read("scripts/publish-web-catalog.mjs");
    const verifyScript = read("scripts/verify-web-catalog-release.mjs");

    expect(script).toContain("release export-web-catalog");
    expect(script).toContain("publish-web-catalog.mjs");
    expect(script).toContain("verify-web-catalog-release.mjs");
    expect(script).toContain("deploy-worker-production.sh");
    expect(script).toContain("--release-id \"$ACTIVE_RELEASE_ID\"");
    expect(script).toContain("This script does not upload full ontology data to GCP");
    expect(script).not.toContain("gcloud");
    expect(script).not.toContain("/srv/krw-ontology-data");

    expect(publishScript).toContain("publish_ontology_web_catalog");
    expect(publishScript).toContain("ontology_catalog_releases");
    expect(publishScript).toContain("ontology_companies");
    expect(publishScript).toContain("krw-ontology-web-catalog/v1");

    expect(verifyScript).toContain("ontology_catalog_releases");
    expect(verifyScript).toContain("Active web catalog mismatch");
  });

  it("validates agent-worker after VM compose deployments", () => {
    const script = read("scripts/deploy-vm-compose.sh");

    expect(script).toContain("ps -q agent-worker");
    expect(script).toContain("agent-worker did not become healthy");
    expect(script).toContain("exec -T agent-worker node");
    expect(script).toContain(".worker/agent-worker.mjs");
    expect(script).toContain("KRW_ONTOLOGY_PLUGIN_PATH");
    expect(script).toContain("OK web ontology data boundary: Supabase catalog only");
  });

  it("requires live Toss keys for paid production readiness", () => {
    const deployVm = read("scripts/deploy-vm-compose.sh");
    const readiness = read("scripts/verify-billing-production-readiness.sh");
    const billingContract = read("docs/billing-credit-contract.md");
    const commandDocs = read("docs/DEPLOY_COMMANDS.md");

    expect(deployVm).toContain("ALLOW_MISSING_TOSS_PAYMENTS");
    expect(deployVm).toContain("ALLOW_TOSS_TEST_KEYS");
    expect(deployVm).toContain("require_env_exact ANALYSIS_CREDIT_ENFORCEMENT_MODE enforced");
    expect(deployVm).toContain("require_toss_payments_key");
    expect(deployVm).toContain("live_ck_");
    expect(deployVm).toContain("live_sk_");

    expect(readiness).toContain("/api/billing/toss/checkout");
    expect(readiness).toContain("401");
    expect(readiness).toContain("ANALYSIS_CREDIT_ENFORCEMENT_MODE");
    expect(readiness).toContain("TOSS_PAYMENTS_CLIENT_KEY");
    expect(readiness).toContain("billing-worker");

    expect(billingContract).toContain("Production Readiness Gate");
    expect(billingContract).toContain("npm run billing:prod:readiness");
    expect(billingContract).toContain("live_sk_");
    expect(commandDocs).toContain("Production billing");
    expect(commandDocs).toContain("scripts/restart-production-compose.sh");
    expect(commandDocs).toContain("npm run billing:prod:readiness");
  });

  it("passes all production deploy switches through the safe queue wrapper", () => {
    const script = read("scripts/deploy-with-queue-pause.sh");

    for (const flag of [
      "--apply-migrations",
      "--skip-data",
      "--skip-code",
      "--skip-db-check",
      "--skip-worker-restart",
    ]) {
      expect(script).toContain(flag);
      expect(script).toContain(`DEPLOY_ARGS="$DEPLOY_ARGS ${flag}"`);
    }
    expect(script).toContain("--release-id");
    expect(script).toContain("DEPLOY_ARGS=\"$DEPLOY_ARGS --release-id $1\"");
    expect(script).toContain("--no-publish-prod");
    expect(script).toContain("--no-refresh-index");
    expect(script).not.toContain("--no-rebuild-agent-index");
    expect(script).toContain("ONTOLOGY_SOURCE_DIR=");
    expect(script).toContain("uv run krw-ontology");
    expect(script).toContain("queue status --root \"$QUEUE_ROOT\" --json");
    expect(script).toContain("assert_queue_stopped_and_safe");
    expect(script).toContain("Local ontology queue can mutate prod/current");
    expect(script).toContain("Warning: queue has");
    expect(script).not.toContain("grep -q 'running=0'");
    expect(script).not.toContain("QUEUE_PUBLISH_PROD");
    expect(script).not.toContain("agent_index.sqlite");
  });

  it("defines a compose healthcheck for agent-worker", () => {
    const compose = read("docker-compose.yml");
    const webSection = compose.slice(
      compose.indexOf("  web:"),
      compose.indexOf("  agent-worker:"),
    );
    const workerSection = compose.slice(compose.indexOf("  agent-worker:"));

    expect(compose).toContain(
      "AGENT_RUN_HARD_TIMEOUT_MINUTES=${AGENT_RUN_HARD_TIMEOUT_MINUTES:-6}",
    );
    expect(compose).toContain("LEASE_TIMEOUT_MINUTES=${LEASE_TIMEOUT_MINUTES:-10}");
    expect(workerSection).toContain(
      "LEASE_HEARTBEAT_INTERVAL_MS=${LEASE_HEARTBEAT_INTERVAL_MS:-30000}",
    );
    expect(webSection).toContain(
      "AGENT_RUN_EVENT_LISTEN_DATABASE_URL=${AGENT_RUN_EVENT_LISTEN_DATABASE_URL:-}",
    );
    expect(webSection).toContain(
      "AGENT_EVENT_RECONCILE_INTERVAL_MS=${AGENT_EVENT_RECONCILE_INTERVAL_MS:-15000}",
    );
    expect(workerSection).toContain(
      "AGENT_QUEUE_LISTEN_DATABASE_URL=${AGENT_QUEUE_LISTEN_DATABASE_URL:-}",
    );
    expect(workerSection).toContain(
      "AGENT_QUEUE_RECONCILE_INTERVAL_MS=${AGENT_QUEUE_RECONCILE_INTERVAL_MS:-60000}",
    );
    expect(workerSection).toContain(
      "AGENT_RUN_CANCEL_LISTEN_DATABASE_URL=${AGENT_RUN_CANCEL_LISTEN_DATABASE_URL:-}",
    );
    expect(workerSection).toContain(
      "AGENT_RUN_CANCEL_RECONCILE_INTERVAL_MS=${AGENT_RUN_CANCEL_RECONCILE_INTERVAL_MS:-10000}",
    );
    expect(workerSection).not.toContain("AGENT_WORKER_POLL_INTERVAL_MS");
    expect(workerSection).toContain("healthcheck:");
    expect(workerSection).toContain(".worker/agent-worker.mjs");
    expect(workerSection).toContain("global_spine.sqlite");
    expect(workerSection).toContain("shard_manifest.json");
    expect(workerSection).not.toContain("agent_index.sqlite");
    expect(workerSection).toContain(".mcp.json");
    const billingWorkerSection = compose.slice(compose.indexOf("  billing-worker:"));
    expect(billingWorkerSection).toContain(
      "BILLING_WORKER_REQUIRE_TOSS_PAYMENTS=${BILLING_WORKER_REQUIRE_TOSS_PAYMENTS:-1}",
    );
    expect(billingWorkerSection).toContain("live_ck_");
    expect(billingWorkerSection).toContain("live_sk_");
    expect(webSection).not.toContain("KRW_ONTOLOGY_RELEASE_ROOT");
    expect(webSection).not.toContain("agent_index.sqlite");
    expect(webSection).not.toContain("/srv/krw-ontology-data:/srv/krw-ontology-data");
    const dockerfileWeb = read("Dockerfile.web");
    expect(dockerfileWeb).toContain(
      '"/opt/krw-ontology-venv/bin/krw-ontology-mcp"',
    );
    expect(dockerfileWeb).not.toContain('"stock-news"');
    expect(dockerfileWeb).not.toContain('"http://127.0.0.1:8775/mcp"');
    expect(dockerfileWeb).not.toContain("krw-ontology-mcp-stdio");
  });

  it("keeps Mac worker cutover scripts conservative", () => {
    const preflight = read("scripts/mac-worker-preflight.sh");
    const start = read("scripts/start-mac-worker-production.sh");
    const installLaunchd = read("scripts/install-mac-worker-launchd.sh");
    const uninstallLaunchd = read("scripts/uninstall-mac-worker-launchd.sh");
    const startMcp = read("scripts/start-mcp-server-production.sh");
    const installMcpLaunchd = read("scripts/install-mcp-server-launchd.sh");
    const verifyMcp = read("scripts/verify-mcp-server-production.sh");
    const uninstallMcpLaunchd = read("scripts/uninstall-mcp-server-launchd.sh");
    const deployWorker = read("scripts/deploy-worker-production.sh");
    const deployPluginWorker = read("scripts/deploy-plugin-worker-production.sh");
    const verifyHeartbeats = read("scripts/verify-mac-worker-heartbeats.mjs");
    const statusWorkers = read("scripts/status-production-workers.sh");
    const stopGcp = read("scripts/stop-gcp-agent-worker.sh");
    const startGcp = read("scripts/start-gcp-agent-worker.sh");
    const packageJson = read("package.json");

    expect(preflight).toContain("GLOBAL_CONCURRENT_RUN_LIMIT");
    expect(preflight).toContain("AGENT_SUPERVISOR_CONCURRENCY");
    expect(preflight).toContain(
      "GLOBAL_CONCURRENT_RUN_LIMIT must be at least AGENT_SUPERVISOR_CONCURRENCY",
    );
    expect(preflight).toContain("queue status");
    expect(preflight).toContain("--json");
    expect(preflight).toContain("Local ontology queue can mutate prod/current");
    expect(preflight).toContain("OK local ontology queue status via CLI");
    expect(preflight).toContain("A Mac agent supervisor with id");
    expect(preflight).toContain("--skip-worker-duplicate-check");
    expect(preflight).toContain("Checking Postgres LISTEN config");
    expect(preflight).toContain("AGENT_QUEUE_LISTEN_DATABASE_URL");
    expect(preflight).toContain("OK Postgres LISTEN smoke");
    expect(preflight).toContain("await client.query(`LISTEN ${listenChannel}`)");
    expect(preflight).toContain("Checking news translation readiness");
    expect(preflight).toContain("verify-news-translation.mjs");
    expect(preflight).toContain("Missing Claude auth after placeholder cleanup");
    expect(preflight).toContain("ANTHROPIC_AUTH_TOKEN");
    expect(preflight).toContain("EXPECTED_CLAUDE_CODE_VERSION");
    expect(preflight).toContain("KRW_ONTOLOGY_ENV=prod");
    expect(preflight).toContain("/releases/prod/current");
    expect(preflight).toContain("krw-ontology release verify");
    expect(preflight).toContain("manifest_valid");
    expect(preflight).toContain("KRW_ONTOLOGY_MCP_URL");
    expect(preflight).toContain("Plugin .mcp.json MCP URL mismatch");
    expect(preflight).toContain("MCP HTTP health is not ok");
    expect(preflight).toContain("global_spine_present");
    expect(preflight).toContain("health_payload");
    expect(preflight).toContain("agent_runs");

    expect(start).toContain("MAC_WORKER_LOCK_DIR");
    expect(start).toContain("Removing stale Mac worker lock");
    expect(start).toContain("safe_worker_id");
    expect(start).toContain("--worker-id");
    expect(start).toContain("--log-file");
    expect(start).toContain("AGENT_SUPERVISOR_ID");
    expect(start).toContain("AGENT_SUPERVISOR_CONCURRENCY");
    expect(start).toContain("DEEPSEEK_API_KEY");
    expect(start).toContain("mac-worker-preflight.sh");
    expect(start).toContain(".worker/agent-worker.mjs");
    expect(start).toContain(">> \"$LOG_FILE\" 2>&1");

    const initEnv = read("scripts/init-mac-worker-env.sh");
    expect(initEnv).toContain("~/.local/bin/claude-krw");
    expect(initEnv).toContain("EXPECTED_CLAUDE_CODE_VERSION=2.1.141");
    expect(initEnv).toContain("KRW_ONTOLOGY_QUEUE_ROOT=~/krw-ontology-data-running");
    expect(initEnv).toContain("$HOME/krw-ontology");
    expect(initEnv).toContain("ref/plugins/prod/krw-ontology");
    expect(initEnv).toContain("KRW_ONTOLOGY_PLUGIN_SOURCE_PATH");
    expect(initEnv).toContain("KRW_ONTOLOGY_MCP_URL=http://127.0.0.1:8765/mcp");
    expect(initEnv).toContain("KRW_ONTOLOGY_MCP_HEALTH_URL=http://127.0.0.1:8765/health");
    expect(initEnv).toContain("AGENT_SUPERVISOR_ID=mac-supervisor-jwc");
    expect(initEnv).toContain("AGENT_SUPERVISOR_CONCURRENCY=1");
    expect(initEnv).toContain("MAC_WORKER_COUNT=1");
    expect(initEnv).toContain("MAC_WORKER_NICE=-5");
    expect(initEnv).toContain("MCP_SERVER_NICE=-5");
    expect(initEnv).toContain("GLOBAL_CONCURRENT_RUN_LIMIT=1");
    expect(initEnv).toContain("AGENT_QUEUE_LISTEN_ENABLED=1");
    expect(initEnv).toContain("AGENT_QUEUE_RECONCILE_INTERVAL_MS=60000");
    expect(initEnv).toContain("AGENT_RUN_CANCEL_LISTEN_ENABLED=1");
    expect(initEnv).toContain("AGENT_RUN_CANCEL_RECONCILE_INTERVAL_MS=10000");
    expect(initEnv).toContain("AGENT_SUPERVISOR_SHUTDOWN_GRACE_MS=120000");
    expect(initEnv).toContain("NEWS_TRANSLATION_TIMEOUT_MS=7000");
    expect(initEnv).toContain("KRW_SQLITE_READ_CACHE_MIB=512");
    expect(initEnv).toContain("KRW_SQLITE_READ_MMAP_MIB=2048");

    expect(installLaunchd).toContain("mac-worker-preflight.sh");
    expect(installLaunchd).toContain("--env-file");
    expect(installLaunchd).toContain("__ENV_FILE__");
    expect(installLaunchd).toContain("AGENT_SUPERVISOR_CONCURRENCY");
    expect(installLaunchd).toContain("MAC_WORKER_NICE");
    expect(installLaunchd).toContain("__NICE__");
    expect(installLaunchd).toContain('LABEL="com.krwontology.agent-worker"');
    expect(installLaunchd).toContain("launchd should not start one process per slot");
    expect(installLaunchd).toContain("sending SIG$signal");
    expect(installLaunchd).toContain(
      "wait_for_worker_id_to_stop \"$AGENT_SUPERVISOR_ID\" KILL",
    );
    expect(installLaunchd).toContain("legacy_worker_id");
    expect(read("ops/launchd/com.krwontology.agent-worker.plist.template")).toContain(
      "--skip-preflight",
    );
    expect(read("ops/launchd/com.krwontology.agent-worker.plist.template")).toContain(
      "<key>Nice</key>",
    );
    expect(installLaunchd).toContain("launchctl bootstrap");
    expect(installLaunchd).toContain("launchctl kickstart");
    expect(uninstallLaunchd).toContain("launchctl bootout");
    expect(uninstallLaunchd).toContain("com.krwontology.agent-worker*.plist");

    expect(startMcp).toContain("krw-ontology-mcp");
    expect(startMcp).toContain("--env prod");
    expect(startMcp).toContain("--store-mode");
    expect(startMcp).toContain("--log-file");
    expect(startMcp).toContain("--require-current-symlink");
    const legacyMcpCommand = ["krw", "ontology", "mcp", "http"].join("-");
    expect(startMcp).not.toContain(legacyMcpCommand);
    expect(startMcp).toContain("--mcp-path");
    expect(startMcp).toContain("KRW_ONTOLOGY_MCP_PORT");
    expect(read("scripts/start-mcp-server-dev.sh")).toContain("KRW_ONTOLOGY_MCP_PORT=${KRW_ONTOLOGY_MCP_PORT:-8766}");
    expect(read("scripts/start-mcp-server-dev.sh")).toContain("--env dev");
    expect(read("scripts/start-mcp-server-dev.sh")).toContain("mcp-dev.log");
    expect(read("scripts/verify-mcp-server-dev.sh")).toContain("MCP dev health env is not dev");
    expect(read("scripts/install-mcp-server-dev-launchd.sh")).toContain(
      "com.krwontology.mcp-server-dev",
    );
    expect(read("ops/launchd/com.krwontology.mcp-server-dev.plist.template")).toContain(
      "mcp-dev.err.log",
    );
    expect(read("scripts/materialize-ontology-plugin.mjs")).toContain('"plugins"');
    expect(read("scripts/materialize-ontology-plugin.mjs")).toContain('"krw-ontology"');
    expect(verifyMcp).toContain("KRW_ONTOLOGY_MCP_HEALTH_URL");
    expect(verifyMcp).toContain("MCP health env is not prod");
    expect(installMcpLaunchd).toContain("com.krwontology.mcp-server");
    expect(installMcpLaunchd).toContain("verify-mcp-server-production.sh");
    expect(installMcpLaunchd).toContain("MCP_SERVER_NICE");
    expect(installMcpLaunchd).toContain("MCP_LOG_DIR");
    expect(installMcpLaunchd).toContain("MCP_SERVER_MAXFILES");
    expect(uninstallMcpLaunchd).toContain("com.krwontology.mcp-server.plist");
    expect(read("ops/launchd/com.krwontology.mcp-server.plist.template")).toContain(
      "start-mcp-server-production.sh",
    );
    expect(read("ops/launchd/com.krwontology.mcp-server.plist.template")).toContain(
      "SoftResourceLimits",
    );
    expect(read("ops/launchd/com.krwontology.mcp-server.plist.template")).toContain(
      "__LOG_DIR__/mcp-prod.err.log",
    );
    expect(read("ref/plugins/prod/krw-ontology/.mcp.json")).toContain(
      '"type": "http"',
    );
    expect(read("ref/plugins/prod/krw-ontology/.mcp.json")).toContain(
      '"url": "http://127.0.0.1:8765/mcp"',
    );
    expect(read("ref/plugins/dev/krw-ontology/.mcp.json")).toContain(
      '"url": "http://127.0.0.1:8766/mcp"',
    );

    expect(deployWorker).toContain("install-mac-worker-launchd.sh");
    expect(deployWorker).toContain("verify-mac-worker-heartbeats.mjs");
    expect(deployWorker).toContain("does not deploy or restart the GCP web container");
    expect(deployWorker).toContain("MCP HTTP server must already be healthy");

    expect(deployPluginWorker).toContain("KRW_ONTOLOGY_PLUGIN_PATH mismatch");
    expect(deployPluginWorker).toContain("materialize-ontology-plugin.mjs");
    expect(deployPluginWorker).toContain("export-stock-news-coverage.mjs");
    expect(deployPluginWorker).toContain("stock-news/coverage_companies.json");
    expect(deployPluginWorker).toContain("install-mcp-server-launchd.sh");
    expect(deployPluginWorker).toContain("install-stock-news-mcp-launchd.sh");
    expect(deployPluginWorker).toContain("deploy-worker-production.sh");
    expect(deployPluginWorker).toContain("Checking news translation readiness");
    expect(deployPluginWorker).toContain("verify-news-translation.mjs");
    expect(deployPluginWorker).not.toContain(
      "News discovery will still work, but fallback cards may stay in English",
    );
    expect(deployPluginWorker).toContain("does not sync plugin code to the GCP VM");
    expect(read("scripts/export-stock-news-coverage.mjs")).toContain("ontology_companies");
    expect(read("scripts/start-stock-news-mcp-production.sh")).toContain("STOCK_NEWS_COVERAGE_PATH");
    expect(read("scripts/start-stock-news-mcp-dev.sh")).toContain("STOCK_NEWS_COVERAGE_PATH");

    expect(verifyHeartbeats).toContain("agent_worker_heartbeats");
    expect(verifyHeartbeats).toContain("EXPECTED_CLAUDE_CODE_VERSION");
    expect(verifyHeartbeats).toContain("--release-id");
    expect(verifyHeartbeats).toContain("OK Mac supervisor heartbeat");
    expect(statusWorkers).toContain("nice=");
    expect(statusWorkers).toContain("AGENT_SUPERVISOR_CONCURRENCY");
    expect(statusWorkers).toContain("AGENT_RUN_CANCEL_RECONCILE_INTERVAL_MS");
    expect(statusWorkers).toContain("NEWS_TRANSLATION_PYTHON");
    expect(statusWorkers).toContain("verify-news-translation.mjs");
    expect(statusWorkers).toContain("MAC_WORKER_NICE");

    expect(stopGcp).toContain("stop agent-worker");
    expect(stopGcp).toContain("OK GCP agent-worker stopped");

    expect(startGcp).toContain("up -d agent-worker");
    expect(startGcp).toContain("agent-worker did not become healthy");

    expect(packageJson).toContain("worker:mac:preflight");
    expect(packageJson).toContain("worker:prod:stop-gcp");
    expect(packageJson).toContain("worker:prod:start-gcp");
    expect(packageJson).toContain("mcp:prod:launchd:install");
    expect(packageJson).toContain("deploy:worker");
  });

  it("keeps local dev worker on the dev ontology release by default", () => {
    const devScript = read("scripts/dev-with-worker.mjs");
    const mcpClient = read("src/lib/agent/mcp-client.ts");

    expect(devScript).toContain("configureDevOntologyEnv");
    expect(devScript).toContain("materializeDevPlugin");
    expect(devScript).toContain("exportDevStockNewsCoverage");
    expect(devScript).toContain("ensureDevMcpServer");
    expect(devScript).toContain("expectedStockNewsCoverageCount");
    expect(devScript).toContain("http://127.0.0.1:8766/mcp");
    expect(devScript).toContain("ref\", \"plugins\", \"dev\", \"krw-ontology");
    expect(devScript).toContain("homedir()");
    expect(devScript).toContain('process.env.KRW_ONTOLOGY_ENV = "dev"');
    expect(devScript).toContain('"krw-ontology-data"');
    expect(devScript).toContain('"releases"');
    expect(devScript).toContain('"dev"');
    expect(devScript).toContain('"current"');
    expect(devScript).toContain("isProdReleaseRoot");
    expect(devScript).toContain("KRW_DEV_ALLOW_PROD_ONTOLOGY");
    expect(devScript).toContain("KRW_ONTOLOGY_GLOBAL_SPINE_PATH");
    expect(devScript).toContain("KRW_ONTOLOGY_SHARD_MANIFEST_PATH");
    expect(devScript).toContain("KRW_DEV_WORKER_NICE");
    expect(devScript).toContain('["-n", String(devWorkerNice), process.execPath, workerOutfile]');
    expect(devScript).toContain('stdio: ["pipe", "inherit", "inherit"]');

    const serverConfigSpread = mcpClient.indexOf("...(serverConfig.env ?? {})");
    const processEnvSpread = mcpClient.indexOf("...process.env", serverConfigSpread);
    expect(serverConfigSpread).toBeGreaterThan(-1);
    expect(processEnvSpread).toBeGreaterThan(serverConfigSpread);
    expect(mcpClient).toContain('path.join(root, "manifest.json")');
    expect(mcpClient).toContain('path.join(root, "indexes", "global_spine.sqlite")');
    expect(mcpClient).toContain('path.join(root, "indexes", "shard_manifest.json")');
  });
});
