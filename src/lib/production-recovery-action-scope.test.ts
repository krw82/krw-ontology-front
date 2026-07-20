import { createHash } from "node:crypto";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const verifierSource = join(
  repoRoot,
  "scripts",
  "verify-prepared-runtime-artifacts.mjs",
);
const recoverySource = join(
  repoRoot,
  "scripts",
  "recover-production-cutover.sh",
);
const pauseSource = join(
  repoRoot,
  "scripts",
  "pause-production-cutover.sh",
);

const fixtureRoots: string[] = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeExecutable(path: string, source = "#!/bin/sh\nexit 0\n") {
  writeFileSync(path, source, { mode: 0o500 });
  chmodSync(path, 0o500);
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Partial<NodeJS.ProcessEnv> } = {},
): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      ...options.env,
      NODE_ENV: options.env?.NODE_ENV ?? process.env.NODE_ENV ?? "test",
    },
    encoding: "utf8",
    timeout: 15_000,
  });
}

type RecoveryFixture = {
  root: string;
  snapshot: string;
  scripts: string;
  deploymentId: string;
  phase: string;
  envFile: string;
  seal: string;
  pauseMarker: string;
  webActivator: string;
  supabaseCli: string;
  baseEnv: Partial<NodeJS.ProcessEnv>;
};

