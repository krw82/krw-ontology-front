import { createHash } from "node:crypto";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
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
const queueWrapper = join(repoRoot, "scripts", "deploy-with-queue-pause.sh");
const artifactVerifier = join(
  repoRoot,
  "scripts",
  "verify-prepared-runtime-artifacts.mjs",
);

type Fixture = {
  root: string;
  queueRoot: string;
  queueState: string;
  receipt: string;
  env: Partial<NodeJS.ProcessEnv>;
};

const fixtureRoots: string[] = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeExecutable(path: string, source: string) {
  writeFileSync(path, source, { mode: 0o500 });
  chmodSync(path, 0o500);
}

function createFixture(): Fixture {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "krw-queue-pause-receipt-")),
  );
  fixtureRoots.push(root);
  const scripts = join(root, "scripts");
  const queueRoot = join(root, "queue");
  const ontologyRoot = join(root, "ontology");
  const releasesRoot = join(root, "releases");
  const queueState = join(root, "queue-state");
  const fakeCli = join(root, "fake-krw-ontology.sh");
  const stopProof = join(root, "stop-observed-receipt");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(queueRoot, { recursive: true });
  mkdirSync(ontologyRoot, { recursive: true });
  mkdirSync(releasesRoot, { recursive: true });
  copyFileSync(queueWrapper, join(scripts, "deploy-with-queue-pause.sh"));
  chmodSync(join(scripts, "deploy-with-queue-pause.sh"), 0o500);
  writeFileSync(queueState, "running\n");

  writeExecutable(
    fakeCli,
    `#!/bin/sh
set -eu
[ "$1" = queue ]
action=$2
case "$action" in
  status)
    state=$(sed -n '1p' "$FAKE_QUEUE_STATE")
    wants_json=0
    for argument in "$@"; do
      [ "$argument" = --json ] && wants_json=1
    done
    if [ "$wants_json" = 1 ]; then
      printf '{"worker":{"state":"%s","mode":{"publish_prod":false}},"counts":{"running":0},"active_publish_roots":[],"active_publish_index_paths":[]}\\n' "$state"
    else
      printf 'queue state: %s\\n' "$state"
    fi
    ;;
  stop)
    receipt="$FAKE_FRONT_ROOT/.deploy/queue-pause-receipt.env"
    test -f "$receipt"
    grep -q "^CUTOVER_ID=$NEXT_PUBLIC_APP_VERSION$" "$receipt"
    grep -q "^LOCK_OWNER=$PRODUCTION_DEPLOY_LOCK_OWNER$" "$receipt"
    printf 'receipt-observed\\n' >"$FAKE_STOP_PROOF"
    printf 'stopped\\n' >"$FAKE_QUEUE_STATE"
    if [ "\${FAKE_STOP_EXIT_AFTER_STOP:-0}" != "0" ]; then
      exit "$FAKE_STOP_EXIT_AFTER_STOP"
    fi
    ;;
  start)
    printf 'running\\n' >"$FAKE_QUEUE_STATE"
    ;;
  *)
    echo "unexpected queue action: $action" >&2
    exit 70
    ;;
esac
`,
  );

  writeExecutable(
    join(scripts, "deploy-all-production.sh"),
    `#!/bin/sh
set -eu
phase="$FAKE_FRONT_ROOT/.deploy/cutover-phase-$NEXT_PUBLIC_APP_VERSION.env"
case "\${FAKE_DEPLOY_MODE:-success}" in
  success) next_phase=complete ;;
  nonterminal) next_phase=migration_started ;;
  no-phase-failure) exit 43 ;;
  *) echo "unexpected fake deploy mode" >&2; exit 70 ;;
esac
printf '%s\\n' \\
  'FORMAT=krw-production-cutover-phase/v1' \\
  "DEPLOYMENT_ID=$NEXT_PUBLIC_APP_VERSION" \\
  "LOCK_OWNER=$PRODUCTION_DEPLOY_LOCK_OWNER" \\
  "PHASE=$next_phase" \\
  'UPDATED_AT=2026-07-18T00:00:00.000Z' \\
  "ORIGINAL_LOCK_OWNER=$PRODUCTION_DEPLOY_LOCK_OWNER" \\
  >"$phase"
[ "$next_phase" = complete ] || exit 42
`,
  );

  return {
    root,
    queueRoot,
    queueState,
    receipt: join(root, ".deploy", "queue-pause-receipt.env"),
    env: {
      ...process.env,
      PRODUCTION_OS_LOCK_HELD: "1",
      KRW_ONTOLOGY_QUEUE_ROOT: queueRoot,
      KRW_ONTOLOGY_SOURCE_DIR: ontologyRoot,
      KRW_ONTOLOGY_RELEASES_ROOT: releasesRoot,
      KRW_ONTOLOGY_CLI: fakeCli,
      FAKE_FRONT_ROOT: root,
      FAKE_QUEUE_STATE: queueState,
      FAKE_STOP_PROOF: stopProof,
      QUEUE_STOP_TIMEOUT_SECONDS: "1",
      QUEUE_POLL_INTERVAL: "0.01",
    },
  };
}

