import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("production deploy scripts", () => {
  it("keeps legacy GCP agent-worker stopped during ontology data switches", () => {
    const script = read("scripts/deploy-data-production.sh");

    expect(script).toContain("stop agent-worker web");
    expect(script).toContain("stop agent-worker || true");
    expect(script).toContain("up -d web");
    expect(script).toContain("restart web");
    expect(script).not.toContain("up -d web agent-worker");
    expect(script).not.toContain("restart web agent-worker");
    expect(script).not.toContain("exec -T agent-worker node");
    expect(script).toContain("https://www.krwontology.com/api/healthz");
  });

  it("routes production code deploys through split web and Mac worker lanes", () => {
    const deployProd = read("scripts/deploy-production.sh");
    const deployAll = read("scripts/deploy-all-production.sh");
    const packageJson = read("package.json");
    const restartCompose = read("scripts/restart-production-compose.sh");

    expect(deployProd).toContain("deploy-web-production.sh");
    expect(deployProd).toContain("deploy-plugin-worker-production.sh");
    expect(deployProd).toContain("npx supabase db push --dry-run");
    expect(deployProd).toContain("npm run supabase:schema:smoke");
    expect(deployProd).toContain("intentionally does not start the GCP agent-worker");

    expect(deployAll).toContain("deploy-web-production.sh");
    expect(deployAll).toContain("deploy-plugin-worker-production.sh");
    expect(deployAll).toContain("deploy-data-release-production.sh");
    expect(deployAll).toContain("Mac worker/plugin validation");

    expect(packageJson).toContain('"deploy:data": "scripts/deploy-data-release-production.sh"');
    expect(packageJson).toContain('"deploy:worker": "scripts/deploy-worker-production.sh"');
    expect(packageJson).toContain('"deploy:plugin": "scripts/deploy-plugin-worker-production.sh"');
    expect(packageJson).toContain('"deploy:mcp": "scripts/deploy-plugin-worker-production.sh"');
    expect(packageJson).toContain('"deploy:plugin:gcp": "scripts/deploy-plugin-production.sh"');
    expect(packageJson).toContain('"deploy:legacy:gcp-mcp": "scripts/deploy-plugin-production.sh"');
    expect(packageJson).toContain('"deploy:legacy:data-gcp": "scripts/deploy-data-production.sh"');
    expect(packageJson).toContain('"publish:web-catalog": "node scripts/publish-web-catalog.mjs"');
    expect(packageJson).toContain('"verify:web-catalog": "node scripts/verify-web-catalog-release.mjs"');
    expect(packageJson).toContain('"mcp:prod:start": "scripts/start-mcp-server-production.sh"');
    expect(packageJson).toContain('"mcp:prod:verify": "scripts/verify-mcp-server-production.sh"');
    expect(packageJson).toContain('"mcp:prod:launchd:install": "scripts/install-mcp-server-launchd.sh"');
    expect(packageJson).toContain('"mcp:dev:start": "scripts/start-mcp-server-dev.sh"');
    expect(packageJson).toContain('"mcp:dev:verify": "scripts/verify-mcp-server-dev.sh"');

    expect(restartCompose).toContain("restart reverse-proxy web");
    expect(restartCompose).not.toContain("restart reverse-proxy web agent-worker");
  });

  it("keeps dev data publish local and catalog-only", () => {
    const script = read("scripts/deploy-dev-data-release.sh");
    const packageJson = read("package.json");

    expect(packageJson).toContain('"dev:catalog": "scripts/deploy-dev-data-release.sh"');
    expect(packageJson).toContain('"dev:data": "scripts/deploy-dev-data-release.sh"');

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
    expect(script).toContain("--no-rebuild-agent-index");
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
    expect(workerSection).toContain("healthcheck:");
    expect(workerSection).toContain(".worker/agent-worker.mjs");
    expect(workerSection).toContain("agent_index.sqlite");
    expect(workerSection).toContain(".mcp.json");
    expect(webSection).not.toContain("KRW_ONTOLOGY_RELEASE_ROOT");
    expect(webSection).not.toContain("agent_index.sqlite");
    expect(webSection).not.toContain("/srv/krw-ontology-data:/srv/krw-ontology-data");
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
    expect(preflight).toContain("MAC_WORKER_COUNT");
    expect(preflight).toContain("GLOBAL_CONCURRENT_RUN_LIMIT must be at least MAC_WORKER_COUNT");
    expect(preflight).toContain("queue status");
    expect(preflight).toContain("--json");
    expect(preflight).toContain("Local ontology queue can mutate prod/current");
    expect(preflight).toContain("OK local ontology queue status via CLI");
    expect(preflight).toContain("A Mac agent worker with id");
    expect(preflight).toContain("--skip-worker-duplicate-check");
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
    expect(preflight).toContain("idx_company_topic_scope");
    expect(preflight).toContain("health_payload");
    expect(preflight).toContain("agent_runs");

    expect(start).toContain("MAC_WORKER_LOCK_DIR");
    expect(start).toContain("Removing stale Mac worker lock");
    expect(start).toContain("safe_worker_id");
    expect(start).toContain("--worker-id");
    expect(start).toContain("--log-file");
    expect(start).toContain("DEEPSEEK_API_KEY");
    expect(start).toContain("mac-worker-preflight.sh");
    expect(start).toContain(".worker/agent-worker.mjs");
    expect(start).toContain(">> \"$LOG_FILE\" 2>&1");

    const initEnv = read("scripts/init-mac-worker-env.sh");
    expect(initEnv).toContain("~/.local/bin/claude-krw");
    expect(initEnv).toContain("EXPECTED_CLAUDE_CODE_VERSION=2.1.111");
    expect(initEnv).toContain("KRW_ONTOLOGY_QUEUE_ROOT=~/krw-ontology-data-running");
    expect(initEnv).toContain("$HOME/krw-ontology");
    expect(initEnv).toContain("ref/plugins/prod/krw-ontology");
    expect(initEnv).toContain("KRW_ONTOLOGY_PLUGIN_SOURCE_PATH");
    expect(initEnv).toContain("KRW_ONTOLOGY_MCP_URL=http://127.0.0.1:8765/mcp");
    expect(initEnv).toContain("KRW_ONTOLOGY_MCP_HEALTH_URL=http://127.0.0.1:8765/health");
    expect(initEnv).toContain("MAC_WORKER_COUNT=5");
    expect(initEnv).toContain("MAC_WORKER_NICE=-5");
    expect(initEnv).toContain("MCP_SERVER_NICE=-5");
    expect(initEnv).toContain("GLOBAL_CONCURRENT_RUN_LIMIT=5");
    expect(initEnv).toContain("KRW_SQLITE_READ_CACHE_MIB=512");
    expect(initEnv).toContain("KRW_SQLITE_READ_MMAP_MIB=2048");

    expect(installLaunchd).toContain("mac-worker-preflight.sh");
    expect(installLaunchd).toContain("--env-file");
    expect(installLaunchd).toContain("__ENV_FILE__");
    expect(installLaunchd).toContain("MAC_WORKER_COUNT");
    expect(installLaunchd).toContain("MAC_WORKER_NICE");
    expect(installLaunchd).toContain("__NICE__");
    expect(installLaunchd).toContain("com.krwontology.agent-worker.$index");
    expect(installLaunchd).toContain("sending SIG$signal");
    expect(installLaunchd).toContain("wait_for_worker_id_to_stop \"$worker_id\" KILL");
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

    expect(startMcp).toContain("krw-ontology-mcp-http");
    expect(startMcp).toContain("--mcp-path");
    expect(startMcp).toContain("KRW_ONTOLOGY_MCP_PORT");
    expect(read("scripts/start-mcp-server-dev.sh")).toContain("KRW_ONTOLOGY_MCP_PORT=${KRW_ONTOLOGY_MCP_PORT:-8766}");
    expect(read("scripts/verify-mcp-server-dev.sh")).toContain("MCP dev health env is not dev");
    expect(read("scripts/materialize-ontology-plugin.mjs")).toContain('"plugins"');
    expect(read("scripts/materialize-ontology-plugin.mjs")).toContain('"krw-ontology"');
    expect(verifyMcp).toContain("KRW_ONTOLOGY_MCP_HEALTH_URL");
    expect(verifyMcp).toContain("MCP health env is not prod");
    expect(installMcpLaunchd).toContain("com.krwontology.mcp-server");
    expect(installMcpLaunchd).toContain("verify-mcp-server-production.sh");
    expect(installMcpLaunchd).toContain("MCP_SERVER_NICE");
    expect(uninstallMcpLaunchd).toContain("com.krwontology.mcp-server.plist");
    expect(read("ops/launchd/com.krwontology.mcp-server.plist.template")).toContain(
      "start-mcp-server-production.sh",
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
    expect(deployWorker).toContain("long-running MCP");

    expect(deployPluginWorker).toContain("KRW_ONTOLOGY_PLUGIN_PATH mismatch");
    expect(deployPluginWorker).toContain("materialize-ontology-plugin.mjs");
    expect(deployPluginWorker).toContain("install-mcp-server-launchd.sh");
    expect(deployPluginWorker).toContain("deploy-worker-production.sh");
    expect(deployPluginWorker).toContain("does not sync plugin code to the GCP VM");

    expect(verifyHeartbeats).toContain("agent_worker_heartbeats");
    expect(verifyHeartbeats).toContain("EXPECTED_CLAUDE_CODE_VERSION");
    expect(verifyHeartbeats).toContain("--release-id");
    expect(verifyHeartbeats).toContain("OK Mac worker heartbeats");
    expect(statusWorkers).toContain("nice=");
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
    expect(devScript).toContain("ensureDevMcpServer");
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
    expect(devScript).toContain("KRW_ONTOLOGY_INDEX_PATH");
    expect(devScript).toContain("KRW_DEV_WORKER_NICE");
    expect(devScript).toContain('["-n", String(devWorkerNice), process.execPath, workerOutfile]');
    expect(devScript).toContain('stdio: ["pipe", "inherit", "inherit"]');

    const serverConfigSpread = mcpClient.indexOf("...(serverConfig.env ?? {})");
    const processEnvSpread = mcpClient.indexOf("...process.env", serverConfigSpread);
    expect(serverConfigSpread).toBeGreaterThan(-1);
    expect(processEnvSpread).toBeGreaterThan(serverConfigSpread);
    expect(mcpClient).toContain('path.join(root, "manifest.json")');
    expect(mcpClient).toContain('path.join(root, "indexes", "agent_index.sqlite")');
  });
});