function createRecoveryFixture(): RecoveryFixture {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "krw-recovery-action-scope-")),
  );
  fixtureRoots.push(root);
  const deploymentId = "action-scope-fixture";
  const snapshot = join(root, ".deploy", `cutover-${deploymentId}`);
  const scripts = join(snapshot, "scripts");
  const tools = join(snapshot, "tools");
  const ops = join(snapshot, "ops");
  const lockDirectory = join(root, ".deploy", "production-deploy.lock");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(tools, { recursive: true });
  mkdirSync(ops, { recursive: true });
  mkdirSync(lockDirectory, { recursive: true });

  const recovery = join(scripts, "recover-production-cutover.sh");
  const verifier = join(scripts, "verify-prepared-runtime-artifacts.mjs");
  const pause = join(scripts, "pause-production-cutover.sh");
  const webActivator = join(scripts, "deploy-web-production.sh");
  const computeAdmin = join(scripts, "compute-admin-email-set-sha256.mjs");
  const uninstallWorker = join(scripts, "uninstall-mac-worker-launchd.sh");
  const uninstallMcp = join(scripts, "uninstall-mcp-server-launchd.sh");
  const uninstallNews = join(scripts, "uninstall-stock-news-mcp-launchd.sh");
  const pauseMarker = join(root, "pause-action.txt");
  copyFileSync(recoverySource, recovery);
  chmodSync(recovery, 0o500);
  copyFileSync(verifierSource, verifier);
  chmodSync(verifier, 0o400);
  writeExecutable(
    pause,
    `#!/bin/sh
set -eu
printf '%s\\n' "$1" >"$FAKE_PAUSE_MARKER"
`,
  );
  writeExecutable(webActivator);
  writeFileSync(computeAdmin, "export default null;\n", { mode: 0o400 });
  writeExecutable(uninstallWorker);
  writeExecutable(uninstallMcp);
  writeExecutable(uninstallNews);

  const target = join(ops, "production-target.json");
  writeFileSync(target, '{"format":"krw-production-target/v1"}\n', {
    mode: 0o400,
  });
  const envFile = join(root, "runtime.env");
  writeFileSync(envFile, "SUPABASE_DB_PASSWORD=test-only\n", { mode: 0o400 });
  const envSha256 = createHash("sha256")
    .update(readFileSync(envFile))
    .digest("hex");
  const envPathRecord = join(snapshot, "production-env.path");
  const envDigestRecord = join(snapshot, "production-env.sha256");
  writeFileSync(envPathRecord, `${envFile}\n`, { mode: 0o400 });
  writeFileSync(envDigestRecord, `${envSha256}\n`, { mode: 0o400 });
  const inputSeal = join(snapshot, "cutover-input-seal.json");
  const helperSeal = join(snapshot, "cutover-helper-seal.json");
  writeFileSync(inputSeal, "sealed-input\n", { mode: 0o400 });
  writeFileSync(helperSeal, "sealed-helper\n", { mode: 0o400 });
  const supabaseCli = join(tools, "supabase");
  const supabaseCliSha = join(tools, "supabase.sha256");
  const supabaseGo = join(tools, "supabase-go");
  const supabaseGoSha = join(tools, "supabase-go.sha256");
  writeExecutable(supabaseCli);
  writeFileSync(supabaseCliSha, `${"a".repeat(64)}\n`, { mode: 0o400 });
  writeExecutable(supabaseGo);
  writeFileSync(supabaseGoSha, `${"b".repeat(64)}\n`, { mode: 0o400 });

  const seal = join(snapshot, "recovery-seal.json");
  const prepared = run(process.execPath, [
    verifierSource,
    "prepare",
    "--marker",
    seal,
    "--symlink-boundary",
    snapshot,
    "--path",
    inputSeal,
    "--path",
    helperSeal,
    "--path",
    pause,
    "--path",
    recovery,
    "--path",
    webActivator,
    "--path",
    computeAdmin,
    "--path",
    verifier,
    "--path",
    uninstallWorker,
    "--path",
    uninstallMcp,
    "--path",
    uninstallNews,
    "--path",
    target,
    "--path",
    envPathRecord,
    "--path",
    envDigestRecord,
    "--path",
    envFile,
    "--path",
    supabaseCli,
    "--path",
    supabaseCliSha,
    "--path",
    supabaseGo,
    "--path",
    supabaseGoSha,
  ]);
  expect(prepared.error).toBeUndefined();
  expect(prepared.status, prepared.stderr).toBe(0);
  const recoverySealSha256 = createHash("sha256")
    .update(readFileSync(seal))
    .digest("hex");
  const phase = join(root, ".deploy", `cutover-phase-${deploymentId}.env`);
  writeFileSync(
    phase,
    [
      "FORMAT=krw-production-cutover-phase/v1",
      `DEPLOYMENT_ID=${deploymentId}`,
      "LOCK_OWNER=previous-owner",
      "PHASE=paused_pre_migration",
      "UPDATED_AT=2026-07-18T00:00:00.000Z",
      "ORIGINAL_LOCK_OWNER=previous-owner",
      `RECOVERY_SEAL_PATH=${seal}`,
      `RECOVERY_SEAL_SHA256=${recoverySealSha256}`,
      `PRODUCTION_ENV_PATH=${envFile}`,
      `PRODUCTION_ENV_SHA256=${envSha256}`,
      "MIGRATION_INCLUDE_ALL=0",
      `CANDIDATE_MAC_RUNTIME_SEAL_PATH=${join(root, "missing-mac-runtimes", deploymentId, ".artifact-seal.json")}`,
      `CANDIDATE_MAC_RUNTIME_SEAL_SHA256=${"c".repeat(64)}`,
      "",
    ].join("\n"),
    { mode: 0o400 },
  );
  writeFileSync(join(lockDirectory, "owner"), "current-owner\n");

  return {
    root,
    snapshot,
    scripts,
    deploymentId,
    phase,
    envFile,
    seal,
    pauseMarker,
    webActivator,
    supabaseCli,
    baseEnv: {
      PRODUCTION_OS_LOCK_HELD: "1",
      PRODUCTION_DEPLOY_LOCK_OWNER: "current-owner",
      FAKE_PAUSE_MARKER: pauseMarker,
    },
  };
}

function runRecovery(fixture: RecoveryFixture, action: string) {
  rmSync(fixture.pauseMarker, { force: true });
  return run(
    "/bin/sh",
    [
      join(fixture.scripts, "recover-production-cutover.sh"),
      "--front-root",
      fixture.root,
      "--cutover-id",
      fixture.deploymentId,
      "--action",
      action,
      "--previous-lock-owner",
      "previous-owner",
    ],
    { cwd: fixture.root, env: fixture.baseEnv },
  );
}

function extractedPhaseValidator() {
  const source = readFileSync(pauseSource, "utf8");
  const start = source.indexOf("validate_cutover_phase_provenance() {");
  const end = source.indexOf("\nrequire_phase_mac_snapshot_seal() {", start);
  if (start < 0 || end < 0) throw new Error("Could not extract phase validator");
  return source.slice(start, end);
}

