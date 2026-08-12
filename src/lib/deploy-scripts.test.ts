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
  it("requires an exact krw-agent host archive provenance before a production build", () => {
    const packageJson = JSON.parse(read("package.json"));
    expect(packageJson.scripts.build).toContain("verify:agent-host-package");
    expect(packageJson.scripts["verify:agent-host-package"]).toContain(
      "verify-krw-agent-host-package.mjs",
    );
    expect(read("scripts/sync-krw-agent-host-package.mjs")).toContain(
      "host_package_provenance",
    );
    expect(read("scripts/verify-krw-agent-host-package.mjs")).toContain(
      "host_package_lock_integrity_mismatch",
    );
  });

  it("keeps an auditable SEC fallback for AEP when the live ticker feed omits it", () => {
    const probe = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          'const { pathToFileURL } = await import("node:url");',
          "const mapping = await import(pathToFileURL(process.argv[1]).href);",
          "const index = mapping.buildSecTickerIndex({",
          '  0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },',
          "});",
          'const resolved = mapping.resolveCatalogTicker("AEP", index);',
          'if (JSON.stringify(resolved) !== JSON.stringify({ sec_cik: "0000004904", sec_ticker: "AEP", sec_mapping_source: "verified_alias" })) process.exit(1);',
        ].join("\n"),
        join(process.cwd(), "scripts", "sec-company-mapping.mjs"),
      ],
      { encoding: "utf8" },
    );

    expect(probe.status, probe.stderr).toBe(0);
  });

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

  it("routes normal production aliases through the fast web and Mac path", () => {
    const deployProd = read("scripts/deploy-production.sh");
    const deployFast = read("scripts/deploy-production-fast.sh");
    const deployAll = read("scripts/deploy-all-production.sh");
    const deployQueue = read("scripts/deploy-production-simple.sh");
    const deployWeb = read("scripts/deploy-web-production.sh");
    const compose = read("docker-compose.yml");
    const packageJson = read("package.json");
    const restartCompose = read("scripts/restart-production-compose.sh");
    const verifyMcp = read("scripts/verify-mcp-server-production.sh");
    const verifyMcpRuntime = read("scripts/verify-mcp-runtime.mjs");
    const fingerprintMcpRuntime = read("scripts/mcp-runtime-fingerprint.sh");

    expect(deployProd).toContain("deploy-production-fast.sh");
    expect(deployProd).toContain("--apply-migrations");
    expect(deployFast).toContain("krw-ontology-front-web:candidate-");
    expect(deployFast).toContain("Fast activation failed; restoring the previous VM image.");
    expect(deployFast).toContain("--billing-v2-cutover");
    expect(deployFast).toContain("Caddyfile.billing-readonly");
    expect(deployFast).toContain("run_remote_pause_billing_for_cutover");
    expect(deployFast).toContain(
      "preserving billing read-only mode instead of restoring legacy payment writes",
    );
    expect(deployFast).toContain("docker compose");
    expect(deployFast).toContain("run_schema_smoke()");
    expect(deployFast).toContain("run_schema_smoke");
    expect(deployFast).toContain("db push --dry-run");
    expect(deployFast).toContain("run_remote_deep_verify");
    expect(deployFast).toContain("Removing retired GCP ontology sidecars.");
    expect(deployFast).toContain("stage_local_agent_release");
    expect(deployFast).toContain("public Rust release descriptor");
    expect(deployFast).toContain("KRW_AGENT_DAEMON_HEARTBEAT_REQUIRED 1");
    expect(deployFast).toContain("--with-agent-release requires --apply-migrations for the direct Rust daemon heartbeat ABI.");
    expect(deployFast).not.toContain("local Mac worker heartbeat restart");
    expect(deployFast).not.toContain("install-krw-agent-release-production.sh");
    expect(deployFast).not.toContain("ONTOLOGY_ARCHIVE");
    expect(deployFast).not.toContain("KRW_ONTOLOGY_SOURCE_DIR=\"$REMOTE_STAGE/ontology\"");
    expect(deployFast).not.toContain("pause-production-cutover.sh");
    expect(deployFast).not.toContain("deploy-all-production.sh");

    expect(deployAll).toContain("deploy-web-production.sh");
    expect(deployAll).toContain("deploy-plugin-worker-production.sh");
    expect(deployAll).toContain(
      '/bin/sh "$SCRIPT_DIR/deploy-plugin-worker-production.sh"',
    );
    expect(deployAll).toContain(
      '/bin/sh "$SCRIPT_DIR/deploy-web-production.sh"',
    );
    expect(deployQueue).toContain(
      '/bin/sh "$SCRIPT_DIR/deploy-all-production.sh"',
    );
    expect(deployQueue).toContain('/bin/sh "$0" "$@"');
    expect(deployAll).toContain("deploy-data-release-production.sh");
    expect(deployAll).toContain("--skip-release-gates");
    expect(deployAll).toContain("Skipping slow local release gates");
    expect(read("scripts/run-production-release-gates.sh")).toContain(
      "run_isolated_gate_with_sigterm_retry",
    );
    expect(read("scripts/run-production-release-gates.sh")).toContain(
      "Retrying $gate_label after a transient SIGTERM",
    );
    expect(read("scripts/run-production-release-gates.sh")).toContain(
      "run_isolated_browser_gate_with_single_retry",
    );
    expect(read("scripts/run-production-release-gates.sh")).toContain(
      "Retrying production-mode browser/PWA gate once after a failed local test-server run",
    );
    expect(deployAll).toContain(
      "Retrying the sealed Supabase migration dry run once after a transient CLI failure",
    );
    expect(read("scripts/deploy-web-production.sh")).toContain(
      "gcloud_scp_with_retry",
    );
    expect(read("scripts/deploy-web-production.sh")).toContain(
      '--project-directory "\\$REMOTE_FRONT_DIR"',
    );
    expect(read("scripts/deploy-web-production.sh")).toContain(
      "'abandon-prepared'",
    );
    expect(deployQueue).toContain(
      "recover_prepared_local_cutover_if_needed",
    );
    expect(deployQueue).toContain(
      "Cleaning up an unactivated prepared candidate",
    );
    expect(deployQueue).toContain("--recover-prepared-local-only");
    expect(compose).toContain("WEB_COMMIT=${WEB_COMMIT:-}");
    expect(compose).toContain("KRW_ONTOLOGY_COMMIT=${KRW_ONTOLOGY_COMMIT:-}");
    expect(read("scripts/deploy-web-production.sh")).toContain(
      "Retrying $scp_label upload after a transient GCP SSH copy failure",
    );
    expect(deployAll).toContain("Deferring Mac runtime restart until the final plugin/worker deployment step.");
    expect(deployAll).toContain("plugin while the MCP/runtime fingerprints have already changed");
    expect(deployAll.indexOf("run-production-release-gates.sh")).toBeLessThan(
      deployAll.indexOf('deploy-web-production.sh" --prepare-only'),
    );
    expect(deployAll.indexOf('deploy-web-production.sh" --prepare-only')).toBeLessThan(
      deployAll.indexOf("Applying Supabase migrations"),
    );
    expect(deployAll.indexOf("Applying Supabase migrations")).toBeLessThan(
      deployAll.indexOf("Running Supabase schema smoke test"),
    );
    expect(deployAll.indexOf("Running Supabase schema smoke test")).toBeLessThan(
      deployAll.indexOf('deploy-web-production.sh" --activate-prepared'),
    );
    expect(deployAll).toContain(
      'KRW_FILINGS_MCP_DEFER_PERSONAL_DATA_SMOKE="$MIGRATIONS_PENDING"',
    );
    expect(deployWeb).toContain(
      "redis document-worker document-outbox-dispatcher filings-mcp filing-notification-worker filing-brief-worker market-issue-worker market-issue-stream-worker market-web-source-worker market-issue-enrichment-worker billing-worker",
    );
    expect(deployWeb).toContain(
      "GCP instance identity probe timed out after 30 seconds",
    );
    expect(deployWeb).toContain(
      "Retrying GCP instance identity probe",
    );
    expect(deployWeb).toContain('"x-krw-client-ip": "127.0.0.1"');
    expect(read("scripts/pause-production-cutover.sh")).toContain(
      'http://127.0.0.1:3000/api/healthz',
    );
    expect(read("scripts/pause-production-cutover.sh")).toContain(
      "rollback shallow health deployment identity mismatch",
    );
    expect(compose).not.toContain('profiles: ["legacy-gcp-agent"]');
    expect(compose).toContain("KRW_AGENT_PUBLIC_DESCRIPTOR_HOST_PATH");
    expect(compose).toContain("KRW_AGENT_DAEMON_HEARTBEAT_REQUIRED");
    expect(compose).not.toContain("KRW_AGENT_RELEASE_DIR");
    expect(compose).not.toContain("  agent-worker:");
    expect(compose).not.toContain("  ontology-mcp:");
    expect(compose).not.toContain("krw-ontology-src");
    const reverseProxySection = compose.slice(
      compose.indexOf("  reverse-proxy:"),
      compose.indexOf("\n  web:\n"),
    );
    expect(reverseProxySection).not.toContain("llm-gateway:");
    expect(compose).not.toContain(
      "- DESKTOP_ONTOLOGY_EXECUTOR=mcp",
    );
    expect(
      compose.slice(
        compose.indexOf("  web:"),
        compose.indexOf("  llm-gateway:"),
      ),
    ).not.toContain("ontology-mcp:");
    expect(restartCompose).toContain("Direct production Compose restarts are disabled");
    expect(read("scripts/deploy-plugin-worker-production.sh")).toContain(
      'runtime/plugins/prod/$ACTIVE_RELEASE_ID-canonical/krw-ontology',
    );
    expect(read("scripts/deploy-plugin-worker-production.sh")).toContain(
      'KRW_ONTOLOGY_MCP_HEALTH_URL "http://127.0.0.1:$CANDIDATE_MCP_PORT/health"',
    );
    expect(read("scripts/deploy-plugin-worker-production.sh")).toContain(
      'KRW_ONTOLOGY_MCP_READY_URL "http://127.0.0.1:$CANDIDATE_MCP_PORT/readyz"',
    );
    expect(read("scripts/deploy-plugin-worker-production.sh")).toContain(
      'KRW_ONTOLOGY_SOURCE_DIR="$RUNTIME_ONTOLOGY_SOURCE"',
    );
    expect(read("scripts/deploy-plugin-worker-production.sh")).toContain(
      'KRW_ONTOLOGY_RELEASE_ROOT="$ACTIVE_RELEASE_ROOT"',
    );
    expect(read("scripts/deploy-plugin-worker-production.sh")).toContain(
      'KRW_FILINGS_MCP_DEFER_PERSONAL_DATA_SMOKE 1',
    );
    expect(read("scripts/deploy-plugin-worker-production.sh")).toContain(
      "--exclude '/.venv*/'",
    );
    expect(read("scripts/deploy-vm-compose.sh")).toContain(
      "--exclude '/.venv*/'",
    );
    expect(read("scripts/verify-filings-mcp-production.sh")).toContain(
      "Deferred personal filing data smoke until the post-migration production verification.",
    );

    expect(packageJson).toContain('"prod:status": "scripts/status-production-fast.sh"');
    expect(packageJson).toContain('"prod:preflight": "scripts/run-production-release-gates.sh"');
    expect(packageJson).toContain('"prod:deploy:web": "scripts/deploy-production-fast.sh --skip-mac"');
    expect(packageJson).toContain(
      '"prod:deploy:runtime": "scripts/deploy-production-fast.sh --apply-migrations --require-live-toss"',
    );
    expect(packageJson).toContain(
      '"prod:deploy:mac-runtime": "/bin/sh scripts/deploy-production-fast.sh --skip-web"',
    );
    expect(packageJson).toContain('"prod:deploy:code": "scripts/deploy-production-fast.sh --apply-migrations"');
    expect(packageJson).toContain('"prod:deploy:full": "scripts/deploy-production-fast.sh --apply-migrations --with-data"');
    expect(packageJson).toContain('"prod:deploy:dry": "scripts/deploy-production-fast.sh --dry-run --apply-migrations"');
    expect(packageJson).toContain('"prod:deploy:safe": "scripts/deploy-production-fast.sh --apply-migrations --with-data"');
    expect(packageJson).toContain('"prod:release:publish": "scripts/deploy-production-fast.sh --with-data --skip-web --skip-mac"');
    expect(packageJson).toContain('"deploy:data": "scripts/deploy-production-fast.sh --with-data --skip-web --skip-mac"');
    expect(packageJson).toContain('"deploy:worker": "/bin/sh scripts/deploy-production-fast.sh --skip-web"');
    expect(packageJson).toContain('"deploy:plugin": "/bin/sh scripts/deploy-production-fast.sh --skip-web"');
    expect(packageJson).toContain('"deploy:mcp": "/bin/sh scripts/deploy-production-fast.sh --skip-web"');
    expect(packageJson).not.toContain("legacy:gcp-mcp");
    expect(packageJson).not.toContain("deploy-data-production.sh");
    expect(packageJson).not.toContain("deploy:plugin:gcp");
    expect(packageJson).not.toContain("deploy:legacy:gcp-mcp");
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
    expect(fingerprintMcpRuntime).toContain('optional_fields = {"backend_git_sha"}');
    expect(fingerprintMcpRuntime).toContain(
      "configured {env_name} requires runtime fingerprint field: {field}",
    );
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

    expect(restartCompose).not.toContain("docker compose");
    expect(restartCompose).toContain("version-bound health and proxy-last activation");
  });

  it("keeps the legacy sealed pause controller available for recovery", () => {
    const deployAll = read("scripts/deploy-all-production.sh");
    const pause = read("scripts/pause-production-cutover.sh");
    const operations = read("docs/OPERATIONS.md");
    const commandDocs = read("docs/DEPLOY_COMMANDS.md");
    const migrationBlock = deployAll.slice(
      deployAll.indexOf('echo "Applying Supabase migrations..."'),
      deployAll.indexOf('if [ "$DB_CHECK" = "1" ]; then', deployAll.indexOf('echo "Applying Supabase migrations..."')),
    );

    expect(deployAll).toContain("Pending schema migrations require a prepared code cutover");
    expect(deployAll).toContain("do not use --skip-code");
    expect(deployAll).toContain("run_sealed_pause_controller pause");
    expect(
      deployAll.indexOf("run_sealed_pause_controller pause"),
    ).toBeLessThan(deployAll.indexOf('echo "Applying Supabase migrations..."'));
    const pinnedDbPushIndex = migrationBlock.indexOf(
      '"$MIGRATION_EXECUTABLE" db push',
    );
    expect(pinnedDbPushIndex).toBeGreaterThan(-1);
    expect(migrationBlock.indexOf("ROLLBACK_UNSAFE=1")).toBeLessThan(
      pinnedDbPushIndex,
    );
    expect(pause).toContain("REMOTE_PAUSE_SERVICES");
    expect(pause).not.toContain("agent-worker ontology-mcp");
    expect(pause).toContain("document-worker document-outbox-dispatcher");
    expect(pause).toContain("filings-mcp filing-notification-worker filing-brief-worker billing-worker");
    expect(pause).toContain("lsof -nP -iTCP");
    expect(operations).toContain("scripts/deploy-production-fast.sh");
    expect(commandDocs).toContain("새 GCP image build");
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
    expect(commandDocs).toContain(
      "cross-release promotion은 아직 자동화하지 않았으며",
    );
    expect(commandDocs).not.toContain(
      "npm run prod:release:publish -- --release-id <release_id>",
    );
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
    expect(script).not.toContain("deploy-worker-production.sh");
    expect(script).toContain('Release is already prod/current; no promotion required.');
    expect(script).toContain("Refusing to promote prod/current from the data-only deployment path.");
    expect(script).toContain("Catalog publication does not restart prod MCP or Mac workers.");
    expect(script).toContain("This script does not upload full ontology data to GCP");
    expect(script).not.toContain("gcloud");
    expect(script).not.toContain("/srv/krw-ontology-data");

    expect(publishScript).toContain("publish_ontology_web_catalog");
    expect(publishScript).toContain("ontology_catalog_releases");
    expect(publishScript).toContain("ontology_companies");
    expect(publishScript).toContain("krw-ontology-web-catalog/v1");
    expect(publishScript).toContain("pulseRebuildMaxAttempts = 3");
    expect(publishScript).toContain('includes("statement timeout")');
    expect(publishScript).toContain("attempt * 1_000");

    expect(verifyScript).toContain("ontology_catalog_releases");
    expect(verifyScript).toContain("Active web catalog mismatch");
  });

  it("keeps the GCP application Compose free of ontology execution", () => {
    const compose = read("docker-compose.yml");
    const fastDeploy = read("scripts/deploy-production-fast.sh");
    const dockerfileWeb = read("Dockerfile.web");

    expect(compose).not.toContain("  agent-worker:");
    expect(compose).not.toContain("  ontology-mcp:");
    expect(compose).not.toContain("KRW_ONTOLOGY_PLUGIN_PATH");
    expect(compose).not.toContain("KRW_ONTOLOGY_MCP_URL");
    expect(fastDeploy).not.toContain("ONTOLOGY_ARCHIVE");
    expect(fastDeploy).not.toContain("KRW_ONTOLOGY_SOURCE_DIR");
    expect(fastDeploy).toContain("Removing retired GCP ontology sidecars.");
    expect(fastDeploy).toContain('"x-krw-client-ip":"127.0.0.1"');
    expect(fastDeploy).toContain("deep health returned ${response.status}");
    expect(fastDeploy).toContain('NEXT_PUBLIC_APP_VERSION="$RELEASE_ID" \\');
    expect(fastDeploy).toContain(
      'PRODUCTION_ORCHESTRATOR_ATTESTATION="$RELEASE_ID:$DATA_LOCK_OWNER"',
    );
    expect(dockerfileWeb).not.toContain("krw-ontology-src");
    expect(dockerfileWeb).not.toContain("ontology-mcp:8000");
    expect(dockerfileWeb).not.toContain("agent-worker.mjs");
    expect(dockerfileWeb).not.toContain(
      "COPY --from=builder --chown=nextjs:nodejs /app/.worker ./.worker",
    );
    expect(dockerfileWeb).toContain("/app/.worker/document-worker.mjs");
    expect(dockerfileWeb).toContain("markitdown[pdf]");
    expect(dockerfileWeb).toContain("claude-agent-sdk==0.2.85");
    expect(compose).toContain("  document-worker:");
    expect(compose).toContain("  document-outbox-dispatcher:");
    expect(compose).toContain("  filings-mcp:");
    expect(compose).toContain("  filing-notification-worker:");
    expect(compose).toContain("  filing-brief-worker:");
  });

  it("keeps the production client IP boundary owned by Caddy", () => {
    const caddy = read("Caddyfile");
    const compose = read("docker-compose.yml");
    const deployVm = read("scripts/deploy-vm-compose.sh");
    const envExample = read(".env.example");

    expect(caddy).toContain("header_up X-KRW-Client-IP {remote_host}");
    expect(caddy).not.toContain("header_up +X-KRW-Client-IP");
    expect(caddy).toContain("request>uri query");
    expect(caddy).toContain("replace authKey REDACTED");
    expect(caddy).toContain("replace customerKey REDACTED");
    expect(caddy).toContain("replace callbackToken REDACTED");
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

    expect(readiness).toContain("/api/billing/toss/quote");
    expect(readiness).toContain("Legacy Toss checkout route must be removed");
    expect(readiness).toContain("401");
    expect(readiness).toContain("ANALYSIS_CREDIT_ENFORCEMENT_MODE");
    expect(readiness).toContain("TOSS_PAYMENTS_CLIENT_KEY");
    expect(readiness).toContain("billing-worker");
    expect(readiness).toContain('"Standard feature" "더 넉넉한 분석량" "More research capacity"');
    expect(readiness).toContain('"Pro feature" "리서치 노트북" "Research notebook"');
    expect(readiness).not.toContain('"Standard weekly credits"');
    expect(readiness).not.toContain('"Pro weekly credits"');
    expect(read("scripts/deploy-production-fast.sh")).toContain(
      "--require-live-toss",
    );

    expect(billingContract).toContain("Production Readiness Gate");
    expect(billingContract).toContain("npm run billing:prod:readiness");
    expect(billingContract).toContain("live_sk_");
    expect(commandDocs).toContain("Production billing");
    expect(commandDocs).toContain("npm run prod:deploy:code");
    expect(commandDocs).not.toContain("scripts/restart-production-compose.sh");
    expect(commandDocs).toContain("npm run billing:prod:readiness");
  });

  it("keeps the normal deploy wrapper small and queue-safe", () => {
    const script = read("scripts/deploy-production-simple.sh");

    for (const flag of [
      "--apply-migrations",
      "--skip-data",
      "--skip-code",
      "--skip-db-check",
      "--skip-worker-restart",
    ]) {
      expect(script).toContain(flag);
    }
    expect(script).toContain('DEPLOY_ARGS="$DEPLOY_ARGS $1"');
    expect(script).toContain("--skip-release-gates");
    expect(script).toContain("--release-id");
    expect(script).toContain("RELEASE_ID=${2:?Missing value for --release-id}");
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

  it("fails the normal deploy when its stopped queue cannot be restarted", () => {
    const script = read("scripts/deploy-production-simple.sh");
    const functionStart = script.indexOf("cleanup() {");
    const functionEnd = script.indexOf("\n}\ntrap cleanup EXIT", functionStart);

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
LOCK_OWNED=0
ONTOLOGY_SOURCE_DIR=/tmp/ontology
QUEUE_ROOT=/tmp/queue
QUEUE_POLL_INTERVAL=1
start_queue() { return ${restartExit}; }
queue_status() { return 0; }
${restartFunction}
(exit ${priorExit})
cleanup
`,
        ],
        { encoding: "utf8" },
      );

    const failedRestart = runRestartTrap(1, 0);
    expect(failedRestart.status).toBe(1);
    expect(failedRestart.stderr).toContain("Queue restart failed");

    const priorFailure = runRestartTrap(1, 42);
    expect(priorFailure.status).toBe(42);

    const successfulRestart = runRestartTrap(0, 0);
    expect(successfulRestart.status).toBe(0);

    expect(script).toContain("trap cleanup EXIT");
    expect(script).toContain("trap 'exit 130' INT");
    expect(script).toContain("trap 'exit 143' TERM");
    expect(script).not.toContain("trap cleanup EXIT INT TERM");
  });

  it("keeps agent execution exclusively on the Mac runtime", () => {
    const compose = read("docker-compose.yml");
    const webStart = compose.indexOf("\n  web:\n");
    const llmGatewayStart = compose.indexOf("\n  llm-gateway:\n");
    const webSection = compose.slice(
      webStart,
      llmGatewayStart,
    );
    expect(compose).toContain(
      "AGENT_RUN_HARD_TIMEOUT_MINUTES=${AGENT_RUN_HARD_TIMEOUT_MINUTES:-10}",
    );
    expect(compose).toContain("LEASE_TIMEOUT_MINUTES=${LEASE_TIMEOUT_MINUTES:-10}");
    expect(webSection).toContain(
      "AGENT_RUN_EVENT_LISTEN_DATABASE_URL=${AGENT_RUN_EVENT_LISTEN_DATABASE_URL:-}",
    );
    expect(webSection).toContain(
      "AGENT_EVENT_RECONCILE_INTERVAL_MS=${AGENT_EVENT_RECONCILE_INTERVAL_MS:-15000}",
    );
    expect(compose).not.toContain("  agent-worker:");
    expect(compose).not.toContain("  ontology-mcp:");
    expect(compose).not.toContain("http://ontology-mcp:8000/mcp");
    expect(existsSync("Dockerfile.mcp")).toBe(false);
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
    expect(dockerfileWeb).not.toContain("http://ontology-mcp:8000/mcp");
    expect(dockerfileWeb).not.toContain(".krw-ontology-contract.json");
    expect(dockerfileWeb).not.toContain("krw-ontology-src");
    expect(dockerfileWeb).toContain("markitdown[pdf]");
    expect(dockerfileWeb).toContain("claude-agent-sdk==0.2.85");
    expect(dockerfileWeb).not.toContain('"command": "/opt/krw-ontology-venv/bin/krw-ontology-mcp"');
    expect(dockerfileWeb).not.toContain('"stock-news"');
    expect(dockerfileWeb).not.toContain('"http://127.0.0.1:8775/mcp"');
    expect(dockerfileWeb).not.toContain("krw-ontology-mcp-stdio");
  });

  it("keeps Mac worker cutover scripts conservative", () => {
    const preflight = read("scripts/mac-worker-preflight.sh");
    const fastDeploy = read("scripts/deploy-production-fast.sh");
    const start = read("scripts/start-mac-worker-production.sh");
    const installLaunchd = read("scripts/install-mac-worker-launchd.sh");
    const uninstallLaunchd = read("scripts/uninstall-mac-worker-launchd.sh");
    const startMcp = read("scripts/start-mcp-server-production.sh");
    const installMcpLaunchd = read("scripts/install-mcp-server-launchd.sh");
    const installFilingsMcpLaunchd = read("scripts/install-filings-mcp-launchd.sh");
    const installStockNewsMcpLaunchd = read("scripts/install-stock-news-mcp-launchd.sh");
    const verifyMcp = read("scripts/verify-mcp-server-production.sh");
    const uninstallMcpLaunchd = read("scripts/uninstall-mcp-server-launchd.sh");
    const deployWorker = read("scripts/deploy-worker-production.sh");
    const deployPluginWorker = read("scripts/deploy-plugin-worker-production.sh");
    const verifyMacRuntime = read("scripts/verify-mac-runtime-target.sh");
    const startFilingsMcp = read("scripts/start-filings-mcp-production.sh");
    const startStockNewsMcp = read("scripts/start-stock-news-mcp-production.sh");
    const verifyHeartbeats = read("scripts/verify-mac-worker-heartbeats.mjs");
    const statusWorkers = read("scripts/status-production-workers.sh");
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
    expect(preflight).toContain("--skip-live-mcp-fingerprint");
    expect(preflight).toContain(
      "Skipping live MCP fingerprint verification before runtime swap.",
    );
    expect(fastDeploy).toContain("--skip-live-mcp-fingerprint");
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
    expect(start).toContain('exec "$KRW_RUNTIME_NODE_EXECUTABLE" .worker/agent-worker.mjs');
    expect(start).toContain(">> \"$LOG_FILE\" 2>&1");

    expect(verifyMacRuntime).toContain("KRW_RUNTIME_NODE_EXECUTABLE");
    expect(verifyMacRuntime).toContain('"$RUNTIME_NODE_EXECUTABLE" - "$IDENTITY_FILE"');
    expect(verifyMacRuntime).toContain(
      '"$RUNTIME_NODE_EXECUTABLE" "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs"',
    );
    expect(startFilingsMcp).toContain(
      'exec "$KRW_RUNTIME_NODE_EXECUTABLE" .worker/filings-mcp-server.mjs',
    );
    expect(startStockNewsMcp).toContain(
      'exec "$KRW_RUNTIME_NODE_EXECUTABLE" dist/server.js',
    );

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
    for (const installer of [
      installLaunchd,
      installMcpLaunchd,
      installFilingsMcpLaunchd,
      installStockNewsMcpLaunchd,
    ]) {
      expect(installer).toContain('LAUNCHD_DOMAIN="gui/$(id -u)"');
      expect(installer).not.toMatch(/^DOMAIN="gui\/\$\(id -u\)"$/m);
    }
    expect(uninstallLaunchd).toContain("launchctl bootout");
    expect(uninstallLaunchd).toContain("com.krwontology.agent-worker*.plist");

    expect(startMcp).toContain("krw-ontology-mcp");
    expect(startMcp).toContain("--env prod");
    expect(startMcp).toContain("--store-mode");
    expect(startMcp).toContain("--log-file");
    expect(startMcp).toContain("--require-current-symlink");
    expect(startMcp).toContain("KRW_ONTOLOGY_CURRENT_RELEASE_ROOT");
    expect(startMcp).toContain("MCP prod/current symlink no longer resolves to the sealed runtime release.");
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

    expect(deployPluginWorker).toContain("KRW_ONTOLOGY_PLUGIN_PATH is not the canonical active-release plugin path");
    expect(deployPluginWorker).toContain("KRW_ONTOLOGY_CURRENT_RELEASE_ROOT");
    expect(deployPluginWorker).toContain("Prepared runtime current release link mismatch.");
    expect(deployPluginWorker).toContain("materialize-ontology-plugin.mjs");
    expect(deployPluginWorker).toContain("materialize-guru-advisor-plugin.mjs");
    expect(deployPluginWorker).toContain(
      'append_env_value "$RUNTIME_ENV_PATH" KRW_RUNTIME_NODE_EXECUTABLE "$NODE_PATH"',
    );
    expect(read("scripts/deploy-web-production.sh")).toContain(
      'ps -o state= -p "$gcp_probe_pid"',
    );
    expect(deployPluginWorker).toContain("KRW_GURU_ADVISOR_PLUGIN_PATH is not the canonical source plugin path");
    expect(deployPluginWorker).toContain("export-stock-news-coverage.mjs");
    expect(deployPluginWorker).toContain("stock-news/coverage_companies.json");
    expect(deployPluginWorker).toContain("install-mcp-server-launchd.sh");
    expect(deployPluginWorker).toContain("install-stock-news-mcp-launchd.sh");
    expect(deployPluginWorker).toContain("deploy-worker-production.sh");
    expect(deployPluginWorker).not.toContain(
      "News discovery will still work, but fallback cards may stay in English",
    );
    expect(deployPluginWorker).toContain("versioned, immutable Mac runtime");
    expect(deployPluginWorker).toContain("candidate runtime dependency and isolated MCP health checks");
    expect(deployPluginWorker).toContain(
      'npm ci --include=dev --no-audit --no-fund && npm run build:worker',
    );
    expect(deployPluginWorker).toContain('npm ci --omit=dev');
    expect(deployPluginWorker).toContain("KRW_RUNTIME_IDENTITY_SHA256");
    expect(deployPluginWorker).toContain(
      "Retrying isolated ontology environment sync after a transient SIGTERM",
    );
    expect(deployPluginWorker).toContain('[ "$runtime_sync_status" -ne 143 ]');
    const runtimeEnvCopy = deployPluginWorker.indexOf(
      'cp "$ENV_PATH" "$RUNTIME_ENV_PATH"',
    );
    const runtimeEnvWritable = deployPluginWorker.indexOf(
      'chmod 600 "$RUNTIME_ENV_PATH"',
      runtimeEnvCopy,
    );
    const deepSeekMaterialization = deployPluginWorker.indexOf(
      'node - "$CLAUDE_CONFIG_DIR/deepseek.env" "$RUNTIME_ENV_PATH"',
    );
    expect(runtimeEnvCopy).toBeGreaterThan(-1);
    expect(runtimeEnvWritable).toBeGreaterThan(runtimeEnvCopy);
    expect(deepSeekMaterialization).toBeGreaterThan(runtimeEnvWritable);
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

    expect(packageJson).toContain("worker:mac:preflight");
    expect(packageJson).not.toContain("worker:prod:stop-gcp");
    expect(packageJson).not.toContain("worker:prod:start-gcp");
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

  it("archives the exact clean frontend commit for fast deployment", () => {
    const fastDeploy = read("scripts/deploy-production-fast.sh");

    expect(fastDeploy).toContain(
      'FRONT_GIT_COMMIT=$(git -C "$FRONT_DIR" rev-parse HEAD)',
    );
    expect(fastDeploy).toContain(
      'git -C "$FRONT_DIR" archive --format=tar "$FRONT_GIT_COMMIT"',
    );
    expect(fastDeploy).not.toContain("--exclude=coverage");
    expect(fastDeploy).not.toContain("ONTOLOGY_ARCHIVE");
    expect(fastDeploy).not.toContain("KRW_ONTOLOGY_SOURCE_DIR");
    expect(fastDeploy).toContain("upload_archive");
    expect(fastDeploy).toContain("ServerAliveInterval=15");
  });
});
