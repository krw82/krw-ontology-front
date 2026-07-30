import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const artifactVerifier = join(
  repoRoot,
  "scripts",
  "verify-prepared-runtime-artifacts.mjs",
);
const sourceHasher = join(
  repoRoot,
  "scripts",
  "compute-production-source-sha256.mjs",
);
const supabaseCliPinner = join(
  repoRoot,
  "scripts",
  "pin-supabase-cli.mjs",
);
const containedSymlinkVerifier = join(
  repoRoot,
  "scripts",
  "verify-contained-symlinks.mjs",
);
const productionTargetVerifier = join(
  repoRoot,
  "scripts",
  "verify-supabase-production-target.mjs",
);
const atomicInstaller = join(
  repoRoot,
  "scripts",
  "atomic-install-sealed-file.mjs",
);
const atomicTransition = join(
  repoRoot,
  "scripts",
  "atomic-transition-sealed-file.mjs",
);

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function productionEnv(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? "test",
    ...overrides,
  };
  for (const key of [
    "PRODUCTION_DEPLOY_LOCK_OWNER",
    "PRODUCTION_OS_LOCK_HELD",
    "PRODUCTION_ORCHESTRATOR_ATTESTATION",
    "NEXT_PUBLIC_APP_VERSION",
    "EXPECTED_PREPARED_APP_VERSION",
  ]) {
    delete env[key];
  }
  return env;
}

function runScript(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): SpawnSyncReturns<string> {
  return spawnSync("/bin/sh", [join(repoRoot, "scripts", script), ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    timeout: 15_000,
  });
}

function expectRejected(
  result: SpawnSyncReturns<string>,
  message: string,
) {
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain(message);
}