function runPhaseValidator(fixture: RecoveryFixture, action: string) {
  return run(
    "/bin/sh",
    [
      "-c",
      `set -eu
ACTION="$ACTION_UNDER_TEST"
SCRIPT_DIR="$SNAPSHOT_SCRIPTS"
FRONT_DIR="$FRONT_ROOT"
MAC_RUNTIME_BASE="$MAC_RUNTIME_BASE_FOR_TEST"
NEXT_PUBLIC_APP_VERSION="$CUTOVER_ID"
RECOVERY_FRONT_ROOT=
ENV_PATH="$PINNED_ENV"
EXPECTED_ENV_SHA256="$PINNED_ENV_SHA"
CANONICAL_TARGET_FILE="$SEALED_TARGET"
${extractedPhaseValidator()}
validate_cutover_phase_provenance "$PHASE_FILE_FOR_TEST"
`,
    ],
    {
      cwd: fixture.root,
      env: {
        ACTION_UNDER_TEST: action,
        SNAPSHOT_SCRIPTS: fixture.scripts,
        FRONT_ROOT: fixture.root,
        MAC_RUNTIME_BASE_FOR_TEST: join(fixture.root, "missing-mac-runtimes"),
        CUTOVER_ID: fixture.deploymentId,
        PINNED_ENV: fixture.envFile,
        PINNED_ENV_SHA: createHash("sha256")
          .update(readFileSync(fixture.envFile))
          .digest("hex"),
        SEALED_TARGET: join(fixture.snapshot, "ops", "production-target.json"),
        PHASE_FILE_FOR_TEST: fixture.phase,
      },
    },
  );
}

describe("action-scoped sealed recovery", () => {
  it("verifies an explicit sealed root subset without trusting omitted roots", () => {
    const fixture = createRecoveryFixture();
    const selected = join(fixture.scripts, "pause-production-cutover.sh");
    const omitted = fixture.supabaseCli;
    chmodSync(omitted, 0o700);
    writeFileSync(omitted, "corrupt omitted CLI\n", { mode: 0o500 });

    const subset = run(process.execPath, [
      verifierSource,
      "verify",
      "--marker",
      fixture.seal,
      "--symlink-boundary",
      fixture.snapshot,
      "--root-subset",
      "--path",
      selected,
    ]);
    expect(subset.status, subset.stderr).toBe(0);

    const unsealedRoot = run(process.execPath, [
      verifierSource,
      "verify",
      "--marker",
      fixture.seal,
      "--root-subset",
      "--path",
      fixture.root,
    ]);
    expect(unsealedRoot.status).not.toBe(0);
    expect(unsealedRoot.stderr).toContain("not uniquely present in the seal");

    chmodSync(selected, 0o700);
    writeFileSync(selected, "#!/bin/sh\nexit 9\n", { mode: 0o500 });
    const selectedCorruption = run(process.execPath, [
      verifierSource,
      "verify",
      "--marker",
      fixture.seal,
      "--root-subset",
      "--path",
      selected,
    ]);
    expect(selectedCorruption.status).not.toBe(0);
    expect(selectedCorruption.stderr).toContain("changed after they were sealed");
  });

  it("lets exact-old actions run without candidate/CLI bytes while activate stays full", () => {
    const fixture = createRecoveryFixture();
    chmodSync(fixture.supabaseCli, 0o700);
    writeFileSync(fixture.supabaseCli, "corrupt pinned CLI\n", { mode: 0o500 });
    chmodSync(fixture.webActivator, 0o700);
    writeFileSync(fixture.webActivator, "#!/bin/sh\nexit 91\n", { mode: 0o500 });

    for (const action of ["resume", "resume-remote"]) {
      const result = runRecovery(fixture, action);
      expect(result.error).toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(readFileSync(fixture.pauseMarker, "utf8").trim()).toBe(action);
    }

    const activate = runRecovery(fixture, "activate-prepared");
    expect(activate.status).not.toBe(0);
    expect(`${activate.stdout}\n${activate.stderr}`).toContain(
      "changed after they were sealed",
    );
  });

  it("does not require a candidate Mac seal for old rollback phase validation", () => {
    const fixture = createRecoveryFixture();
    const resume = runPhaseValidator(fixture, "resume");
    expect(resume.status, `${resume.stdout}\n${resume.stderr}`).toBe(0);

    const activate = runPhaseValidator(fixture, "activate-prepared");
    expect(activate.status).not.toBe(0);
    expect(`${activate.stdout}\n${activate.stderr}`).toContain(
      "Missing regular phase-bound Mac candidate seal",
    );
  });
});