function runWrapper(
  fixture: Fixture,
  args: string[] = [],
  overrides: Partial<NodeJS.ProcessEnv> = {},
): SpawnSyncReturns<string> {
  return spawnSync(
    "/bin/sh",
    [join(fixture.root, "scripts", "deploy-with-queue-pause.sh"), ...args],
    {
      cwd: fixture.root,
      env: {
        ...fixture.env,
        ...overrides,
        NODE_ENV: overrides.NODE_ENV ?? fixture.env.NODE_ENV ?? "test",
      },
      encoding: "utf8",
      timeout: 15_000,
    },
  );
}

function parseFields(path: string) {
  return new Map(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)] as const;
      }),
  );
}

function writePhase(
  fixture: Fixture,
  deploymentId: string,
  phase: string,
  lockOwner: string,
  originalLockOwner: string,
  extra: string[] = [],
) {
  writeFileSync(
    join(fixture.root, ".deploy", `cutover-phase-${deploymentId}.env`),
    [
      "FORMAT=krw-production-cutover-phase/v1",
      `DEPLOYMENT_ID=${deploymentId}`,
      `LOCK_OWNER=${lockOwner}`,
      `PHASE=${phase}`,
      "UPDATED_AT=2026-07-18T00:00:00.000Z",
      `ORIGINAL_LOCK_OWNER=${originalLockOwner}`,
      ...extra,
      "",
    ].join("\n"),
    { mode: 0o400 },
  );
}

function prepareRecoverySnapshot(
  fixture: Fixture,
  deploymentId: string,
  originalLockOwner: string,
) {
  const snapshot = join(fixture.root, ".deploy", `cutover-${deploymentId}`);
  const scripts = join(snapshot, "scripts");
  mkdirSync(scripts, { recursive: true });
  const driver = join(scripts, "recover-production-cutover.sh");
  const verifier = join(scripts, "verify-prepared-runtime-artifacts.mjs");
  const pauseController = join(scripts, "pause-production-cutover.sh");
  writeExecutable(
    driver,
    `#!/bin/sh
set -eu
phase="$FAKE_FRONT_ROOT/.deploy/cutover-phase-$FAKE_CUTOVER_ID.env"
printf '%s\\n' \\
  'FORMAT=krw-production-cutover-phase/v1' \\
  "DEPLOYMENT_ID=$FAKE_CUTOVER_ID" \\
  "LOCK_OWNER=$PRODUCTION_DEPLOY_LOCK_OWNER" \\
  'PHASE=complete' \\
  'UPDATED_AT=2026-07-18T00:00:01.000Z' \\
  "ORIGINAL_LOCK_OWNER=$FAKE_ORIGINAL_LOCK_OWNER" \\
  >"$phase"
`,
  );
  copyFileSync(artifactVerifier, verifier);
  chmodSync(verifier, 0o400);
  writeExecutable(pauseController, "#!/bin/sh\nexit 0\n");
  const seal = join(snapshot, "recovery-seal.json");
  const prepared = spawnSync(
    process.execPath,
    [
      artifactVerifier,
      "prepare",
      "--marker",
      seal,
      "--symlink-boundary",
      snapshot,
      "--path",
      driver,
      "--path",
      verifier,
      "--path",
      pauseController,
    ],
    { encoding: "utf8", timeout: 15_000 },
  );
  expect(prepared.error).toBeUndefined();
  expect(prepared.status, prepared.stderr).toBe(0);
  const sealSha256 = createHash("sha256")
    .update(readFileSync(seal))
    .digest("hex");
  writePhase(
    fixture,
    deploymentId,
    "migration_started",
    originalLockOwner,
    originalLockOwner,
    [
      `RECOVERY_SEAL_PATH=${seal}`,
      `RECOVERY_SEAL_SHA256=${sealSha256}`,
    ],
  );
}