function writeCanonicalEnv(path: string) {
  writeFileSync(
    path,
    [
      "SUPABASE_URL=https://deaumgysfwfcctzhbaxb.supabase.co",
      "NEXT_PUBLIC_SUPABASE_URL=https://deaumgysfwfcctzhbaxb.supabase.co",
      "SUPABASE_SERVICE_ROLE_KEY=fault-test-service-role-key",
      "SUPABASE_ANON_KEY=sb_publishable_fault_test",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_fault_test",
      "ADMIN_EMAILS=admin@example.com",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
}

function runProductionTargetVerifier(
  envFile: string,
  targetFile: string,
  options: string[] = [],
) {
  return spawnSync(
    process.execPath,
    [productionTargetVerifier, envFile, "-", targetFile, ...options],
    { cwd: repoRoot, encoding: "utf8", timeout: 30_000 },
  );
}

function installMutationTripwires(binDir: string) {
  mkdirSync(binDir, { recursive: true });
  for (const command of [
    "docker",
    "gcloud",
    "launchctl",
    "npm",
    "rsync",
    "uv",
  ]) {
    const commandPath = join(binDir, command);
    writeFileSync(
      commandPath,
      [
        "#!/bin/sh",
        `printf '%s\\n' ${JSON.stringify(command)} >> "$MUTATION_LOG"`,
        "exit 97",
        "",
      ].join("\n"),
    );
    chmodSync(commandPath, 0o755);
  }
}

function runArtifactVerifier(
  mode: "prepare" | "verify",
  marker: string,
  boundary: string,
  sealedPath: string,
) {
  return spawnSync(
    process.execPath,
    [
      artifactVerifier,
      mode,
      "--marker",
      marker,
      "--symlink-boundary",
      boundary,
      "--path",
      sealedPath,
    ],
    { cwd: repoRoot, encoding: "utf8", timeout: 30_000 },
  );
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function extractWebActivationPreflight(assignments: Record<string, string>) {
  const source = readFileSync(
    join(repoRoot, "scripts", "deploy-web-production.sh"),
    "utf8",
  );
  const markerAnchor = source.indexOf(
    'PREPARED_MARKER="\\$REMOTE_FRONT_DIR/.deploy/prepared-web-release.env"',
  );
  expect(markerAnchor).toBeGreaterThan(-1);
  const heredocAnchor = "REMOTE_COMMAND=$(cat <<EOF\n";
  const bodyStart = source.lastIndexOf(heredocAnchor, markerAnchor);
  expect(bodyStart).toBeGreaterThan(-1);
  const firstMutation = source.indexOf(
    'tar --warning=no-unknown-keyword -xzf "\\$RELEASE_DIR/front-source.tar.gz"',
    markerAnchor,
  );
  expect(firstMutation).toBeGreaterThan(markerAnchor);

  let preflight = source
    .slice(bodyStart + heredocAnchor.length, firstMutation)
    .replaceAll("\\$", "$");
  for (const [key, value] of Object.entries(assignments)) {
    const assignment = new RegExp(`^${key}=.*$`, "m");
    expect(preflight).toMatch(assignment);
    preflight = preflight.replace(assignment, `${key}=${shellQuote(value)}`);
  }
  return `${preflight}\nprintf '%s\\n' WEB_ACTIVATION_PREFLIGHT_OK\n`;
}

type WebActivationFixtureOptions = {
  markerState: "prepared" | "activated" | "coexist" | "absent";
  liveEnvState: "previous" | "candidate" | "arbitrary";
  identicalEnvDigests?: boolean;
  globalMarkerFault?: "mismatch" | "symlink";
  localMarkerSymlink?: boolean;
};

function runWebActivationPreflight(
  root: string,
  options: WebActivationFixtureOptions,
) {
  const remoteFront = join(root, "remote-front");
  const remoteOntology = join(root, "remote-ontology");
  const appVersion = "fault-test-web-v1";
  const releaseDir = join(remoteFront, ".deploy", "releases", appVersion);
  const rollbackDir = join(
    remoteFront,
    ".deploy",
    `code-rollback-${appVersion}`,
  );
  mkdirSync(releaseDir, { recursive: true });
  mkdirSync(rollbackDir, { recursive: true });
  mkdirSync(remoteOntology, { recursive: true });

  const previousEnv = join(root, "previous.env");
  const candidateEnv = join(releaseDir, "runtime.env");
  const arbitraryEnv = join(root, "arbitrary.env");
  writeFileSync(previousEnv, "RUNTIME_ENV=previous\n");
  writeFileSync(
    candidateEnv,
    options.identicalEnvDigests
      ? readFileSync(previousEnv)
      : "RUNTIME_ENV=candidate\n",
  );
  writeFileSync(arbitraryEnv, "RUNTIME_ENV=arbitrary\n");
  const frontArchive = join(releaseDir, "front-source.tar.gz");
  writeFileSync(frontArchive, "sealed archive fixture\n");
  const ontologyArchive = join(releaseDir, "ontology-source.tar.gz");
  const candidateCompose = join(releaseDir, "candidate-compose.resolved.yml");
  writeFileSync(ontologyArchive, "sealed ontology archive fixture\n");
  writeFileSync(candidateCompose, "services: {}\n");

  const rollbackArtifacts = new Map([
    ["verify-supabase-production-target.mjs", "rollback verifier\n"],
    ["atomic-install-sealed-file.mjs", "rollback installer\n"],
    ["production-target.json", '{"format":"krw-production-target/v1"}\n'],
    ["front-source.tar.gz", "rollback source archive\n"],
    ["compose.resolved.yml", "services: {}\n"],
    ["services.tsv", "web\ttrue\tsha256:fault-test-old-web\n"],
  ]);
  for (const [name, payload] of rollbackArtifacts) {
    writeFileSync(join(rollbackDir, name), payload);
    chmodSync(join(rollbackDir, name), 0o600);
  }
  writeFileSync(join(rollbackDir, "runtime.env"), readFileSync(previousEnv));
  chmodSync(join(rollbackDir, "runtime.env"), 0o600);

  const rollbackManifest = join(rollbackDir, "manifest.env");
  writeFileSync(
    rollbackManifest,
    [
      "FORMAT=krw-code-rollback/v2",
      `CUTOVER_APP_VERSION=${appVersion}`,
      "PREVIOUS_APP_VERSION=fault-test-previous-v1",
      "PREVIOUS_WEB_IMAGE_ID=sha256:fault-test-old-web",
      "PREVIOUS_CADDY_IMAGE_ID=sha256:fault-test-old-caddy",
      "ROLLBACK_PROVENANCE=release-registry",
      `RUNTIME_ENV_SHA256=${sha256(previousEnv)}`,
      `TARGET_VERIFIER_SHA256=${sha256(join(rollbackDir, "verify-supabase-production-target.mjs"))}`,
      `ATOMIC_INSTALLER_SHA256=${sha256(join(rollbackDir, "atomic-install-sealed-file.mjs"))}`,
      `PRODUCTION_TARGET_SHA256=${sha256(join(rollbackDir, "production-target.json"))}`,
      `PREVIOUS_FRONT_SOURCE_SHA256=${"d".repeat(64)}`,
      `FRONT_ARCHIVE_SHA256=${sha256(join(rollbackDir, "front-source.tar.gz"))}`,
      `RESOLVED_COMPOSE_SHA256=${sha256(join(rollbackDir, "compose.resolved.yml"))}`,
      `SERVICE_STATE_SHA256=${sha256(join(rollbackDir, "services.tsv"))}`,
      `CADDYFILE_SHA256=${"e".repeat(64)}`,
      "",
    ].join("\n"),
  );
  chmodSync(rollbackManifest, 0o600);
  const releaseManifest = join(releaseDir, "release-manifest.env");
  writeFileSync(
    releaseManifest,
    [
      "FORMAT=krw-production-release-registry/v1",
      `APP_VERSION=${appVersion}`,
      `FRONT_ARCHIVE_SHA256=${sha256(frontArchive)}`,
      `ONTOLOGY_ARCHIVE_SHA256=${sha256(ontologyArchive)}`,
      `RUNTIME_ENV_SHA256=${sha256(candidateEnv)}`,
      "IMAGE_ID=sha256:fault-test-web",
      "CADDY_IMAGE_ID=sha256:fault-test-caddy",
      `FRONT_SOURCE_SHA256=${"a".repeat(64)}`,
      `ONTOLOGY_SOURCE_SHA256=${"b".repeat(64)}`,
      `CANDIDATE_COMPOSE_SHA256=${sha256(candidateCompose)}`,
      `ROLLBACK_MANIFEST_SHA256=${sha256(rollbackManifest)}`,
      "",
    ].join("\n"),
  );
  for (const releaseArtifact of [
    frontArchive,
    ontologyArchive,
    candidateCompose,
    candidateEnv,
    releaseManifest,
  ]) {
    chmodSync(releaseArtifact, 0o400);
  }

  const localMarker = join(releaseDir, "prepared-web-release.env");
  const markerPayload = [
    "FORMAT=krw-prepared-web-release/v2",
    `APP_VERSION=${appVersion}`,
    "IMAGE_ID=sha256:fault-test-web",
    "CADDY_IMAGE_ID=sha256:fault-test-caddy",
    `DEPLOY_CONFIG_SHA256=${"c".repeat(64)}`,
    `RUNTIME_ENV_SHA256=${sha256(candidateEnv)}`,
    `RESOLVED_COMPOSE_SHA256=${sha256(candidateCompose)}`,
    `FRONT_SOURCE_SHA256=${"a".repeat(64)}`,
    `ONTOLOGY_SOURCE_SHA256=${"b".repeat(64)}`,
    `RELEASE_MANIFEST_SHA256=${sha256(releaseManifest)}`,
    "",
  ].join("\n");
  writeFileSync(localMarker, markerPayload);
  chmodSync(localMarker, 0o400);
  if (options.localMarkerSymlink) {
    const markerTarget = join(releaseDir, "prepared-web-release.target.env");
    writeFileSync(markerTarget, markerPayload);
    rmSync(localMarker);
    symlinkSync(markerTarget, localMarker);
  }

  const globalMarker = join(
    remoteFront,
    ".deploy",
    "prepared-web-release.env",
  );
  const activatedMarker = join(releaseDir, "activated-web-release.env");
  if (options.markerState === "prepared" || options.markerState === "coexist") {
    if (options.globalMarkerFault === "symlink") {
      symlinkSync(localMarker, globalMarker);
    } else {
      writeFileSync(
        globalMarker,
        options.globalMarkerFault === "mismatch"
          ? `${markerPayload}TAMPERED=1\n`
          : markerPayload,
      );
      chmodSync(globalMarker, 0o400);
    }
  }
  if (options.markerState === "activated" || options.markerState === "coexist") {
    writeFileSync(activatedMarker, markerPayload);
    chmodSync(activatedMarker, 0o400);
  }

  const liveSource =
    options.liveEnvState === "previous"
      ? previousEnv
      : options.liveEnvState === "candidate"
        ? candidateEnv
        : arbitraryEnv;
  writeFileSync(join(remoteFront, ".env"), readFileSync(liveSource), {
    mode: 0o600,
  });

  const command = extractWebActivationPreflight({
    REMOTE_FRONT_DIR: remoteFront,
    REMOTE_ONTOLOGY_DIR: remoteOntology,
    EXPECTED_APP_VERSION: appVersion,
    EXPECTED_FRONT_SOURCE_SHA256: "a".repeat(64),
    EXPECTED_ONTOLOGY_SOURCE_SHA256: "b".repeat(64),
    EXPECTED_ADMIN_EMAILS_SHA256: "d".repeat(64),
    EXPECTED_PRODUCTION_ENV_SHA256: sha256(candidateEnv),
    EXPECTED_SUPABASE_PROJECT_REF: "fault-test-project",
  });
  return spawnSync("/bin/sh", ["-c", command], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 10_000,
  });
}

function extractCandidateRecoveryBody() {
  const source = readFileSync(
    join(repoRoot, "scripts", "pause-production-cutover.sh"),
    "utf8",
  );
  const adoptionAnchor = source.indexOf("adopt_interrupted_cutover_owner\n");
  expect(adoptionAnchor).toBeGreaterThan(-1);
  const branchAnchor = source.indexOf(
    'if [ "$ACTION" = activate-prepared ]; then\n',
    adoptionAnchor,
  );
  expect(branchAnchor).toBeGreaterThan(adoptionAnchor);
  const bodyStart = branchAnchor +
    'if [ "$ACTION" = activate-prepared ]; then\n'.length;
  const bodyEnd = source.indexOf(
    '\nfi\n\nif [ "$ACTION" = pause ]; then',
    bodyStart,
  );
  expect(bodyEnd).toBeGreaterThan(bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

type CandidateRecoveryFixtureOptions = {
  migrated?: boolean;
  macExit?: number;
  webExit?: number;
  webActivatorSymlink?: boolean;
};

function runCandidateRecoveryTransaction(
  root: string,
  options: CandidateRecoveryFixtureOptions = {},
) {
  const eventLog = join(root, "events.log");
  const scriptDir = join(root, "sealed-scripts");
  const frontDir = join(root, "front");
  const runtimeBase = join(root, "mac-runtimes");
  const deploymentId = "fault-test-cutover-v1";
  const runtimeRoot = join(runtimeBase, deploymentId);
  const migrationMarker = join(root, "migration-started.marker");
  const envPath = join(root, "production.env");
  mkdirSync(scriptDir, { recursive: true });
  mkdirSync(join(runtimeRoot, "scripts"), { recursive: true });
  mkdirSync(frontDir, { recursive: true });
  writeFileSync(eventLog, "");
  writeCanonicalEnv(envPath);
  if (options.migrated) writeFileSync(migrationMarker, "started\n");

  const writeExecutable = (path: string, lines: string[]) => {
    writeFileSync(path, `${lines.join("\n")}\n`);
    chmodSync(path, 0o755);
  };
  const macActivator = join(
    runtimeRoot,
    "scripts",
    "activate-prepared-mac-runtime.sh",
  );
  writeExecutable(macActivator, [
    "#!/bin/sh",
    'printf "%s\\n" mac_activate >> "$EVENT_LOG"',
    'exit "${MAC_EXIT:-0}"',
  ]);
  const webActivator = join(scriptDir, "deploy-web-production.sh");
  const realWebActivator = join(root, "real-web-activator.sh");
  writeExecutable(realWebActivator, [
    "#!/bin/sh",
    'printf "%s\\n" web_activate >> "$EVENT_LOG"',
    'exit "${WEB_EXIT:-0}"',
  ]);
  if (options.webActivatorSymlink) {
    symlinkSync(realWebActivator, webActivator);
  } else {
    writeFileSync(webActivator, readFileSync(realWebActivator));
    chmodSync(webActivator, 0o755);
  }
  writeExecutable(join(scriptDir, "compute-admin-email-set-sha256.mjs"), [
    "#!/usr/bin/env node",
    `process.stdout.write(${JSON.stringify("d".repeat(64))});`,
  ]);
  writeFileSync(
    join(runtimeRoot, "runtime-identity.json"),
    `${JSON.stringify({
      frontSourceSha256: "a".repeat(64),
      ontologySourceSha256: "b".repeat(64),
    })}\n`,
  );

  const prelude = [
    "set -eu",
    `EVENT_LOG=${shellQuote(eventLog)}`,
    `SCRIPT_DIR=${shellQuote(scriptDir)}`,
    `FRONT_DIR=${shellQuote(frontDir)}`,
    `MAC_RUNTIME_BASE=${shellQuote(runtimeBase)}`,
    `NEXT_PUBLIC_APP_VERSION=${shellQuote(deploymentId)}`,
    `MIGRATION_STARTED_MARKER=${shellQuote(migrationMarker)}`,
    `CUTOVER_PHASE_FILE=${shellQuote(join(root, "cutover-phase.env"))}`,
    `ENV_PATH=${shellQuote(envPath)}`,
    `EXPECTED_ENV_SHA256=${shellQuote(sha256(envPath))}`,
    `CANDIDATE_MAC_RUNTIME_SEAL_SHA256=${shellQuote("e".repeat(64))}`,
    `UNSEALED_BOOTSTRAP_PROOF=${shellQuote(join(root, "missing-bootstrap-proof"))}`,
    `UNSEALED_BOOTSTRAP_PROOF_SHA=${shellQuote(join(root, "missing-bootstrap-proof.sha256"))}`,
    `UNSEALED_BOOTSTRAP_MARKER=${shellQuote(join(root, "bootstrap-complete.json"))}`,
    `MAC_EXIT=${options.macExit ?? 0}`,
    `WEB_EXIT=${options.webExit ?? 0}`,
    `recovery_phase=${options.migrated ? "migration_verified" : "activating_code_only"}`,
    "export EVENT_LOG MAC_EXIT WEB_EXIT",
    "assert_remote_recovery_identity() { :; }",
    'emergency_fail_closed_local_stop() { printf "%s\\n" local_stop >> "$EVENT_LOG"; }',
    'emergency_fail_closed_remote_stop() { printf "%s\\n" remote_stop >> "$EVENT_LOG"; }',
    'write_cutover_phase() { printf "phase:%s\\n" "$1" >> "$EVENT_LOG"; }',
    "",
  ].join("\n");
  const result = spawnSync(
    "/bin/sh",
    ["-c", `${prelude}${extractCandidateRecoveryBody()}\n`],
    { cwd: repoRoot, encoding: "utf8", timeout: 10_000 },
  );
  return {
    result,
    events: readFileSync(eventLog, "utf8").trim().split("\n").filter(Boolean),
  };
}

function runCandidateRecoveryPhaseAdmission(
  root: string,
  phase: string,
  migrationStarted: boolean,
) {
  const source = readFileSync(
    join(repoRoot, "scripts", "pause-production-cutover.sh"),
    "utf8",
  );
  const branchStart = source.indexOf(
    [
      'if [ "$ACTION" = resume ] || [ "$ACTION" = resume-remote ] \\',
      '  || [ "$ACTION" = activate-prepared ] || [ "$ACTION" = abandon-prepared ]; then',
      "",
    ].join("\n"),
  );
  expect(branchStart).toBeGreaterThan(-1);
  const bodyStart = source.indexOf("  test -f", branchStart);
  const bodyEnd = source.indexOf(
    '  validate_cutover_phase_provenance "$CUTOVER_PHASE_FILE"',
    bodyStart,
  );
  expect(bodyEnd).toBeGreaterThan(bodyStart);

  const deploymentId = "fault-test-cutover-v1";
  const lockOwner = "fault-test-owner";
  const phaseFile = join(root, "phase.env");
  const migrationMarker = join(root, "migration-started.marker");
  const mutationLog = join(root, "mutations.log");
  writeFileSync(
    phaseFile,
    [
      "FORMAT=krw-production-cutover-phase/v1",
      `DEPLOYMENT_ID=${deploymentId}`,
      `LOCK_OWNER=${lockOwner}`,
      `PHASE=${phase}`,
      "",
    ].join("\n"),
  );
  writeFileSync(mutationLog, "");
  if (migrationStarted) writeFileSync(migrationMarker, "started\n");
  const body = source.slice(bodyStart, bodyEnd);
  const command = [
    "set -eu",
    "ACTION=activate-prepared",
    `CUTOVER_PHASE_FILE=${shellQuote(phaseFile)}`,
    `NEXT_PUBLIC_APP_VERSION=${shellQuote(deploymentId)}`,
    `PRODUCTION_DEPLOY_LOCK_OWNER=${shellQuote(lockOwner)}`,
    "ADOPT_PREVIOUS_LOCK_OWNER=",
    `MIGRATION_STARTED_MARKER=${shellQuote(migrationMarker)}`,
    body,
    `printf '%s\\n' mutator >> ${shellQuote(mutationLog)}`,
    "",
  ].join("\n");
  const result = spawnSync("/bin/sh", ["-c", command], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 10_000,
  });
  return { result, mutations: readFileSync(mutationLog, "utf8") };
}

describe("production cutover fault injection", () => {
  it("atomically installs only same-directory files that match their seal", () => {
    const root = mkdtempSync(join(tmpdir(), "krw-atomic-install-"));
    try {
      const source = join(root, ".env.next");
      const destination = join(root, ".env");
      writeFileSync(source, "candidate\n");
      writeFileSync(destination, "previous\n");
      const accepted = spawnSync(
        process.execPath,
        [atomicInstaller, source, destination, sha256(source), "600"],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expect(accepted.status, accepted.stderr).toBe(0);
      expect(existsSync(source)).toBe(false);
      expect(readFileSync(destination, "utf8")).toBe("candidate\n");
      expect(statSync(destination).mode & 0o777).toBe(0o600);

      writeFileSync(source, "tampered\n");
      const rejectedDigest = spawnSync(
        process.execPath,
        [atomicInstaller, source, destination, "0".repeat(64), "600"],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expectRejected(rejectedDigest, "does not match its expected digest");
      expect(readFileSync(destination, "utf8")).toBe("candidate\n");
      expect(readFileSync(source, "utf8")).toBe("tampered\n");

      rmSync(source);
      symlinkSync(destination, source);
      const rejectedSymlink = spawnSync(
        process.execPath,
        [atomicInstaller, source, destination, sha256(destination), "600"],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expectRejected(rejectedSymlink, "source must be a regular non-symlink");

      rmSync(source);
      const otherDirectory = join(root, "other");
      mkdirSync(otherDirectory);
      const otherSource = join(otherDirectory, ".env.next");
      writeFileSync(otherSource, "other\n");
      const rejectedDirectory = spawnSync(
        process.execPath,
        [atomicInstaller, otherSource, destination, sha256(otherSource), "600"],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expectRejected(rejectedDirectory, "must share one directory");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps a missing ADMIN_EMAILS exception bound to a cross-sealed bootstrap rollback", () => {
    const root = mkdtempSync(join(tmpdir(), "krw-rollback-admin-proof-"));
    try {
      const targetFile = join(root, "production-target.json");
      const envFile = join(root, "runtime.env");
      const rollbackManifest = join(root, "rollback.env");
      const releaseManifest = join(root, "release.env");
      const rollbackSourceRoot = join(root, "rollback-source");
      mkdirSync(rollbackSourceRoot);
      writeFileSync(join(rollbackSourceRoot, "app.js"), "export const ok = true;\n");
      const sourceHashResult = spawnSync(
        process.execPath,
        [sourceHasher, rollbackSourceRoot],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expect(sourceHashResult.status, sourceHashResult.stderr).toBe(0);
      const rollbackSourceSha256 = sourceHashResult.stdout;
      writeFileSync(
        targetFile,
        readFileSync(join(repoRoot, "ops", "production-target.json")),
      );
      writeFileSync(
        envFile,
        [
          "SUPABASE_URL=https://deaumgysfwfcctzhbaxb.supabase.co",
          "NEXT_PUBLIC_SUPABASE_URL=https://deaumgysfwfcctzhbaxb.supabase.co",
          "SUPABASE_SERVICE_ROLE_KEY=fault-test-service-role-key",
          "SUPABASE_ANON_KEY=sb_publishable_fault_test",
          "NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_fault_test",
          "",
        ].join("\n"),
      );

      expectRejected(
        runProductionTargetVerifier(envFile, targetFile),
        "Production env must define ADMIN_EMAILS exactly once",
      );

      const writeProof = (provenance: "bootstrap" | "release-registry") => {
        writeFileSync(
          rollbackManifest,
          [
            "FORMAT=krw-code-rollback/v2",
            `ROLLBACK_PROVENANCE=${provenance}`,
            `RUNTIME_ENV_SHA256=${sha256(envFile)}`,
            `PREVIOUS_FRONT_SOURCE_SHA256=${rollbackSourceSha256}`,
            "",
          ].join("\n"),
        );
        writeFileSync(
          releaseManifest,
          [
            "FORMAT=krw-production-release-registry/v1",
            `ROLLBACK_MANIFEST_SHA256=${sha256(rollbackManifest)}`,
            "",
          ].join("\n"),
        );
      };
      const proofOptions = () => [
        "--rollback-proof",
        rollbackManifest,
        releaseManifest,
        "--rollback-source-root",
        rollbackSourceRoot,
      ];

      writeProof("bootstrap");
      const accepted = runProductionTargetVerifier(
        envFile,
        targetFile,
        proofOptions(),
      );
      expect(accepted.status, accepted.stderr).toBe(0);

      writeProof("release-registry");
      expectRejected(
        runProductionTargetVerifier(envFile, targetFile, proofOptions()),
        "Production env must define ADMIN_EMAILS exactly once",
      );

      writeProof("bootstrap");
      writeFileSync(releaseManifest, [
        "FORMAT=krw-production-release-registry/v1",
        "ROLLBACK_MANIFEST_SHA256=deadbeef",
        "",
      ].join("\n"));
      expectRejected(
        runProductionTargetVerifier(envFile, targetFile, proofOptions()),
        "not cross-sealed",
      );

      writeFileSync(
        envFile,
        `${readFileSync(envFile, "utf8")}ADMIN_EMAILS=one@example.com\nADMIN_EMAILS=two@example.com\n`,
      );
      writeProof("bootstrap");
      expectRejected(
        runProductionTargetVerifier(envFile, targetFile, proofOptions()),
        "Production env must define ADMIN_EMAILS exactly once",
      );

      writeCanonicalEnv(envFile);
      writeFileSync(
        envFile,
        readFileSync(envFile, "utf8").replace(
          "ADMIN_EMAILS=admin@example.com",
          "ADMIN_EMAILS=",
        ),
      );
      writeProof("bootstrap");
      expectRejected(
        runProductionTargetVerifier(envFile, targetFile, proofOptions()),
        "Production ADMIN_EMAILS must not be empty",
      );

      writeCanonicalEnv(envFile);
      writeFileSync(
        envFile,
        readFileSync(envFile, "utf8").replace(
          "ADMIN_EMAILS=admin@example.com",
          "ADMIN_EMAILS=not-an-email",
        ),
      );
      writeProof("bootstrap");
      expectRejected(
        runProductionTargetVerifier(envFile, targetFile, proofOptions()),
        "Production ADMIN_EMAILS contains an invalid address",
      );

      writeCanonicalEnv(envFile);
      writeProof("bootstrap");
      const validBootstrapAdmin = runProductionTargetVerifier(
        envFile,
        targetFile,
        proofOptions(),
      );
      expect(validBootstrapAdmin.status, validBootstrapAdmin.stderr).toBe(0);

      expectRejected(
        runProductionTargetVerifier(envFile, targetFile, ["--unknown-option"]),
        "Unknown option",
      );

      writeCanonicalEnv(envFile);
      writeFileSync(
        envFile,
        readFileSync(envFile, "utf8").replace(
          "ADMIN_EMAILS=admin@example.com",
          "ADMIN_EMAILS=",
        ),
      );
      expectRejected(
        runProductionTargetVerifier(envFile, targetFile),
        "Production ADMIN_EMAILS must not be empty",
      );
      writeFileSync(
        envFile,
        readFileSync(envFile, "utf8").replace(
          "ADMIN_EMAILS=",
          "ADMIN_EMAILS=admin@example.com",
        ),
      );
      const strictAccepted = runProductionTargetVerifier(envFile, targetFile);
      expect(strictAccepted.status, strictAccepted.stderr).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("binds every rollback proof to one valid canonical frontend source identity", () => {
    const root = mkdtempSync(join(tmpdir(), "krw-rollback-source-proof-"));
    try {
      const targetFile = join(root, "production-target.json");
      const envFile = join(root, "runtime.env");
      const rollbackManifest = join(root, "rollback.env");
      const releaseManifest = join(root, "release.env");
      const rollbackSourceRoot = join(root, "rollback-source");
      mkdirSync(rollbackSourceRoot);
      writeFileSync(join(rollbackSourceRoot, "app.js"), "export const value = 1;\n");
      mkdirSync(join(rollbackSourceRoot, "required-empty"));
      writeFileSync(join(rollbackSourceRoot, "tool.sh"), "#!/bin/sh\nexit 0\n");
      chmodSync(join(rollbackSourceRoot, "tool.sh"), 0o755);
      symlinkSync("app.js", join(rollbackSourceRoot, "current-app"));
      mkdirSync(join(rollbackSourceRoot, ".playwright-cli"));
      writeFileSync(
        join(rollbackSourceRoot, ".playwright-cli", "runtime.log"),
        "ignored\n",
      );
      writeFileSync(
        targetFile,
        readFileSync(join(repoRoot, "ops", "production-target.json")),
      );
      writeCanonicalEnv(envFile);

      const sourceDigest = () => {
        const result = spawnSync(
          process.execPath,
          [sourceHasher, rollbackSourceRoot],
          { cwd: repoRoot, encoding: "utf8" },
        );
        expect(result.status, result.stderr).toBe(0);
        return result.stdout;
      };
      const writeProof = (sourceFields: string[]) => {
        writeFileSync(
          rollbackManifest,
          [
            "FORMAT=krw-code-rollback/v2",
            "ROLLBACK_PROVENANCE=bootstrap",
            `RUNTIME_ENV_SHA256=${sha256(envFile)}`,
            ...sourceFields,
            "",
          ].join("\n"),
        );
        writeFileSync(
          releaseManifest,
          [
            "FORMAT=krw-production-release-registry/v1",
            `ROLLBACK_MANIFEST_SHA256=${sha256(rollbackManifest)}`,
            "",
          ].join("\n"),
        );
      };
      const proofOptions = () => [
        "--rollback-proof",
        rollbackManifest,
        releaseManifest,
        "--rollback-source-root",
        rollbackSourceRoot,
      ];

      const originalDigest = sourceDigest();
      writeProof([`PREVIOUS_FRONT_SOURCE_SHA256=${originalDigest}`]);
      const accepted = runProductionTargetVerifier(
        envFile,
        targetFile,
        proofOptions(),
      );
      expect(accepted.status, accepted.stderr).toBe(0);

      expectRejected(
        runProductionTargetVerifier(envFile, targetFile, [
          "--rollback-proof",
          rollbackManifest,
          releaseManifest,
        ]),
        "must be supplied together",
      );

      writeProof([]);
      expectRejected(
        runProductionTargetVerifier(envFile, targetFile, proofOptions()),
        "must define PREVIOUS_FRONT_SOURCE_SHA256 exactly once",
      );

      writeProof([
        `PREVIOUS_FRONT_SOURCE_SHA256=${originalDigest}`,
        `PREVIOUS_FRONT_SOURCE_SHA256=${originalDigest}`,
      ]);
      expectRejected(
        runProductionTargetVerifier(envFile, targetFile, proofOptions()),
        "must define PREVIOUS_FRONT_SOURCE_SHA256 exactly once",
      );

      writeProof(["PREVIOUS_FRONT_SOURCE_SHA256=not-a-digest"]);
      expectRejected(
        runProductionTargetVerifier(envFile, targetFile, proofOptions()),
        "must be a lowercase SHA-256 digest",
      );

      writeProof([`PREVIOUS_FRONT_SOURCE_SHA256=${originalDigest}`]);
      writeFileSync(join(rollbackSourceRoot, "app.js"), "export const value = 2;\n");
      expectRejected(
        runProductionTargetVerifier(envFile, targetFile, proofOptions()),
        "does not match PREVIOUS_FRONT_SOURCE_SHA256",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps isolated release-gate dependencies inside the Turbopack root", () => {
    const releaseGate = readFileSync(
      join(repoRoot, "scripts", "run-production-release-gates.sh"),
      "utf8",
    );
    expect(releaseGate).toContain(
      'npm ci --include=dev --no-audit --no-fund',
    );
    expect(releaseGate).toContain(
      "for dependency_manifest in package.json package-lock.json",
    );
    expect(releaseGate).toContain("VITEST_MAX_WORKERS=4 npm run check");
    expect(releaseGate).toContain("EXPECTED_SOURCE_SHA256=$(node");
    expect(releaseGate).toContain(
      '"$GATE_DIR/scripts/compute-production-source-sha256.mjs" "$GATE_DIR"',
    );
    expect(releaseGate).toContain(
      "Isolated release-gate source changed while its checks were running.",
    );
    expect(releaseGate).toContain(
      'node "$GATE_DIR/scripts/verify-contained-symlinks.mjs"',
    );
    expect(releaseGate).not.toContain(
      'ln -s "$FRONT_DIR/node_modules" "$GATE_DIR/node_modules"',
    );
    expect(releaseGate).not.toContain(
      'cp -cR "$FRONT_DIR/node_modules" "$GATE_DIR/node_modules"',
    );

    const root = mkdtempSync(join(tmpdir(), "krw-contained-links-test-"));
    try {
      const dependencies = join(root, "node_modules");
      const packageDir = join(dependencies, "package");
      const external = join(root, "external.txt");
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(join(packageDir, "index.js"), "export {};\n");
      writeFileSync(external, "outside\n");
      symlinkSync("package", join(dependencies, "internal-package"));

      const accepted = spawnSync(
        process.execPath,
        [containedSymlinkVerifier, dependencies],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expect(accepted.status, accepted.stderr).toBe(0);

      symlinkSync(external, join(dependencies, "external-package"));
      const rejected = spawnSync(
        process.execPath,
        [containedSymlinkVerifier, dependencies],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain("Symlink escapes the contained tree");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps production source identity aligned with copied artifact semantics", () => {
    const root = mkdtempSync(join(tmpdir(), "krw-source-identity-test-"));
    try {
      const frontLocal = join(root, "front-local");
      const frontCopy = join(root, "front-copy");
      const ontologyLocal = join(root, "ontology-local");
      const ontologyCopy = join(root, "ontology-copy");
      for (const directory of [frontLocal, frontCopy, ontologyLocal, ontologyCopy]) {
        mkdirSync(directory, { recursive: true });
      }
      writeFileSync(join(frontLocal, "app.ts"), "export const value = 1;\n");
      writeFileSync(join(frontCopy, "app.ts"), "export const value = 1;\n");
      // Next.js owns this generated file and rewrites its route reference when
      // an isolated E2E build switches from `.next` to `.next-e2e`.
      writeFileSync(
        join(frontLocal, "next-env.d.ts"),
        'import "./.next/types/routes.d.ts";\n',
      );
      writeFileSync(
        join(frontCopy, "next-env.d.ts"),
        'import "./.next-e2e/types/routes.d.ts";\n',
      );
      writeFileSync(join(frontLocal, ".env.example"), "IGNORED=local\n");
      symlinkSync("../ontology-local", join(frontLocal, "krw-ontology"));
      symlinkSync("/srv/krw-ontology", join(frontCopy, "krw-ontology"));

      writeFileSync(join(ontologyLocal, "pyproject.toml"), "[project]\nname='x'\n");
      writeFileSync(join(ontologyCopy, "pyproject.toml"), "[project]\nname='x'\n");
      writeFileSync(join(ontologyLocal, ".env.example"), "IGNORED=ontology\n");
      mkdirSync(join(ontologyLocal, "dist"));
      writeFileSync(join(ontologyLocal, "dist", "generated.js"), "ignored\n");

      const hash = (directory: string) => {
        const result = spawnSync(process.execPath, [sourceHasher, directory], {
          cwd: repoRoot,
          encoding: "utf8",
        });
        expect(result.status).toBe(0);
        return result.stdout;
      };
      expect(hash(frontLocal)).toBe(hash(frontCopy));
      expect(hash(ontologyLocal)).toBe(hash(ontologyCopy));
      writeFileSync(join(frontCopy, "app.ts"), "export const value = 2;\n");
      expect(hash(frontLocal)).not.toBe(hash(frontCopy));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses unambiguous typed source records and seals executability plus directory presence", () => {
    const root = mkdtempSync(join(tmpdir(), "krw-source-record-test-"));
    try {
      const single = join(root, "single");
      const split = join(root, "split");
      const regular = join(root, "regular");
      const linked = join(root, "linked");
      const nonExecutable = join(root, "non-executable");
      const executable = join(root, "executable");
      const withoutEmpty = join(root, "without-empty");
      const withEmpty = join(root, "with-empty");
      for (const directory of [
        single,
        split,
        regular,
        linked,
        nonExecutable,
        executable,
        withoutEmpty,
        withEmpty,
      ]) {
        mkdirSync(directory);
      }
      writeFileSync(join(single, "a"), Buffer.from("X\0b\0Y"));
      writeFileSync(join(split, "a"), "X");
      writeFileSync(join(split, "b"), "Y");
      writeFileSync(join(regular, "entry"), "symlink:target");
      symlinkSync("target", join(linked, "entry"));
      writeFileSync(join(nonExecutable, "tool"), "same bytes\n");
      writeFileSync(join(executable, "tool"), "same bytes\n");
      chmodSync(join(nonExecutable, "tool"), 0o644);
      chmodSync(join(executable, "tool"), 0o755);
      mkdirSync(join(withEmpty, "required-empty"));

      const hash = (directory: string) => {
        const result = spawnSync(process.execPath, [sourceHasher, directory], {
          cwd: repoRoot,
          encoding: "utf8",
        });
        expect(result.status, result.stderr).toBe(0);
        return result.stdout;
      };
      expect(hash(single)).not.toBe(hash(split));
      expect(hash(regular)).not.toBe(hash(linked));
      expect(hash(nonExecutable)).not.toBe(hash(executable));
      expect(hash(withoutEmpty)).not.toBe(hash(withEmpty));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("archives nested ontology plugin sources without hashing the host-specific root link", () => {
    const deployWeb = readFileSync(
      join(repoRoot, "scripts", "deploy-web-production.sh"),
      "utf8",
    );
    expect(deployWeb).toContain('"$FRONT_DIR" --list0 >"$FRONT_FILE_LIST"');
    expect(deployWeb).toContain('--no-recursion --null -T "$FRONT_FILE_LIST"');
    expect(deployWeb).toContain('--no-recursion --null -T "$ONTOLOGY_FILE_LIST"');
    expect(deployWeb).toContain(
      'cp "\\$ONTOLOGY_ARCHIVE" "\\$RELEASE_DIR/ontology-source.tar.gz"',
    );
    expect(deployWeb).toContain(
      'KRW_ONTOLOGY_SOURCE_DIR="\\$ONTOLOGY_STAGE"',
    );
    expect(deployWeb).not.toContain(
      '"\\$ONTOLOGY_STAGE/" "\\$REMOTE_ONTOLOGY_DIR/"',
    );
    expect(deployWeb).toContain(
      "rm -f '$REMOTE_FRONT_ARCHIVE' '$REMOTE_ONTOLOGY_ARCHIVE'",
    );
    expect(deployWeb).toContain(
      'chmod 600 "$FRONT_ARCHIVE" "$ONTOLOGY_ARCHIVE"',
    );
    expect(deployWeb.match(/--tmpfs \/data:rw,noexec,nosuid,size=16m/g)).toHaveLength(
      2,
    );
    expect(
      deployWeb.match(/--tmpfs \/config:rw,noexec,nosuid,size=16m/g),
    ).toHaveLength(2);
    expect(deployWeb).toContain('PREPARE_SUCCEEDED=0');
    expect(deployWeb).toContain(
      '[ -z "\\$CREATED_RELEASE_DIR" ] || rm -rf "\\$CREATED_RELEASE_DIR"',
    );
    expect(deployWeb).toContain('PREPARE_SUCCEEDED=1');
    expect(deployWeb).toContain(
      "process.stdout.write(target.supabaseProjectRef)' ./ops/production-target.json",
    );
    expect(deployWeb).not.toContain(
      "process.stdout.write(target.supabaseProjectRef)' ops/production-target.json",
    );
    expect(deployWeb).not.toContain(
      '-C "\\$REMOTE_ONTOLOGY_DIR" .',
    );
    expect(deployWeb).toContain(
      "--exclude '/krw-ontology' --exclude '/krw-ontology/'",
    );
    expect(deployWeb).not.toContain(
      "--exclude 'krw-ontology' --exclude 'krw-ontology/'",
    );
    expect(deployWeb).not.toContain("--exclude='./krw-ontology'");

    const root = mkdtempSync(join(tmpdir(), "krw-source-archive-test-"));
    try {
      const source = join(root, "source");
      const extracted = join(root, "extracted");
      const ontology = join(root, "ontology-local");
      const nestedPlugin = join(
        source,
        "ref",
        "plugins",
        "dev",
        "krw-ontology",
      );
      const nestedApiOut = join(source, "src", "app", "api", "out");
      const ignoredRootOut = join(source, "out");
      const ignoredToolState = join(source, ".gstack");
      const ignoredAgentWorkspace = join(source, ".agent-workspace");
      const ignoredPlaywrightState = join(source, ".playwright-cli");
      const ignoredTemp = join(source, "_temp");
      const requiredEmpty = join(source, "runtime", "required-empty");
      const executableTool = join(source, "scripts", "tool.sh");
      const archive = join(root, "front.tar.gz");
      const fileList = join(root, "front.list0");
      mkdirSync(nestedPlugin, { recursive: true });
      mkdirSync(nestedApiOut, { recursive: true });
      mkdirSync(ignoredRootOut);
      mkdirSync(ignoredToolState);
      mkdirSync(ignoredAgentWorkspace);
      mkdirSync(ignoredPlaywrightState);
      mkdirSync(ignoredTemp);
      mkdirSync(requiredEmpty, { recursive: true });
      mkdirSync(join(source, "scripts"));
      mkdirSync(extracted);
      mkdirSync(ontology);
      writeFileSync(join(source, "app.ts"), "export const value = 1;\n");
      writeFileSync(join(nestedPlugin, "SKILL.md"), "nested plugin source\n");
      writeFileSync(join(nestedApiOut, "route.ts"), "export const GET = 1;\n");
      writeFileSync(join(ignoredRootOut, "generated.html"), "ignored\n");
      writeFileSync(join(ignoredToolState, "browse.json"), '{"token":"secret"}\n');
      writeFileSync(join(ignoredAgentWorkspace, "state.json"), "ignored\n");
      writeFileSync(join(ignoredPlaywrightState, "page.yml"), "ignored\n");
      writeFileSync(join(ignoredTemp, "scratch.txt"), "ignored\n");
      writeFileSync(executableTool, "#!/bin/sh\nexit 0\n");
      chmodSync(executableTool, 0o755);
      chmodSync(requiredEmpty, 0o750);
      writeFileSync(join(source, ".env.example"), "IGNORED=1\n");
      symlinkSync("../ontology-local", join(source, "krw-ontology"));

      const listed = spawnSync(
        process.execPath,
        [sourceHasher, source, "--list0"],
        { cwd: repoRoot },
      );
      expect(listed.status, listed.stderr.toString()).toBe(0);
      writeFileSync(fileList, listed.stdout);
      const created = spawnSync(
        "tar",
        ["-czf", archive, "--no-recursion", "--null", "-T", fileList],
        { cwd: source, encoding: "utf8" },
      );
      expect(created.status, created.stderr).toBe(0);
      const unpacked = spawnSync("tar", ["-xzf", archive, "-C", extracted], {
        encoding: "utf8",
      });
      expect(unpacked.status, unpacked.stderr).toBe(0);
      expect(
        existsSync(
          join(
            extracted,
            "ref",
            "plugins",
            "dev",
            "krw-ontology",
            "SKILL.md",
          ),
        ),
      ).toBe(true);
      expect(existsSync(join(extracted, "src", "app", "api", "out", "route.ts"))).toBe(
        true,
      );
      expect(existsSync(join(extracted, "out"))).toBe(false);
      expect(existsSync(join(extracted, ".gstack"))).toBe(false);
      expect(existsSync(join(extracted, ".agent-workspace"))).toBe(false);
      expect(existsSync(join(extracted, ".playwright-cli"))).toBe(false);
      expect(existsSync(join(extracted, "_temp"))).toBe(false);
      expect(existsSync(join(extracted, ".env.example"))).toBe(false);
      expect(existsSync(join(extracted, "krw-ontology"))).toBe(false);
      // The production source identity intentionally normalizes ambient
      // umask-derived group/other bits. An isolated release gate runs under
      // umask 077, while an interactive checkout is typically 022. Preserve
      // only the semantic requirements: the owner can traverse the directory
      // and the script remains owner-executable.
      expect(
        statSync(join(extracted, "runtime", "required-empty")).mode & 0o700,
      ).toBe(0o700);
      expect(statSync(join(extracted, "scripts", "tool.sh")).mode & 0o100).toBe(
        0o100,
      );

      const hash = (directory: string) => {
        const result = spawnSync(process.execPath, [sourceHasher, directory], {
          cwd: repoRoot,
          encoding: "utf8",
        });
        expect(result.status, result.stderr).toBe(0);
        return result.stdout;
      };
      expect(hash(extracted)).toBe(hash(source));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps every production cutover shell entrypoint syntactically valid", () => {
    for (const script of [
      "deploy-all-production.sh",
      "deploy-web-production.sh",
      "deploy-plugin-worker-production.sh",
      "deploy-production-simple.sh",
      "deploy-with-queue-pause.sh",
      "pause-production-cutover.sh",
      "recover-production-cutover.sh",
      "deploy-vm-compose.sh",
      "deploy-data-release-production.sh",
    ]) {
      const result = spawnSync("/bin/sh", ["-n", join(repoRoot, "scripts", script)], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      expect(result.status, `${script}: ${result.stderr}`).toBe(0);
    }
    const pinnerSyntax = spawnSync(
      process.execPath,
      ["--check", supabaseCliPinner],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(pinnerSyntax.status, pinnerSyntax.stderr).toBe(0);
  });

  it("seals the one-time legacy Mac bootstrap behind the queue-safe full cutover", () => {
    const deployAll = readFileSync(join(repoRoot, "scripts", "deploy-all-production.sh"), "utf8");
    const wrapper = readFileSync(join(repoRoot, "scripts", "deploy-with-queue-pause.sh"), "utf8");
    const pause = readFileSync(join(repoRoot, "scripts", "pause-production-cutover.sh"), "utf8");
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(wrapper).toContain("--bootstrap-unsealed-mac-runtime");
    expect(wrapper).toContain('DEPLOY_ARGS="$DEPLOY_ARGS --bootstrap-unsealed-mac-runtime"');
    expect(wrapper).toContain("--recover-cutover");
    expect(wrapper).toContain("--recovery-only");
    expect(wrapper).toContain("--recovery-action");
    expect(wrapper).toContain("--previous-lock-owner");
    expect(packageJson.scripts["prod:deploy:bootstrap"]).toBe(
      "scripts/deploy-production-simple.sh --bootstrap-unsealed-mac-runtime --apply-migrations",
    );
    expect(packageJson.scripts["prod:deploy:recover"]).toBe(
      "scripts/deploy-with-queue-pause.sh --recovery-only",
    );
    expect(deployAll).toContain("PRODUCTION_UNSEALED_BOOTSTRAP_ATTESTATION");
    expect(deployAll).toContain("complete_unsealed_mac_bootstrap");
    expect(deployAll).toContain("resume-remote");
    expect(pause).toContain("unsealed-fail-closed");
    expect(pause).toContain("gcp-only-mac-fail-closed");
    expect(pause).toContain("--adopt-previous-lock-owner");
    expect(pause).toContain("adopt_interrupted_cutover_owner");
    expect(pause).toContain("PREVIOUS_LOCK_OWNER=");
    expect(pause).toContain("ADOPTED_AT=");
    expect(pause).toContain("Release registry and rollback manifest cross-seal disagree");
    expect(pause).toContain("LOCAL_ROLLBACK_SEAL=");
    expect(pause.indexOf("write_cutover_phase pausing_pre_migration")).toBeLessThan(
      pause.indexOf('"$SCRIPT_DIR/uninstall-mac-worker-launchd.sh"'),
    );
  });

  it("pins migration inputs before gates and uses a disposable Supabase CLI worktree", () => {
    const deployAll = readFileSync(join(repoRoot, "scripts", "deploy-all-production.sh"), "utf8");
    const pause = readFileSync(join(repoRoot, "scripts", "pause-production-cutover.sh"), "utf8");
    const recover = readFileSync(join(repoRoot, "scripts", "recover-production-cutover.sh"), "utf8");
    expect(deployAll.indexOf("INITIAL_FRONT_SOURCE_SHA256=")).toBeLessThan(
      deployAll.indexOf('rsync -a --delete "$FRONT_DIR/supabase/"'),
    );
    expect(deployAll).toContain('diff -qr "$FRONT_DIR/supabase" "$CUTOVER_SNAPSHOT/supabase"');
    expect(deployAll).toContain('--path "$CUTOVER_SNAPSHOT/supabase"');
    expect(deployAll).toContain("krw-supabase-cutover.XXXXXX");
    expect(deployAll).toContain("krw-supabase-apply.XXXXXX");
    expect(deployAll.indexOf('assert_deploy_source_unchanged "migration-apply-final"')).toBeLessThan(
      deployAll.indexOf("write_cutover_phase migration_started"),
    );
    expect(deployAll).toContain('"$SCRIPT_DIR/pin-supabase-cli.mjs"');
    expect(deployAll).toContain("REQUESTS_DRY_RUN_LOCK=1");
    expect(deployAll).toContain(
      'lockf -t 0 -k "$EARLY_FRONT_DIR/.deploy/production-deploy.os-lock"',
    );
    expect(deployAll).toContain(
      'PRODUCTION_DEPLOY_LOCK_OWNER="dry-run-$$-$(date -u +%Y%m%d%H%M%S)"',
    );
    expect(deployAll).toContain('PINNED_SUPABASE_GO_CLI="$CUTOVER_SNAPSHOT/tools/supabase-go"');
    expect(deployAll).toContain('--path "$CUTOVER_SNAPSHOT/tools/supabase-go"');
    expect(deployAll).toContain('--path "$CUTOVER_SNAPSHOT/tools/supabase-go.sha256"');
    expect(deployAll).toContain("run_pinned_supabase_go_cli");
    expect(deployAll).toContain('cli_executable="$cli_workdir/supabase-go"');
    expect(deployAll).toContain('MIGRATION_EXECUTABLE="$MIGRATION_APPLY_WORKDIR/supabase-go"');
    expect(deployAll).toContain('/bin/cp -X "$PINNED_SUPABASE_GO_CLI" "$cli_executable"');
    expect(deployAll).toContain('/bin/cp -X "$PINNED_SUPABASE_GO_CLI" "$MIGRATION_EXECUTABLE"');
    expect(deployAll.match(/"\$MIGRATION_EXECUTABLE" db push/g)?.length).toBeGreaterThanOrEqual(2);
    expect(deployAll).toContain("SUPABASE_TELEMETRY_DISABLED=1");
    expect(deployAll).toContain("DO_NOT_TRACK=1");
    expect(deployAll).toContain("SUPABASE_URL=");
    expect(deployAll).toContain("SUPABASE_ANON_KEY=");
    expect(deployAll).toContain("SUPABASE_SERVICE_ROLE_KEY=");
    for (const source of [pause, recover]) {
      expect(source).toContain("tools/supabase-go");
      expect(source).toContain("tools/supabase-go.sha256");
    }
    expect(pause).toContain('convergence_go_cli="$convergence_workdir/supabase-go"');
    expect(pause).toContain('/bin/cp -X "$sealed_go_cli" "$convergence_go_cli"');
    expect(pause).toContain('"$convergence_go_cli" db push');
    expect(pause).not.toContain('"$sealed_go_cli" db push');
    expect(pause).not.toContain('"$sealed_cli" db push');
  });

  it("pins a standalone Supabase launcher together with its delegated companion", () => {
    const root = mkdtempSync(join(tmpdir(), "krw-supabase-cli-pair-test-"));
    try {
      const sourceDir = join(root, "source");
      const pinnedDir = join(root, "pinned");
      mkdirSync(sourceDir);
      mkdirSync(pinnedDir);
      const sourceLauncher = join(sourceDir, "supabase");
      const sourceCompanion = join(sourceDir, "supabase-go");
      const pinnedLauncher = join(pinnedDir, "supabase");
      const pinnedCompanion = join(pinnedDir, "supabase-go");
      const versionFile = join(pinnedDir, "supabase.version");

      writeFileSync(
        sourceLauncher,
        [
          "#!/bin/sh",
          'if [ "${1:-}" = "--version" ]; then',
          "  printf '%s\\n' 9.9.9",
          "  exit 0",
          "fi",
          // Keep the fake companion under an interpreter. macOS may delay
          // direct execution of a freshly copied temporary shell file; the
          // production pair is binary-to-binary, while this fixture only
          // needs to prove that the pinned launcher delegates its arguments.
          'exec /bin/sh "${SUPABASE_GO_BINARY:-$(dirname "$0")/supabase-go}" "$@"',
          "",
        ].join("\n"),
      );
      writeFileSync(
        sourceCompanion,
        [
          "#!/bin/sh",
          'if [ "${1:-}" = "--version" ]; then',
          '  [ "${HTTPS_PROXY:-}" = "http://127.0.0.1:0" ] || exit 41',
          '  [ "${https_proxy:-}" = "http://127.0.0.1:0" ] || exit 42',
          '  [ -z "${NO_PROXY:-}" ] || exit 43',
          '  [ -z "${GITHUB_TOKEN:-}" ] || exit 44',
          "  printf '%s\\n' 9.9.9",
          "  exit 0",
          "fi",
          "printf 'companion:%s\\n' \"$*\"",
          "",
        ].join("\n"),
      );
      chmodSync(sourceLauncher, 0o755);
      chmodSync(sourceCompanion, 0o755);

      const pinned = spawnSync(
        process.execPath,
        [
          supabaseCliPinner,
          sourceLauncher,
          pinnedLauncher,
          pinnedCompanion,
          versionFile,
        ],
        { cwd: repoRoot, encoding: "utf8", timeout: 10_000 },
      );
      expect(pinned.status, `${pinned.stdout}\n${pinned.stderr}`).toBe(0);
      expect(readFileSync(pinnedLauncher)).toEqual(readFileSync(sourceLauncher));
      expect(readFileSync(pinnedCompanion)).toEqual(
        readFileSync(sourceCompanion),
      );
      expect(readFileSync(versionFile, "utf8")).toBe("9.9.9\n");

      const delegated = spawnSync(
        "/bin/sh",
        [pinnedLauncher, "db", "push", "--dry-run"],
        {
          cwd: pinnedDir,
          encoding: "utf8",
          // Newly copied temporary shell scripts can be delayed by macOS
          // provenance assessment when launched as an executable. The real
          // deployment invokes a pinned Mach-O launcher; use sh here to test
          // the delegation contract without making that platform behavior a
          // test flake.
          timeout: 60_000,
          env: {
            ...process.env,
            SUPABASE_GO_BINARY: pinnedCompanion,
          },
        },
      );
      expect(delegated.status, delegated.stderr).toBe(0);
      expect(delegated.stdout).toBe("companion:db push --dry-run\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("pins a self-contained Supabase CLI with an isolated offline version probe", () => {
    const root = mkdtempSync(join(tmpdir(), "krw-supabase-cli-single-test-"));
    try {
      const sourceDir = join(root, "source");
      const pinnedDir = join(root, "pinned");
      mkdirSync(sourceDir);
      mkdirSync(pinnedDir);
      const source = join(sourceDir, "supabase");
      const pinnedLauncher = join(pinnedDir, "supabase");
      const pinnedCompanion = join(pinnedDir, "supabase-go");
      const versionFile = join(pinnedDir, "supabase.version");

      writeFileSync(
        source,
        [
          "#!/bin/sh",
          'if [ "${1:-}" = "--version" ]; then',
          '  [ "${HTTPS_PROXY:-}" = "http://127.0.0.1:0" ] || exit 41',
          '  [ -z "${NO_PROXY:-}" ] || exit 42',
          "  printf '%s\\n' 8.8.8",
          "  exit 0",
          "fi",
          "printf 'single:%s\\n' \"$*\"",
          "",
        ].join("\n"),
      );
      chmodSync(source, 0o755);

      const pinned = spawnSync(
        process.execPath,
        [
          supabaseCliPinner,
          source,
          pinnedLauncher,
          pinnedCompanion,
          versionFile,
        ],
        { cwd: repoRoot, encoding: "utf8", timeout: 10_000 },
      );
      expect(pinned.status, `${pinned.stdout}\n${pinned.stderr}`).toBe(0);
      expect(readFileSync(pinnedLauncher)).toEqual(readFileSync(source));
      expect(readFileSync(pinnedCompanion)).toEqual(readFileSync(source));
      expect(readFileSync(versionFile, "utf8")).toBe("8.8.8\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retries a transient SIGTERM from an isolated Supabase version probe", () => {
    const root = mkdtempSync(join(tmpdir(), "krw-supabase-cli-term-test-"));
    try {
      const sourceDir = join(root, "source");
      const pinnedDir = join(root, "pinned");
      const probeState = join(root, "first-probe-complete");
      mkdirSync(sourceDir);
      mkdirSync(pinnedDir);
      const source = join(sourceDir, "supabase");
      const pinnedLauncher = join(pinnedDir, "supabase");
      const pinnedCompanion = join(pinnedDir, "supabase-go");
      const versionFile = join(pinnedDir, "supabase.version");

      writeFileSync(
        source,
        [
          "#!/bin/sh",
          'if [ "${1:-}" = "--version" ]; then',
          '  if [ ! -e "$PROBE_STATE_PATH" ]; then',
          '    : > "$PROBE_STATE_PATH"',
          '    kill -TERM "$$"',
          "  fi",
          "  printf '%s\\n' 9.9.9",
          "  exit 0",
          "fi",
          "exit 0",
          "",
        ].join("\n"),
      );
      chmodSync(source, 0o755);

      const pinned = spawnSync(
        process.execPath,
        [
          supabaseCliPinner,
          source,
          pinnedLauncher,
          pinnedCompanion,
          versionFile,
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          timeout: 10_000,
          env: { ...process.env, PROBE_STATE_PATH: probeState },
        },
      );
      expect(pinned.status, `${pinned.stdout}\n${pinned.stderr}`).toBe(0);
      expect(existsSync(probeState)).toBe(true);
      expect(readFileSync(versionFile, "utf8")).toBe("9.9.9\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes every final pinned artifact when a post-copy probe fails", () => {
    const root = mkdtempSync(join(tmpdir(), "krw-supabase-cli-cleanup-test-"));
    try {
      const sourceDir = join(root, "source");
      const pinnedDir = join(root, "pinned");
      mkdirSync(sourceDir);
      mkdirSync(pinnedDir);
      const sourceLauncher = join(sourceDir, "supabase");
      const sourceCompanion = join(sourceDir, "supabase-go");
      const pinnedLauncher = join(pinnedDir, "supabase");
      const pinnedCompanion = join(pinnedDir, "supabase-go");
      const versionFile = join(pinnedDir, "supabase.version");

      writeFileSync(
        sourceLauncher,
        [
          "#!/bin/sh",
          'if [ "${1:-}" = "--version" ]; then',
          '  case "$0" in */source/*) printf \'%s\\n\' 7.7.7 ;; *) printf \'%s\\n\' 7.7.6 ;; esac',
          "  exit 0",
          "fi",
          "exit 0",
          "",
        ].join("\n"),
      );
      writeFileSync(
        sourceCompanion,
        [
          "#!/bin/sh",
          'if [ "${1:-}" = "--version" ]; then printf \'%s\\n\' 7.7.7; exit 0; fi',
          "exit 0",
          "",
        ].join("\n"),
      );
      chmodSync(sourceLauncher, 0o755);
      chmodSync(sourceCompanion, 0o755);

      const pinned = spawnSync(
        process.execPath,
        [
          supabaseCliPinner,
          sourceLauncher,
          pinnedLauncher,
          pinnedCompanion,
          versionFile,
        ],
        { cwd: repoRoot, encoding: "utf8", timeout: 10_000 },
      );
      expect(pinned.status).not.toBe(0);
      expect(`${pinned.stdout}\n${pinned.stderr}`).toContain(
        "Pinned Supabase CLI pair changed version",
      );
      expect(existsSync(pinnedLauncher)).toBe(false);
      expect(existsSync(pinnedCompanion)).toBe(false);
      expect(existsSync(versionFile)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("executes normal and crash recovery only through phase-bound sealed controllers", () => {
    const deployAll = readFileSync(
      join(repoRoot, "scripts", "deploy-all-production.sh"),
      "utf8",
    );
    const wrapper = readFileSync(
      join(repoRoot, "scripts", "deploy-with-queue-pause.sh"),
      "utf8",
    );
    const pause = readFileSync(
      join(repoRoot, "scripts", "pause-production-cutover.sh"),
      "utf8",
    );
    const recover = readFileSync(
      join(repoRoot, "scripts", "recover-production-cutover.sh"),
      "utf8",
    );

    expect(deployAll).toContain(
      'SEALED_PAUSE_CONTROLLER="$CUTOVER_SNAPSHOT/scripts/pause-production-cutover.sh"',
    );
    expect(deployAll).not.toContain(
      'node "$CUTOVER_SNAPSHOT/scripts/verify-prepared-runtime-artifacts.mjs"',
    );
    expect(deployAll).toContain("run_sealed_pause_controller pause");
    expect(deployAll).toContain("run_sealed_pause_controller resume");
    expect(deployAll).toContain('--front-root "$FRONT_DIR"');
    expect(deployAll).toContain(
      '--canonical-target-file "$CUTOVER_SNAPSHOT/ops/production-target.json"',
    );
    expect(deployAll).toContain(
      '--expected-env-sha256 "$CUTOVER_PRODUCTION_ENV_SHA256"',
    );
    expect(deployAll).not.toMatch(
      /"\$SCRIPT_DIR\/pause-production-cutover[.]sh"\s+(?:pause|resume)/,
    );
    for (const helper of [
      "uninstall-mac-worker-launchd.sh",
      "uninstall-mcp-server-launchd.sh",
      "uninstall-stock-news-mcp-launchd.sh",
    ]) {
      expect(deployAll).toContain(
        `--path "$CUTOVER_SNAPSHOT/scripts/${helper}"`,
      );
      expect(recover).toContain(`--path "$SCRIPT_DIR/${helper}"`);
      expect(pause).toContain(
        `--path "$cutover_snapshot/scripts/${helper}"`,
      );
    }

    expect(wrapper).toContain(
      'verifySealedBootstrapFile(driverPath, "recovery driver", true)',
    );
    expect(wrapper).toContain(
      'verifySealedBootstrapFile(verifierPath, "recovery verifier", false)',
    );
    expect(wrapper).toContain(
      'verifySealedBootstrapFile(pauseControllerPath, "pause controller", true)',
    );
    expect(recover.indexOf("SEALED_VERIFIER=")).toBeLessThan(
      recover.indexOf("# Only after the master recovery seal passes"),
    );
    expect(recover.indexOf("Pinned production env changed before recovery.")).toBeLessThan(
      recover.indexOf('exec "$SEALED_PAUSE_CONTROLLER"'),
    );

    const snapshotSeal = pause.lastIndexOf("prepare_mac_snapshot_seal");
    const phaseAnchor = pause.lastIndexOf(
      "write_cutover_phase pausing_pre_migration",
    );
    const firstMutation = pause.indexOf(
      '"$SCRIPT_DIR/uninstall-mac-worker-launchd.sh"',
    );
    expect(snapshotSeal).toBeGreaterThan(-1);
    expect(phaseAnchor).toBeGreaterThan(snapshotSeal);
    expect(firstMutation).toBeGreaterThan(phaseAnchor);

    const emergencyStop = pause.indexOf("fail_closed_local_stopped=1");
    const rollbackAudit = pause.indexOf(
      'test -f "$CUTOVER_PHASE_FILE" || {',
      emergencyStop,
    );
    expect(emergencyStop).toBeGreaterThan(-1);
    expect(pause.indexOf("emergency_fail_closed_remote_stop", emergencyStop)).toBeLessThan(
      rollbackAudit,
    );

    const remoteOnlyRecovery = pause.indexOf(
      'if [ "$ACTION" = "resume-remote" ]; then',
    );
    const remoteRestorePhase = pause.indexOf(
      "write_cutover_phase restoring_gcp_only",
      remoteOnlyRecovery,
    );
    expect(remoteOnlyRecovery).toBeGreaterThan(-1);
    expect(
      pause.indexOf("emergency_fail_closed_local_stop", remoteOnlyRecovery),
    ).toBeLessThan(remoteRestorePhase);
  });

  it("builds sealed frontend archives from the canonical hashed file list", () => {
    const deployWeb = readFileSync(
      join(repoRoot, "scripts", "deploy-web-production.sh"),
      "utf8",
    );
    expect(deployWeb).toContain('"$FRONT_DIR" --list0 >"$FRONT_FILE_LIST"');
    expect(deployWeb).toContain('--no-recursion --null -T "$FRONT_FILE_LIST"');
    expect(deployWeb).toContain(
      String.raw`"\$REMOTE_FRONT_DIR" --list0 >"\$ROLLBACK_SOURCE_LIST"`,
    );
    expect(deployWeb).toContain(
      String.raw`--no-recursion --null -T "\$ROLLBACK_SOURCE_LIST"`,
    );
    expect(deployWeb).toContain(
      String.raw`RUNNING_PROJECT_CONTAINERS="\$RUNTIME_ENV_INCOMING_DIR/running-project-containers.tsv"`,
    );
    expect(deployWeb).not.toContain(
      String.raw`RUNNING_PROJECT_CONTAINERS="\$FRONT_STAGE/running-project-containers.tsv"`,
    );
  });

  it("stages, commits, and restores production runtime envs as one sealed transaction", () => {
    const deployAll = readFileSync(
      join(repoRoot, "scripts", "deploy-all-production.sh"),
      "utf8",
    );
    const deployWeb = readFileSync(
      join(repoRoot, "scripts", "deploy-web-production.sh"),
      "utf8",
    );
    const pause = readFileSync(
      join(repoRoot, "scripts", "pause-production-cutover.sh"),
      "utf8",
    );
    const installer = readFileSync(atomicInstaller, "utf8");
    const targetVerifier = readFileSync(productionTargetVerifier, "utf8");

    expect(deployAll).toContain(
      "EXPECTED_PRODUCTION_ENV_SHA256=$PINNED_PRODUCTION_ENV_SHA256",
    );
    expect(deployAll).toContain("export EXPECTED_PRODUCTION_ENV_SHA256");
    expect(deployWeb).toContain("gcloud_scp_with_retry");
    expect(deployWeb).toContain('"runtime environment"');
    expect(deployWeb).toContain('"$LOCAL_RUNTIME_ENV"');
    expect(deployWeb).toContain('"$GCP_INSTANCE:$REMOTE_RUNTIME_ENV"; then');
    expect(deployWeb).toContain(
      'gcloud compute scp "$scp_source" "$scp_destination"',
    );
    expect(deployWeb).toContain(
      String.raw`cp "\$RUNTIME_ENV_SOURCE" "\$RELEASE_ENV_TMP"`,
    );
    expect(deployWeb).not.toContain(
      String.raw`cp "\$REMOTE_FRONT_DIR/.env" "\$RELEASE_DIR/runtime.env"`,
    );
    expect(deployWeb).toContain(
      "Registryless GCP runtime capture requires an explicit bootstrap attestation.",
    );
    expect(deployWeb).toContain(
      "Previous GCP release registry is incomplete; refusing implicit bootstrap.",
    );

    const privateHealth = deployWeb.indexOf(
      String.raw`if [ "\$verified_deep" != "1" ]`,
    );
    const envCommit = deployWeb.indexOf(
      String.raw`LIVE_ENV_TMP=\$(mktemp "\$REMOTE_FRONT_DIR/.env.next.XXXXXX")`,
    );
    const proxyStart = deployWeb.indexOf(
      "scripts/deploy-vm-compose.sh --activate-only reverse-proxy",
    );
    expect(privateHealth).toBeGreaterThan(-1);
    expect(envCommit).toBeGreaterThan(privateHealth);
    expect(proxyStart).toBeGreaterThan(envCommit);
    expect(deployWeb).toContain("scripts/atomic-install-sealed-file.mjs");
    expect(installer).toContain("fsyncSync(sourceFd)");
    expect(installer).toContain("fsyncSync(directoryFd)");

    expect(pause.match(/--rollback-proof/g)).toHaveLength(5);
    expect(pause.match(/--rollback-source-root/g)).toHaveLength(5);
    expect(
      pause.match(
        /Rollback manifest must define PREVIOUS_FRONT_SOURCE_SHA256 exactly once[.]/g,
      ),
    ).toHaveLength(5);
    expect(targetVerifier).toContain(
      "Extracted rollback frontend source does not match PREVIOUS_FRONT_SOURCE_SHA256",
    );
    expect(pause.match(/--no-same-owner --no-same-permissions/g)).toHaveLength(5);
    expect(pause).not.toContain("--allow-missing-admin-emails");
    expect(pause).toContain(
      '"verify-supabase-production-target.mjs:TARGET_VERIFIER_SHA256"',
    );
    expect(pause).toContain(
      '"atomic-install-sealed-file.mjs:ATOMIC_INSTALLER_SHA256"',
    );
    expect(pause).toContain(
      "Live web environment is neither the sealed candidate nor rollback state.",
    );
    const servicesStopped = pause.indexOf(
      "Service is still running before rollback source restoration",
    );
    const rollbackSourceStage = pause.indexOf(
      String.raw`ROLLBACK_SOURCE_STAGE=\$(mktemp -d /tmp/krw-front-rollback.XXXXXX)`,
    );
    const rollbackSourceProof = pause.indexOf(
      String.raw`--rollback-source-root "\$ROLLBACK_SOURCE_STAGE"`,
      rollbackSourceStage,
    );
    const rollbackEnvCommit = pause.indexOf(
      String.raw`LIVE_ENV_TMP=\$(mktemp '$REMOTE_FRONT_DIR/.env.rollback.XXXXXX')`,
    );
    const sourceRestore = pause.indexOf("rsync -a --delete", rollbackEnvCommit);
    expect(rollbackSourceStage).toBeGreaterThan(-1);
    expect(rollbackSourceProof).toBeGreaterThan(rollbackSourceStage);
    expect(rollbackSourceProof).toBeLessThan(servicesStopped);
    expect(servicesStopped).toBeGreaterThan(-1);
    expect(rollbackEnvCommit).toBeGreaterThan(servicesStopped);
    expect(sourceRestore).toBeGreaterThan(rollbackEnvCommit);
    const stopPreflightStage = pause.indexOf(
      String.raw`ROLLBACK_SOURCE_STAGE=\$(mktemp -d /tmp/krw-front-rollback-preflight.XXXXXX)`,
    );
    const stopPreflightProof = pause.indexOf(
      String.raw`--rollback-source-root "\$ROLLBACK_SOURCE_STAGE"`,
      stopPreflightStage,
    );
    const stopPreflightMutation = pause.indexOf(
      "Service is still running at rollback entry",
      stopPreflightProof,
    );
    expect(stopPreflightStage).toBeGreaterThan(-1);
    expect(stopPreflightProof).toBeGreaterThan(stopPreflightStage);
    expect(stopPreflightMutation).toBeGreaterThan(stopPreflightProof);
    expect(pause).toContain(
      "Restored live web environment does not match the rollback seal.",
    );
  });

  it("publishes and finalizes web markers only after the release registry is complete", () => {
    const deployWeb = readFileSync(
      join(repoRoot, "scripts", "deploy-web-production.sh"),
      "utf8",
    );
    const manifest = deployWeb.indexOf('RELEASE_MANIFEST_TMP="\\$RELEASE_DIR/release-manifest.env.next.');
    const localMarker = deployWeb.indexOf('RELEASE_MARKER_TMP="\\$RELEASE_DIR/prepared-web-release.env.next.');
    const globalMarker = deployWeb.indexOf('GLOBAL_MARKER_TMP="\\$REMOTE_FRONT_DIR/.deploy/prepared-web-release.env.next.');
    expect(manifest).toBeGreaterThan(-1);
    expect(localMarker).toBeGreaterThan(manifest);
    expect(globalMarker).toBeGreaterThan(-1);
    expect(globalMarker).toBeLessThan(manifest);
    expect(deployWeb.slice(localMarker, deployWeb.indexOf("Prepared release-local web image registry:", localMarker)))
      .not.toContain("GLOBAL_MARKER_TMP");
    expect(deployWeb).toContain("FORMAT=krw-prepared-web-release/v2");
    expect(deployWeb).toContain("RELEASE_MANIFEST_SHA256=");
    expect(deployWeb).toContain("atomic-transition-sealed-file.mjs");
    expect(deployWeb).not.toContain("Warning: prepared web marker cleanup failed");
    expect(deployWeb).toContain(
      "A global prepared marker cannot coexist with a terminal release receipt.",
    );
    expect(deployWeb).toContain(
      "Live web environment is neither the sealed previous nor candidate state.",
    );
  });

  it("executes the prepared web activation marker and live-env state matrix", () => {
    const accepted: Array<{
      name: string;
      options: WebActivationFixtureOptions;
    }> = [
      {
        name: "previous env with prepared marker",
        options: { markerState: "prepared", liveEnvState: "previous" },
      },
      {
        name: "candidate env with prepared marker recovery",
        options: { markerState: "prepared", liveEnvState: "candidate" },
      },
      {
        name: "candidate env with activated marker retry",
        options: { markerState: "activated", liveEnvState: "candidate" },
      },
      {
        name: "activated marker retry when previous and candidate env seals are identical",
        options: {
          markerState: "activated",
          liveEnvState: "candidate",
          identicalEnvDigests: true,
        },
      },
    ];
    for (const scenario of accepted) {
      const root = mkdtempSync(join(tmpdir(), "krw-web-state-accepted-"));
      try {
        const result = runWebActivationPreflight(root, scenario.options);
        expect(
          result.status,
          `${scenario.name}: ${result.stdout}\n${result.stderr}`,
        ).toBe(0);
        expect(result.stdout).toContain("WEB_ACTIVATION_PREFLIGHT_OK");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }

    const rejected: Array<{
      name: string;
      options: WebActivationFixtureOptions;
      message: string;
    }> = [
      {
        name: "previous env with activated marker",
        options: { markerState: "activated", liveEnvState: "previous" },
        message: "An activated marker requires the sealed candidate live environment.",
      },
      {
        name: "arbitrary live env digest",
        options: { markerState: "prepared", liveEnvState: "arbitrary" },
        message: "Live web environment is neither the sealed previous nor candidate state.",
      },
      {
        name: "prepared and activated markers coexist",
        options: { markerState: "coexist", liveEnvState: "candidate" },
        message: "A global prepared marker cannot coexist with a terminal release receipt.",
      },
      {
        name: "global and local markers mismatch",
        options: {
          markerState: "prepared",
          liveEnvState: "previous",
          globalMarkerFault: "mismatch",
        },
        message: "Prepared-release lifecycle marker differs from the release-local marker.",
      },
      {
        name: "global marker is a symlink",
        options: {
          markerState: "prepared",
          liveEnvState: "previous",
          globalMarkerFault: "symlink",
        },
        message: "Prepared-release lifecycle markers must be regular non-symlink files.",
      },
      {
        name: "release-local marker is a symlink",
        options: {
          markerState: "prepared",
          liveEnvState: "previous",
          localMarkerSymlink: true,
        },
        message: "Missing regular release-local prepared marker.",
      },
    ];
    for (const scenario of rejected) {
      const root = mkdtempSync(join(tmpdir(), "krw-web-state-rejected-"));
      try {
        expectRejected(
          runWebActivationPreflight(root, scenario.options),
          scenario.message,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("atomically transitions a sealed marker and treats a lost acknowledgement as success", () => {
    const root = mkdtempSync(join(tmpdir(), "krw-marker-transition-"));
    try {
      const sourceDir = join(root, "source");
      const destinationDir = join(root, "destination");
      const source = join(sourceDir, "prepared.env");
      const destination = join(destinationDir, "activated.env");
      mkdirSync(sourceDir);
      mkdirSync(destinationDir);
      writeFileSync(source, "FORMAT=sealed-marker/v1\n", { mode: 0o600 });
      const expected = sha256(source);
      const first = spawnSync(process.execPath, [
        atomicTransition,
        source,
        destination,
        expected,
        "400",
      ], { encoding: "utf8" });
      expect(first.status, first.stderr).toBe(0);
      expect(existsSync(source)).toBe(false);
      expect(sha256(destination)).toBe(expected);
      expect(statSync(destination).mode & 0o777).toBe(0o400);

      const retry = spawnSync(process.execPath, [
        atomicTransition,
        source,
        destination,
        expected,
        "400",
      ], { encoding: "utf8" });
      expect(retry.status, retry.stderr).toBe(0);

      writeFileSync(source, "FORMAT=sealed-marker/v1\n", { mode: 0o600 });
      expectRejected(
        spawnSync(process.execPath, [
          atomicTransition,
          source,
          destination,
          expected,
          "400",
        ], { encoding: "utf8" }),
        "ambiguous source-and-destination state",
      );
      rmSync(source);
      chmodSync(destination, 0o600);
      writeFileSync(destination, "tampered\n");
      expectRejected(
        spawnSync(process.execPath, [
          atomicTransition,
          source,
          destination,
          expected,
          "400",
        ], { encoding: "utf8" }),
        "destination does not match its expected digest",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("seals an explicit post-migration candidate recovery path and archived target guards", () => {
    const wrapper = readFileSync(
      join(repoRoot, "scripts", "deploy-with-queue-pause.sh"),
      "utf8",
    );
    const recovery = readFileSync(
      join(repoRoot, "scripts", "recover-production-cutover.sh"),
      "utf8",
    );
    const pause = readFileSync(
      join(repoRoot, "scripts", "pause-production-cutover.sh"),
      "utf8",
    );
    const deployAll = readFileSync(
      join(repoRoot, "scripts", "deploy-all-production.sh"),
      "utf8",
    );
    const deployMac = readFileSync(
      join(repoRoot, "scripts", "deploy-plugin-worker-production.sh"),
      "utf8",
    );
    expect(wrapper).toContain("resume|resume-remote|activate-prepared");
    expect(recovery).toContain("resume|resume-remote|activate-prepared");
    expect(recovery).toContain('SEALED_WEB_ACTIVATOR="$SCRIPT_DIR/deploy-web-production.sh"');
    expect(pause).toContain("fail_closed_candidate_ready");
    expect(pause).toContain("fail_closed_migration_unverified");
    expect(pause).toContain("write_cutover_phase resuming_candidate");
    expect(pause).toContain('"$SEALED_WEB_ACTIVATOR" --activate-prepared');
    expect(pause.match(/Archived rollback production target must be a regular non-symlink file/g)).toHaveLength(4);
    expect(pause.match(/Archived rollback production target does not match the canonical Supabase project/g)).toHaveLength(4);
    expect(deployAll).toContain(
      '--path "$CUTOVER_SNAPSHOT/scripts/deploy-web-production.sh"',
    );
    expect(deployMac).toContain("activate-prepared-mac-runtime.sh");
    expect(deployMac).toContain(
      '"$RUNTIME_ROOT/scripts/activate-prepared-mac-runtime.sh"',
    );
  });

  it("executes candidate recovery fail-close ordering and durable phase transitions", () => {
    const successRoot = mkdtempSync(join(tmpdir(), "krw-candidate-success-"));
    try {
      const { result, events } = runCandidateRecoveryTransaction(successRoot, {
        migrated: true,
      });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(events).toEqual([
        "local_stop",
        "remote_stop",
        "phase:resuming_candidate",
        "mac_activate",
        "web_activate",
        "phase:complete",
      ]);
    } finally {
      rmSync(successRoot, { recursive: true, force: true });
    }

    const macFailureRoot = mkdtempSync(join(tmpdir(), "krw-candidate-mac-fail-"));
    try {
      const { result, events } = runCandidateRecoveryTransaction(macFailureRoot, {
        migrated: true,
        macExit: 71,
      });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(71);
      expect(events).toEqual([
        "local_stop",
        "remote_stop",
        "phase:resuming_candidate",
        "mac_activate",
        "local_stop",
        "remote_stop",
        "phase:fail_closed_candidate_ready",
      ]);
      expect(events).not.toContain("web_activate");
      expect(events).not.toContain("phase:complete");
    } finally {
      rmSync(macFailureRoot, { recursive: true, force: true });
    }

    const webFailureRoot = mkdtempSync(join(tmpdir(), "krw-candidate-web-fail-"));
    try {
      const { result, events } = runCandidateRecoveryTransaction(webFailureRoot, {
        migrated: true,
        webExit: 72,
      });
      expect(result.status).toBe(72);
      expect(events).toEqual([
        "local_stop",
        "remote_stop",
        "phase:resuming_candidate",
        "mac_activate",
        "web_activate",
        "local_stop",
        "remote_stop",
        "phase:fail_closed_candidate_ready",
      ]);
      expect(events).not.toContain("phase:complete");
    } finally {
      rmSync(webFailureRoot, { recursive: true, force: true });
    }

    const codeOnlyFailureRoot = mkdtempSync(
      join(tmpdir(), "krw-candidate-code-only-fail-"),
    );
    try {
      const { result, events } = runCandidateRecoveryTransaction(
        codeOnlyFailureRoot,
        { macExit: 73 },
      );
      expect(result.status).toBe(73);
      expect(events.at(-1)).toBe("phase:mac_fail_closed_pre_migration");
    } finally {
      rmSync(codeOnlyFailureRoot, { recursive: true, force: true });
    }
  });

  it("rejects candidate recovery phase and activator tampering before any activation", () => {
    const tamperRoot = mkdtempSync(join(tmpdir(), "krw-candidate-tamper-"));
    try {
      const { result, events } = runCandidateRecoveryTransaction(tamperRoot, {
        migrated: true,
        webActivatorSymlink: true,
      });
      expectRejected(result, "Missing sealed GCP candidate activation helper.");
      expect(events).toEqual([]);
    } finally {
      rmSync(tamperRoot, { recursive: true, force: true });
    }

    const retryRoot = mkdtempSync(join(tmpdir(), "krw-candidate-retry-phase-"));
    try {
      const { result, mutations } = runCandidateRecoveryPhaseAdmission(
        retryRoot,
        "resuming_candidate",
        true,
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(mutations).toBe("mutator\n");
    } finally {
      rmSync(retryRoot, { recursive: true, force: true });
    }

    for (const forbiddenPhase of ["prepared_local", "complete"]) {
      const root = mkdtempSync(join(tmpdir(), "krw-candidate-forbidden-phase-"));
      try {
        const { result, mutations } = runCandidateRecoveryPhaseAdmission(
          root,
          forbiddenPhase,
          true,
        );
        expectRejected(
          result,
          `Sealed candidate activation is forbidden in cutover phase: ${forbiddenPhase}`,
        );
        expect(mutations).toBe("");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("derives every Mac runtime control byte from one verified frontend snapshot", () => {
    const deployMac = readFileSync(
      join(repoRoot, "scripts", "deploy-plugin-worker-production.sh"),
      "utf8",
    );
    const snapshotVerified = deployMac.indexOf(
      "COPIED_FRONT_SOURCE_SHA256=$(node",
    );
    const controlCopy = deployMac.indexOf(
      'cp "$BUILD_DIR/scripts/$script_name" "$RUNTIME_ROOT/scripts/$script_name"',
    );

    expect(snapshotVerified).toBeGreaterThan(-1);
    expect(deployMac).toContain(
      '"$BUILD_DIR/scripts/compute-production-source-sha256.mjs" "$BUILD_DIR"',
    );
    expect(controlCopy).toBeGreaterThan(snapshotVerified);
    expect(deployMac).toContain(
      'cp "$BUILD_DIR/ops/production-target.json" "$RUNTIME_ROOT/ops/production-target.json"',
    );
    expect(deployMac).toContain(
      'cp "$BUILD_DIR/ops/launchd/$template_name" "$RUNTIME_ROOT/ops/launchd/$template_name"',
    );
    expect(deployMac).not.toContain(
      'cp "$SCRIPT_DIR/$script_name" "$RUNTIME_ROOT/scripts/$script_name"',
    );
  });

  it("rejects direct GCP, Mac, and data mutations before a mutator runs", () => {
    const root = mkdtempSync(join(tmpdir(), "krw-cutover-lock-test-"));
    try {
      const envFile = join(root, "production.env");
      const fakeBin = join(root, "bin");
      const mutationLog = join(root, "mutations.log");
      const ontologySource = join(root, "ontology-source");
      const releasesRoot = join(root, "releases");
      writeCanonicalEnv(envFile);
      writeFileSync(mutationLog, "");
      installMutationTripwires(fakeBin);
      mkdirSync(join(ontologySource, "src", "krw_ontology"), {
        recursive: true,
      });
      writeFileSync(join(ontologySource, "pyproject.toml"), "[project]\nname='fault-test'\n");
      mkdirSync(join(releasesRoot, "prod", "current"), { recursive: true });

      const env = productionEnv({
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        MUTATION_LOG: mutationLog,
        KRW_ONTOLOGY_SOURCE_DIR: ontologySource,
      });

      expectRejected(
        runScript("deploy-web-production.sh", ["--prepare-only"], env),
        "GCP production lane is internal",
      );
      expectRejected(
        runScript(
          "deploy-plugin-worker-production.sh",
          ["--env-file", envFile, "--prepare-only"],
          env,
        ),
        "Mac production lane is internal",
      );
      expectRejected(
        runScript(
          "deploy-data-release-production.sh",
          [
            "--env-file",
            envFile,
            "--releases-root",
            releasesRoot,
            "--catalog-file",
            join(root, "catalog.json"),
          ],
          env,
        ),
        "production data lane is internal",
      );

      expect(readFileSync(mutationLog, "utf8")).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a non-canonical GCP target without invoking gcloud", () => {
    const root = mkdtempSync(join(tmpdir(), "krw-cutover-target-test-"));
    try {
      const fakeBin = join(root, "bin");
      const mutationLog = join(root, "mutations.log");
      writeFileSync(mutationLog, "");
      installMutationTripwires(fakeBin);
      const result = runScript(
        "deploy-web-production.sh",
        ["--prepare-only"],
        productionEnv({
          PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          MUTATION_LOG: mutationLog,
          GCP_PROJECT: "not-the-canonical-production-project",
        }),
      );
      expectRejected(result, "GCP_PROJECT conflicts with ops/production-target.json");
      expect(readFileSync(mutationLog, "utf8")).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(["content", "mode", "symlink"] as const)(
    "rejects %s tampering after a runtime is sealed",
    (tamperKind) => {
      const root = mkdtempSync(join(tmpdir(), `krw-runtime-${tamperKind}-`));
      try {
        const runtime = join(root, "runtime");
        const artifacts = join(runtime, "artifacts");
        const marker = join(root, "artifact-seal.json");
        const payload = join(artifacts, "payload.txt");
        const alternate = join(artifacts, "alternate.txt");
        const link = join(artifacts, "current.txt");
        mkdirSync(artifacts, { recursive: true });
        writeFileSync(payload, "sealed payload\n", { mode: 0o640 });
        writeFileSync(alternate, "alternate payload\n", { mode: 0o640 });
        // The production deploy gate intentionally inherits `umask 077`, so
        // writeFileSync(..., { mode: 0o640 }) creates 0o600 there. Establish
        // the baseline with chmod (which is not masked by umask) so the mode
        // fault below always changes bytes-on-disk metadata in every gate.
        chmodSync(payload, 0o640);
        chmodSync(alternate, 0o640);
        symlinkSync("payload.txt", link);

        const prepared = runArtifactVerifier(
          "prepare",
          marker,
          runtime,
          artifacts,
        );
        expect(prepared.error).toBeUndefined();
        expect(prepared.status).toBe(0);
        expect(
          runArtifactVerifier("verify", marker, runtime, artifacts).status,
        ).toBe(0);

        if (tamperKind === "content") {
          writeFileSync(payload, "tampered payload\n", { mode: 0o640 });
        } else if (tamperKind === "mode") {
          chmodSync(payload, 0o600);
        } else {
          rmSync(link);
          symlinkSync("alternate.txt", link);
        }

        const rejected = runArtifactVerifier(
          "verify",
          marker,
          runtime,
          artifacts,
        );
        expect(rejected.error).toBeUndefined();
        expect(rejected.status).not.toBe(0);
        expect(rejected.stderr).toContain(
          "Prepared runtime artifacts changed after they were sealed",
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it("routes normal production deploy aliases through the lightweight fast wrapper", () => {
    const packageJson = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const mutatingAliases = Object.entries(packageJson.scripts).filter(
      ([name]) => {
        if (name.includes("dry") || name.endsWith(":dev")) return false;
        return (
          name.startsWith("prod:deploy:") ||
          name === "prod:release:publish" ||
          name.startsWith("deploy:")
        );
      },
    );

    expect(mutatingAliases.length).toBeGreaterThan(10);
    for (const [name, command] of mutatingAliases) {
      const normalizedCommand = command.replace(/^\/bin\/sh\s+/, "");
      const expectedEntrypoint =
        name === "prod:deploy:recover"
          ? /^scripts\/deploy-with-queue-pause\.sh(?:\s|$)/
          : name === "prod:deploy:bootstrap"
            ? /^scripts\/deploy-production-simple\.sh(?:\s|$)/
            : /^scripts\/deploy-production-fast\.sh(?:\s|$)/;
      expect(
        normalizedCommand,
        `${name} bypasses the canonical deploy path`,
      ).toMatch(expectedEntrypoint);
    }

    for (const name of ["prod:deploy:dry", "deploy:prod:dry"]) {
      expect(packageJson.scripts[name]).toContain("--dry-run");
    }
  });

  it("keeps exact document-claim probes behind the timeout-bound Supabase fetch", () => {
    const source = readFileSync(
      join(repoRoot, "scripts", "supabase-schema-smoke.mjs"),
      "utf8",
    );
    const documentClaimProbes = [
      ...source.matchAll(
        /await\s+assertRequiredArgumentProbe\(\s*"(claim_document_[^"]+)"/g,
      ),
    ].map((match) => match[1]);

    expect(documentClaimProbes).toEqual([
      "claim_document_ingestion_job_v2",
      "claim_document_ingestion_job_by_id_v2",
      "claim_document_source_cleanup_job",
    ]);
    expect(source).toContain("async function schemaSmokeFetch(input, init = {})");
    expect(source).toContain("AbortSignal.timeout(requestTimeoutMs)");
    expect(source).toContain("AbortSignal.any([init.signal, timeoutSignal])");
    expect(source.match(/global:\s*\{\s*fetch:\s*schemaSmokeFetch\s*\}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("p_worker_id: \"\"");
    expect(source).toContain("p_job_id: null");
  });

  it("probes coverage-limit RPC signatures without mutating production users", () => {
    const source = readFileSync(
      join(repoRoot, "scripts", "supabase-schema-smoke.mjs"),
      "utf8",
    );

    expect(source).toContain("async function assertCoverageLimitRpcSignatures()");
    expect(source).toContain('"reconcile_user_company_coverage_limit"');
    expect(source).toContain("p_user_id: null");
    expect(source).toContain("p_active_limit: -1");
    expect(source).toContain(
      'String(reconcileError.code ?? "") !== "22023"',
    );
    expect(source).toContain('"sweep_expired_company_coverage_limits"');
    expect(source).toContain("p_limit: 0");
    expect(source).toContain('String(sweepError.code ?? "") !== "22023"');
    expect(source).toContain('String(sweepError.code ?? "") === "PGRST202"');
    expect(source).toContain("await assertCoverageLimitRpcSignatures()");
  });
});
