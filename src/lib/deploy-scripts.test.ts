import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("production deploy scripts", () => {
  it("keeps candidate MCP runtimes isolated and rolls failed installs back", () => {
    const startCandidate = read("scripts/start-mcp-server-candidate.sh");
    const verifyCandidate = read("scripts/verify-mcp-server-candidate.sh");
    const installCandidate = read(
      "scripts/install-mcp-server-candidate-launchd.sh",
    );

    expect(startCandidate).toContain("EXPECTED_RUNTIME_ROOT");
    expect(verifyCandidate).toContain("EXPECTED_RUNTIME_ROOT");
    expect(installCandidate).toContain(
      "com.krwontology.mcp-server-candidate",
    );
    expect(installCandidate).toContain("cleanup_failed_install");
    expect(installCandidate).toContain(
      '"$KRW_LAUNCHCTL_BIN" bootout "$DOMAIN/$LABEL"',
    );
    expect(installCandidate).toContain('rm -f "$RUNTIME_ROOT"');
    expect(installCandidate).toContain('rm -f "$PLIST"');

    const root = mkdtempSync(join(tmpdir(), "krw-mcp-candidate-test-"));
    try {
      const release = join(root, "data", "releases", "prod", "20260712_021509");
      const canonicalCurrent = join(root, "data", "releases", "prod", "current");
      const plugin = join(root, "plugin");
      const source = join(root, "ontology-source");
      const home = join(root, "home");
      const fakeBin = join(home, ".local", "bin");
      const launchctlLog = join(root, "launchctl.log");
      mkdirSync(release, { recursive: true });
      symlinkSync(release, canonicalCurrent);
      mkdirSync(plugin, { recursive: true });
      writeFileSync(join(plugin, ".krw-ontology-contract.json"), "{}\n");
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "pyproject.toml"), "[project]\nname='fake'\n");
      mkdirSync(fakeBin, { recursive: true });

      const rejected = spawnSync(
        "/bin/sh",
        [
          "scripts/start-mcp-server-candidate.sh",
          "--release-root",
          release,
          "--runtime-root",
          canonicalCurrent,
        ],
        { encoding: "utf8" },
      );
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain(
        "must use the isolated candidate runtime path",
      );

      for (const [name, body] of [
        ["uv", "#!/bin/sh\nexit 0\n"],
        ["plutil", "#!/bin/sh\nexit 0\n"],
        ["lsof", "#!/bin/sh\nexit 1\n"],
        ["node", "#!/bin/sh\nexit 1\n"],
        [
          "launchctl",
          `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(launchctlLog)}\nexit 0\n`,
        ],
      ] as const) {
        const path = join(fakeBin, name);
        writeFileSync(path, body);
        chmodSync(path, 0o755);
      }

      const envFile = join(root, "candidate.env");
      writeFileSync(
        envFile,
        [
          `KRW_ONTOLOGY_SOURCE_DIR=${source}`,
          `KRW_ONTOLOGY_UV_BIN=${join(fakeBin, "uv")}`,
          `KRW_LAUNCHCTL_BIN=${join(fakeBin, "launchctl")}`,
          `KRW_PLUTIL_BIN=${join(fakeBin, "plutil")}`,
          `KRW_LSOF_BIN=${join(fakeBin, "lsof")}`,
          "",
        ].join("\n"),
      );
      const failedInstall = spawnSync(
        "/bin/sh",
        [
          "scripts/install-mcp-server-candidate-launchd.sh",
          "--release-root",
          release,
          "--plugin-path",
          plugin,
          "--env-file",
          envFile,
          "--port",
          "18865",
          "--load",
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            HOME: home,
            MCP_CANDIDATE_VERIFY_ATTEMPTS: "1",
            MCP_CANDIDATE_VERIFY_INTERVAL_SECONDS: "0",
          },
        },
      );
      expect(failedInstall.status).not.toBe(0);
      expect(failedInstall.stderr).toContain(
        "Rolled back failed candidate install",
      );
      expect(
        existsSync(
          join(
            root,
            "data",
            "runtime",
            "mcp-candidates",
            "20260712_021509",
            "current",
          ),
        ),
      ).toBe(false);
      expect(
        existsSync(
          join(
            home,
            "Library",
            "LaunchAgents",
            "com.krwontology.mcp-server-candidate.plist",
          ),
        ),
      ).toBe(false);
      const launchctlCalls = readFileSync(launchctlLog, "utf8");
      expect(launchctlCalls).toContain(
        "bootstrap gui/",
      );
      expect(launchctlCalls.match(/bootout gui\//g)?.length).toBeGreaterThanOrEqual(
        2,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("routes production code deploys through split web and Mac worker lanes", () => {
    const deployProd = read("scripts/deploy-production.sh");
    const deployAll = read("scripts/deploy-all-production.sh");
    const deployWeb = read("scripts/deploy-web-production.sh");
    const compose = read("docker-compose.yml");
    const packageJson = read("package.json");
    const restartCompose = read("scripts/restart-production-compose.sh");
    const verifyMcp = read("scripts/verify-mcp-server-production.sh");
    const verifyMcpRuntime = read("scripts/verify-mcp-runtime.mjs");
    const fingerprintMcpRuntime = read("scripts/mcp-runtime-fingerprint.sh");

    expect(deployProd).toContain("deploy-web-production.sh");
    expect(deployProd).toContain("deploy-plugin-worker-production.sh");
    expect(deployProd).toContain("supabase-cli.sh\" db push --dry-run");
    expect(deployProd).toContain("npm run supabase:schema:smoke");
    expect(deployProd).toContain("intentionally does not start the GCP agent-worker");

    expect(deployAll).toContain("deploy-web-production.sh");
    expect(deployAll).toContain("deploy-plugin-worker-production.sh");
    expect(deployAll).toContain("deploy-data-release-production.sh");
    expect(deployAll).toContain("Mac worker/plugin validation");
    expect(deployAll).toContain("Deferring Mac runtime restart until the final plugin/worker deployment step.");
    expect(deployAll).toContain("plugin while the MCP/runtime fingerprints have already changed");
    expect(deployAll.indexOf("Applying Supabase migrations")).toBeLessThan(
      deployAll.indexOf("deploy-web-production.sh"),
    );
    expect(deployAll.indexOf("npm run supabase:schema:smoke")).toBeLessThan(
      deployAll.indexOf("deploy-web-production.sh"),
    );
    expect(deployWeb).toContain("redis document-worker document-outbox-dispatcher filings-mcp filing-notification-worker filing-brief-worker billing-worker");
    expect(compose).toContain('profiles: ["legacy-gcp-agent"]');
    expect(compose).not.toContain(
      "- DESKTOP_ONTOLOGY_EXECUTOR=mcp",
    );
    expect(
      compose.slice(
        compose.indexOf("  web:"),
        compose.indexOf("  llm-gateway:"),
      ),
    ).not.toContain("ontology-mcp:");
    expect(restartCompose).toContain("document-outbox-dispatcher");
    expect(read("scripts/deploy-plugin-worker-production.sh")).toContain(
      'runtime/plugins/prod/$ACTIVE_RELEASE_ID-canonical/krw-ontology',
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
    expect(verifyMcp).toContain("verify-mcp-runtime.mjs");
    expect(verifyMcp).toContain("KRW_ONTOLOGY_EXPECTED_ENV=prod");
    expect(verifyMcpRuntime).toContain('"krw-ontology-mcp/v2"');
    expect(verifyMcpRuntime).toContain('"krw_ontology_verify_evidence"');
    expect(verifyMcpRuntime).toContain("tool_names_match");
    expect(verifyMcpRuntime).toContain("tool_schema_sha256");
    expect(verifyMcpRuntime).toContain("build_fingerprint_sha256");
    expect(verifyMcpRuntime).toContain("service_fingerprint_sha256");
    expect(verifyMcpRuntime).toContain(
      "backend_git_sha is missing and build_fingerprint_sha256 is unavailable",
    );
    expect(verifyMcpRuntime).toContain(
      '["KRW_MCP_EXPECTED_BACKEND_GIT_SHA", "backend_git_sha"]',
    );
    expect(verifyMcp).toContain("load_expected_mcp_runtime_fingerprint");
    expect(fingerprintMcpRuntime).toContain("runtime_fingerprint_payload");
    expect(fingerprintMcpRuntime).toContain(
      "KRW_MCP_EXPECTED_TOOL_SCHEMA_SHA256",
    );
    expect(fingerprintMcpRuntime).toContain(
      "KRW_MCP_EXPECTED_SERVICE_FINGERPRINT_SHA256",
    );
    expect(read("scripts/start-mcp-server-production.sh")).toContain(
      "load_expected_mcp_runtime_fingerprint",
    );
    expect(read("scripts/start-mcp-server-dev.sh")).toContain(
      "load_expected_mcp_runtime_fingerprint",
    );
    expect(packageJson).toContain('"stock-news:coverage:export": "node scripts/export-stock-news-coverage.mjs"');
    expect(packageJson).toContain('"@modelcontextprotocol/sdk"');

    expect(restartCompose).toContain("restart reverse-proxy web");
    expect(restartCompose).not.toContain("restart reverse-proxy web agent-worker");
  });

  it("drains remote document workers before applying pending migrations", () => {
    const deployAll = read("scripts/deploy-all-production.sh");
    const drain = read("scripts/drain-document-workers-for-migration.sh");
    const operations = read("docs/OPERATIONS.md");
    const commandDocs = read("docs/DEPLOY_COMMANDS.md");

    expect(deployAll).toContain("DOCUMENT_INGESTION_V2_MIGRATION_PENDING=1");
    expect(deployAll).toContain(
      "20260710002000_document_ingestion_claim_tokens_cleanup",
    );
    expect(deployAll).toContain("do not use --skip-code");
    expect(deployAll).toContain("drain-document-workers-for-migration.sh");
    expect(
      deployAll.indexOf("drain-document-workers-for-migration.sh"),
    ).toBeLessThan(deployAll.indexOf('echo "Applying Supabase migrations..."'));
    expect(drain).toContain("docker compose");
    expect(drain).toContain(
      "stop --timeout '$DOCUMENT_WORKER_DRAIN_TIMEOUT_SECONDS' document-worker document-outbox-dispatcher",
    );
    expect(drain).toContain("document workers are stopped");
    expect(operations).toContain("drain-document-workers-for-migration.sh");
    expect(commandDocs).toContain("이전 worker를 수동으로 다시 시작하지 않는다");
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
    expect(script).toContain('Release is already prod/current; skipping promote.');
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
    expect(script).toContain("ps -q document-worker");
    expect(script).toContain("document-worker did not become healthy");
    expect(script).toContain("ps -q document-outbox-dispatcher");
    expect(script).toContain("document-outbox-dispatcher did not become healthy");
    expect(script).toContain("ps -q filings-mcp");
    expect(script).toContain("filings-mcp did not become healthy");
    expect(script).toContain("ps -q filing-notification-worker");
    expect(script).toContain("filing-notification-worker did not become healthy");
    expect(script).toContain("ps -q filing-brief-worker");
    expect(script).toContain("filing-brief-worker did not become healthy");
    expect(script).toContain("document-worker must run BullMQ backend in production");
    expect(script).toContain("document-outbox-dispatcher missing Redis queue URL");
    expect(script).toContain("exec -T agent-worker node");
    expect(script).toContain("exec -T document-worker node");
    expect(script).toContain("exec -T document-outbox-dispatcher node");
    expect(script).toContain("exec -T filings-mcp node");
    expect(script).toContain("exec -T filing-notification-worker node");
    expect(script).toContain("exec -T filing-brief-worker node");
    expect(script).toContain(".worker/agent-worker.mjs");
    expect(script).toContain(".worker/document-worker.mjs");
    expect(script).toContain(".worker/document-outbox-dispatcher.mjs");
    expect(script).toContain(".worker/filings-mcp-server.mjs");
    expect(script).toContain(".worker/filing-notification-worker.mjs");
    expect(script).toContain(".worker/filing-brief-worker.mjs");
    expect(script).toContain("KRW_ONTOLOGY_PLUGIN_PATH");
    expect(script).toContain("OK web ontology data boundary: Supabase catalog only");
    expect(script).toContain('"KRW_ONTOLOGY_MCP_URL"');
    expect(script).not.toContain("OK plugin HTTP MCP URL");
  });

  it("keeps the production client IP boundary owned by Caddy", () => {
    const caddy = read("Caddyfile");
    const compose = read("docker-compose.yml");
    const deployVm = read("scripts/deploy-vm-compose.sh");
    const envExample = read(".env.example");

    expect(caddy).toContain("header_up X-KRW-Client-IP {remote_host}");
    expect(caddy).not.toContain("header_up +X-KRW-Client-IP");
    expect(compose).toContain(
      "TRUSTED_CLIENT_IP_HEADER=${TRUSTED_CLIENT_IP_HEADER:-x-krw-client-ip}",
    );
    expect(deployVm).toContain(
      "require_env_exact TRUSTED_CLIENT_IP_HEADER x-krw-client-ip",
    );
    expect(envExample).toContain(
      "TRUSTED_CLIENT_IP_HEADER=x-krw-client-ip",
    );
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

  it("fails the safe deploy when its stopped queue cannot be restarted", () => {
    const script = read("scripts/deploy-with-queue-pause.sh");
    const functionStart = script.indexOf("restart_queue_on_exit() {");
    const functionEnd = script.indexOf("\n}\ntrap restart_queue_on_exit EXIT", functionStart);

    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(functionEnd).toBeGreaterThan(functionStart);

    const restartFunction = script.slice(functionStart, functionEnd + 2);
    const runRestartTrap = (restartExit: number, priorExit: number) =>
      spawnSync(
        "sh",
        [
          "-c",
          `
RESTART_QUEUE=1
QUEUE_WAS_RUNNING=1
QUEUE_STOPPED_BY_SCRIPT=1
DEPLOY_SUCCEEDED=1
ONTOLOGY_SOURCE_DIR=/tmp/ontology
QUEUE_ROOT=/tmp/queue
QUEUE_POLL_INTERVAL=1
start_queue() { return ${restartExit}; }
queue_status() { return 0; }
${restartFunction}
(exit ${priorExit})
restart_queue_on_exit
`,
        ],
        { encoding: "utf8" },
      );

    const failedRestart = runRestartTrap(1, 0);
    expect(failedRestart.status).toBe(1);
    expect(failedRestart.stderr).toContain("Failed to restart queue worker");

    const priorFailure = runRestartTrap(1, 42);
    expect(priorFailure.status).toBe(42);

    const successfulRestart = runRestartTrap(0, 0);
    expect(successfulRestart.status).toBe(0);

    expect(script).toContain("trap restart_queue_on_exit EXIT");
    expect(script).toContain("trap 'exit 130' INT");
    expect(script).toContain("trap 'exit 143' TERM");
    expect(script).not.toContain("trap restart_queue_on_exit EXIT INT TERM");
  });

  it("defines a compose healthcheck for agent-worker", () => {
    const compose = read("docker-compose.yml");
    const webStart = compose.indexOf("\n  web:\n");
    const llmGatewayStart = compose.indexOf("\n  llm-gateway:\n");
    const webSection = compose.slice(
      webStart,
      llmGatewayStart,
    );
    const workerSection = compose.slice(compose.indexOf("  agent-worker:"));

    expect(compose).toContain(
      "AGENT_RUN_HARD_TIMEOUT_MINUTES=${AGENT_RUN_HARD_TIMEOUT_MINUTES:-10}",
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
    expect(workerSection).not.toContain("global_spine.sqlite");
    expect(workerSection).not.toContain("shard_manifest.json");
    expect(workerSection).not.toContain("agent_index.sqlite");
    expect(workerSection).toContain(".mcp.json");
    expect(workerSection).toContain(".krw-ontology-contract.json");
    expect(workerSection).toContain("http://ontology-mcp:8000/mcp");
    expect(compose).toContain("  ontology-mcp:");
    expect(compose).toContain("Dockerfile.mcp");
    expect(compose).toContain("  redis:");
    expect(compose).toContain("redis-server");
    expect(compose).toContain("redis_data:");
    const documentWorkerSection = compose.slice(
      compose.indexOf("  document-worker:"),
      compose.indexOf("  document-outbox-dispatcher:"),
    );
    const documentOutboxSection = compose.slice(
      compose.indexOf("  document-outbox-dispatcher:"),
      compose.indexOf("  billing-worker:"),
    );
    expect(documentWorkerSection).toContain(
      "DOCUMENT_INGESTION_BACKEND=${DOCUMENT_INGESTION_BACKEND:-bullmq}",
    );
    expect(documentWorkerSection).toContain(
      "DOCUMENT_QUEUE_REDIS_URL=${DOCUMENT_QUEUE_REDIS_URL:-redis://redis:6379/0}",
    );
    expect(documentWorkerSection).toContain(".worker/document-worker.mjs");
    expect(documentOutboxSection).toContain(".worker/document-outbox-dispatcher.mjs");
    expect(documentOutboxSection).toContain(
      "DOCUMENT_QUEUE_REDIS_URL=${DOCUMENT_QUEUE_REDIS_URL:-redis://redis:6379/0}",
    );
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
    expect(dockerfileWeb).toContain("http://ontology-mcp:8000/mcp");
    expect(dockerfileWeb).toContain(".krw-ontology-contract.json");
    expect(dockerfileWeb).not.toContain('"command": "/opt/krw-ontology-venv/bin/krw-ontology-mcp"');
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
    expect(preflight).toContain("Missing Claude auth after placeholder cleanup");
    expect(preflight).toContain("ANTHROPIC_AUTH_TOKEN");
    expect(preflight).toContain("EXPECTED_CLAUDE_CODE_VERSION");
    expect(preflight).toContain("KRW_ONTOLOGY_ENV=prod");
    expect(preflight).toContain("/releases/prod/current");
    expect(preflight).toContain("krw-ontology release verify");
    expect(preflight).toContain("manifest_valid");
    expect(preflight).toContain("KRW_ONTOLOGY_MCP_URL");
    expect(preflight).toContain("Plugin .mcp.json MCP URL mismatch");
    expect(preflight).toContain("Checking Guru plugin MCP config");
    expect(preflight).toContain("Guru plugin must not expose mcpServers.krw-ontology-company");
    expect(preflight).toContain("MCP HTTP health is not ok");
    expect(preflight).toContain("global_spine_present");
    expect(preflight).toContain("health_payload");
    expect(preflight).toContain("agent_runs");

    expect(start).toContain("MAC_WORKER_LOCK_DIR");
    expect(start).toContain(
      "No matching worker process found for existing lock; removing stale lock",
    );
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
    expect(initEnv).toContain("EXPECTED_CLAUDE_CODE_VERSION=2.1.204");
    expect(initEnv).toContain("KRW_ONTOLOGY_QUEUE_ROOT=~/krw-ontology-data-running");
    expect(initEnv).toContain("$HOME/krw-ontology");
    expect(initEnv).toContain("ref/plugins/prod/krw-ontology");
    expect(initEnv).toContain("KRW_ONTOLOGY_PLUGIN_SOURCE_PATH");
    expect(initEnv).toContain("KRW_GURU_ADVISOR_PLUGIN_SOURCE_PATH");
    expect(initEnv).toContain("ref/plugins/prod/krw-guru-advisor");
    expect(initEnv).toContain("KRW_GURU_RELEASE_ROOT");
    expect(initEnv).toContain("KRW_ONTOLOGY_MCP_URL=http://127.0.0.1:8765/mcp");
    expect(initEnv).toContain("KRW_ONTOLOGY_MCP_HEALTH_URL=http://127.0.0.1:8765/health");
    expect(initEnv).toContain("KRW_ONTOLOGY_MCP_READY_URL=http://127.0.0.1:8765/readyz");
    expect(initEnv).toContain("AGENT_SUPERVISOR_ID=mac-supervisor-jwc");
    expect(initEnv).toContain("AGENT_SUPERVISOR_CONCURRENCY=8");
    expect(initEnv).toContain("MAC_WORKER_COUNT=8");
    expect(initEnv).toContain("MAC_WORKER_NICE=-5");
    expect(initEnv).toContain("MCP_SERVER_NICE=-5");
    expect(initEnv).toContain("GLOBAL_CONCURRENT_RUN_LIMIT=8");
    expect(initEnv).toContain("AGENT_QUEUE_LISTEN_ENABLED=1");
    expect(initEnv).toContain("AGENT_QUEUE_RECONCILE_INTERVAL_MS=60000");
    expect(initEnv).toContain("AGENT_RUN_CANCEL_LISTEN_ENABLED=1");
    expect(initEnv).toContain("AGENT_RUN_CANCEL_RECONCILE_INTERVAL_MS=10000");
    expect(initEnv).toContain("AGENT_SUPERVISOR_SHUTDOWN_GRACE_MS=120000");
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
    expect(read("scripts/verify-mcp-server-dev.sh")).toContain(
      "KRW_ONTOLOGY_EXPECTED_ENV=dev",
    );
    expect(read("scripts/install-mcp-server-dev-launchd.sh")).toContain(
      "com.krwontology.mcp-server-dev",
    );
    expect(read("ops/launchd/com.krwontology.mcp-server-dev.plist.template")).toContain(
      "mcp-dev.err.log",
    );
    expect(read("scripts/materialize-ontology-plugin.mjs")).toContain('"plugins"');
    expect(read("scripts/materialize-ontology-plugin.mjs")).toContain('"krw-ontology"');
    expect(read("scripts/materialize-guru-advisor-plugin.mjs")).toContain("krw-guru-advisor");
    expect(read("scripts/materialize-guru-advisor-plugin.mjs")).not.toContain(
      "krw-ontology-company",
    );
    expect(verifyMcp).toContain("verify-mcp-runtime.mjs");
    expect(verifyMcp).toContain("KRW_ONTOLOGY_EXPECTED_ENV=prod");
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
    expect(deployPluginWorker).toContain("materialize-guru-advisor-plugin.mjs");
    expect(deployPluginWorker).toContain("Guru plugin path");
    expect(deployPluginWorker).toContain("export-stock-news-coverage.mjs");
    expect(deployPluginWorker).toContain("stock-news/coverage_companies.json");
    expect(deployPluginWorker).toContain("install-mcp-server-launchd.sh");
    expect(deployPluginWorker).toContain("install-stock-news-mcp-launchd.sh");
    expect(deployPluginWorker).toContain("deploy-worker-production.sh");
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

    expect(mcpClient).toContain(
      "KRW Ontology MCP must use explicit streamable HTTP transport",
    );
    expect(mcpClient).toContain("verifyMaterializedOntologyPluginContract");
    expect(mcpClient).not.toContain("runStdioMcpHealth");
  });
});