describe("durable production queue-pause receipt", () => {
  it("fsyncs a receipt before stop, then restarts and consumes it on terminal deploy", () => {
    const fixture = createFixture();
    const result = runWrapper(fixture, [], {
      NEXT_PUBLIC_APP_VERSION: "queue-receipt-success",
      FAKE_DEPLOY_MODE: "success",
    });

    expect(result.error).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readFileSync(fixture.queueState, "utf8").trim()).toBe("running");
    expect(
      existsSync(join(fixture.root, "stop-observed-receipt")),
    ).toBe(true);
    expect(existsSync(fixture.receipt)).toBe(false);
    expect(result.stdout).toContain(
      "Restarting queue worker from durable pause receipt",
    );
  });

  it("continues safely when the queue runner reports an error only after the worker stopped", () => {
    const fixture = createFixture();
    const result = runWrapper(fixture, [], {
      NEXT_PUBLIC_APP_VERSION: "queue-receipt-stop-after-stop",
      FAKE_DEPLOY_MODE: "success",
      FAKE_STOP_EXIT_AFTER_STOP: "70",
    });

    expect(result.error).toBeUndefined();
    expect(result.status, `${result.stdout}\\n${result.stderr}`).toBe(0);
    expect(result.stderr).toContain(
      "Queue stop returned 70 after the worker stopped",
    );
    expect(readFileSync(fixture.queueState, "utf8").trim()).toBe("running");
    expect(existsSync(fixture.receipt)).toBe(false);
  });

  it("retains a nonterminal crash receipt, rejects wrong recovery, then consumes it after exact recovery", () => {
    const fixture = createFixture();
    const deploymentId = "queue-receipt-recovery";
    const failed = runWrapper(fixture, [], {
      NEXT_PUBLIC_APP_VERSION: deploymentId,
      FAKE_DEPLOY_MODE: "nonterminal",
    });

    expect(failed.error).toBeUndefined();
    expect(failed.status).toBe(42);
    expect(readFileSync(fixture.queueState, "utf8").trim()).toBe("stopped");
    expect(existsSync(fixture.receipt)).toBe(true);
    const receipt = parseFields(fixture.receipt);
    const originalLockOwner = receipt.get("LOCK_OWNER");
    expect(originalLockOwner).toBeTruthy();
    expect(receipt.get("CUTOVER_ID")).toBe(deploymentId);

    const blockedNormal = runWrapper(fixture, [], {
      NEXT_PUBLIC_APP_VERSION: "unrelated-deploy",
      FAKE_DEPLOY_MODE: "success",
    });
    expect(blockedNormal.status).not.toBe(0);
    expect(`${blockedNormal.stdout}\n${blockedNormal.stderr}`).toContain(
      "belongs to nonterminal cutover",
    );
    expect(readFileSync(fixture.queueState, "utf8").trim()).toBe("stopped");
    expect(existsSync(fixture.receipt)).toBe(true);

    prepareRecoverySnapshot(fixture, deploymentId, originalLockOwner!);
    const wrongOwner = runWrapper(
      fixture,
      [
        "--recovery-only",
        "--recover-cutover",
        deploymentId,
        "--recovery-action",
        "activate-prepared",
        "--previous-lock-owner",
        "wrong-owner",
      ],
      { FAKE_CUTOVER_ID: deploymentId },
    );
    expect(wrongOwner.status).not.toBe(0);
    expect(`${wrongOwner.stdout}\n${wrongOwner.stderr}`).toContain(
      "Recovery lock owner does not match",
    );
    expect(readFileSync(fixture.queueState, "utf8").trim()).toBe("stopped");
    expect(existsSync(fixture.receipt)).toBe(true);

    const recovered = runWrapper(
      fixture,
      [
        "--recovery-only",
        "--recover-cutover",
        deploymentId,
        "--recovery-action",
        "activate-prepared",
        "--previous-lock-owner",
        originalLockOwner!,
      ],
      {
        FAKE_CUTOVER_ID: deploymentId,
        FAKE_ORIGINAL_LOCK_OWNER: originalLockOwner!,
      },
    );
    expect(recovered.error).toBeUndefined();
    expect(recovered.status, `${recovered.stdout}\n${recovered.stderr}`).toBe(0);
    expect(recovered.stdout).toContain("Adopting durable queue pause");
    expect(readFileSync(fixture.queueState, "utf8").trim()).toBe("running");
    expect(existsSync(fixture.receipt)).toBe(false);
  });

  it("rejects a terminal receipt whose lock owner mismatches the cutover journal", () => {
    const fixture = createFixture();
    const deploymentId = "queue-receipt-stale";
    writeFileSync(fixture.queueState, "stopped\n");
    mkdirSync(join(fixture.root, ".deploy"), { recursive: true });
    writeFileSync(
      fixture.receipt,
      [
        "FORMAT=krw-production-queue-pause/v1",
        `FRONT_ROOT=${fixture.root}`,
        `QUEUE_ROOT=${fixture.queueRoot}`,
        `CUTOVER_ID=${deploymentId}`,
        "LOCK_OWNER=stale-owner",
        "QUEUE_WAS_RUNNING=1",
        "RESTART_REQUESTED=1",
        "CREATED_AT=2026-07-18T00:00:00.000Z",
        "",
      ].join("\n"),
      { mode: 0o400 },
    );
    writePhase(
      fixture,
      deploymentId,
      "complete",
      "real-owner",
      "real-owner",
    );

    const result = runWrapper(fixture, [], {
      NEXT_PUBLIC_APP_VERSION: "unrelated-deploy",
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "not bound to the cutover's original lock owner",
    );
    expect(readFileSync(fixture.queueState, "utf8").trim()).toBe("stopped");
    expect(existsSync(fixture.receipt)).toBe(true);
  });
});
