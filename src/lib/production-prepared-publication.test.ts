import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const deployWebPath = join(repoRoot, "scripts", "deploy-web-production.sh");
const deployAllPath = join(repoRoot, "scripts", "deploy-all-production.sh");

describe("sealed prepared-release publication lifecycle", () => {
  it("requires an explicit sealed lifecycle mode before any external command", () => {
    const result = spawnSync("/bin/sh", [deployWebPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: "/usr/bin:/bin" },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "Choose one explicit sealed prepared-release deployment mode.",
    );
  });

  it("separates release-local preparation from global publication and abandonment", () => {
    const source = readFileSync(deployWebPath, "utf8");
    const lifecycleBranch = source.indexOf(
      'if [ "$DEPLOY_MODE" = "activate-prepared" ]',
    );
    const publishMutation = source.indexOf("GLOBAL_MARKER_TMP=", lifecycleBranch);
    const localPrepareBranch = source.lastIndexOf(
      "if [ '$DEPLOY_MODE' = 'prepare-only' ]; then",
    );
    const localPrepareComplete = source.indexOf(
      "Prepared release-local web image registry:",
      localPrepareBranch,
    );

    expect(lifecycleBranch).toBeGreaterThan(-1);
    expect(publishMutation).toBeGreaterThan(lifecycleBranch);
    expect(localPrepareBranch).toBeGreaterThan(publishMutation);
    expect(localPrepareComplete).toBeGreaterThan(localPrepareBranch);
    expect(
      source.slice(localPrepareBranch, localPrepareComplete),
    ).not.toContain("GLOBAL_MARKER_TMP");
    expect(source).toContain("--publish-prepared");
    expect(source).toContain("--abandon-prepared");
    expect(source).toContain(
      '"\\$PREPARED_MARKER" "\\$RELEASE_ABANDONED_MARKER" "\\$MARKER_SHA256" 400',
    );
    expect(source).toContain("An activated release cannot be abandoned.");
    expect(source).toContain(
      "sealed durability input must be a regular file",
    );
    expect(source).toContain('"\\$REMOTE_FRONT_DIR/.deploy"');
    expect(source).toContain("const bottomUp = [...directories].sort");
    expect(source).toContain(
      "sealed durability ancestor must be a regular directory",
    );
    expect(source).toContain(
      "Reverse proxy must bind the exact live Caddyfile read-only at /etc/caddy/Caddyfile.",
    );
    expect(source).toContain(
      "Archived rollback Caddyfile differs from the exact live bind source.",
    );
    expect(source).toContain("CADDYFILE_SHA256");
    expect(source).toContain(
      "Archived rollback Caddyfile no longer matches its sealed identity.",
    );
  });

  it("journals local and published preparation in order and retries lost activation ACKs", () => {
    const source = readFileSync(deployAllPath, "utf8");
    const preparedLocal = source.indexOf("write_cutover_phase prepared_local");
    const publish = source.indexOf(
      'deploy-web-production.sh" --publish-prepared',
      preparedLocal,
    );
    const preparedPublished = source.indexOf(
      "write_cutover_phase prepared_published",
      publish,
    );
    const firstPause = source.indexOf(
      'pause_application_runtimes\n',
      preparedPublished,
    );

    expect(preparedLocal).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(preparedLocal);
    expect(preparedPublished).toBeGreaterThan(publish);
    expect(firstPause).toBeGreaterThan(preparedPublished);
    expect(source).toContain(
      'CUTOVER_MIGRATION_INCLUDE_ALL="${SUPABASE_DB_PUSH_INCLUDE_ALL:-0}"',
    );
    expect(source).toContain(
      "MIGRATION_INCLUDE_ALL must be exactly 0 or 1",
    );
    expect(source).toContain(
      'if ! /bin/sh "$SCRIPT_DIR/deploy-web-production.sh" --activate-prepared; then',
    );
    expect(source).toContain(
      "retrying once to recover a lost SSH acknowledgement",
    );
    const migrationApply = source.indexOf("echo \"Applying Supabase migrations...\"");
    const migrationPhase = source.indexOf(
      "write_cutover_phase migration_started",
      migrationApply,
    );
    const migrationMarker = source.indexOf(
      "write_migration_started_marker",
      migrationPhase,
    );
    const rollbackUnsafe = source.indexOf("ROLLBACK_UNSAFE=1", migrationMarker);
    const dbPush = source.indexOf(
      '"$MIGRATION_EXECUTABLE" db push',
      rollbackUnsafe,
    );
    expect(migrationPhase).toBeGreaterThan(migrationApply);
    expect(migrationMarker).toBeGreaterThan(migrationPhase);
    expect(rollbackUnsafe).toBeGreaterThan(migrationMarker);
    expect(dbPush).toBeGreaterThan(rollbackUnsafe);
    const macDirectoryFsync = source.indexOf(
      "Mac prepared-runtime durability path must be a regular directory",
    );
    expect(macDirectoryFsync).toBeGreaterThan(-1);
    expect(macDirectoryFsync).toBeLessThan(preparedLocal);

    const completionSignalsIgnored = source.indexOf(
      "trap '' INT TERM\n    write_cutover_phase complete",
    );
    const completionVolatileState = source.indexOf(
      "CUTOVER_PAUSED=0",
      completionSignalsIgnored,
    );
    const completionTrapReset = source.indexOf(
      "trap release_deploy_lock EXIT",
      completionVolatileState,
    );
    expect(completionSignalsIgnored).toBeGreaterThan(-1);
    expect(completionVolatileState).toBeGreaterThan(completionSignalsIgnored);
    expect(completionTrapReset).toBeGreaterThan(completionVolatileState);
  });

  it("admits only the exact terminal phase set before a new deployment", () => {
    const source = readFileSync(deployAllPath, "utf8");
    const terminalSet = source.slice(
      source.indexOf("const terminals = new Set(["),
      source.indexOf("]);", source.indexOf("const terminals = new Set([")) + 3,
    );

    expect(terminalSet).toContain('"complete"');
    expect(terminalSet).toContain('"rolled_back"');
    expect(terminalSet).toContain('"gcp_restored_mac_fail_closed"');
    expect(terminalSet).toContain('"abandoned_pre_pause"');
    expect((terminalSet.match(/^\s*"/gm) ?? []).length).toBe(4);
    expect(source).toContain(
      "Unfinished production cutover requires recovery before a new deploy",
    );
    expect(source).toContain('if [ "$durable_phase" = complete ]; then');
  });

  it("durably publishes and reads back the one-time Mac bootstrap receipt before completion", () => {
    const source = readFileSync(deployAllPath, "utf8");
    const functionStart = source.indexOf("complete_unsealed_mac_bootstrap() {");
    const functionEnd = source.indexOf(
      '\nif [ "$DB_CHECK" = "1" ]',
      functionStart,
    );
    const bootstrap = source.slice(functionStart, functionEnd);
    const rename = bootstrap.indexOf("fs.renameSync(source, destination)");
    const destinationFsync = bootstrap.indexOf(
      'fd = fs.openSync(destination, "r")',
      rename,
    );
    const parentFsync = bootstrap.indexOf(
      'fd = fs.openSync(parent, "r")',
      destinationFsync,
    );
    const readback = bootstrap.indexOf(
      "validateMarker(destination) !== expectedBytes",
      parentFsync,
    );

    expect(functionStart).toBeGreaterThan(-1);
    expect(rename).toBeGreaterThan(-1);
    expect(destinationFsync).toBeGreaterThan(rename);
    expect(parentFsync).toBeGreaterThan(destinationFsync);
    expect(readback).toBeGreaterThan(parentFsync);
    expect(source.indexOf("write_cutover_phase complete")).toBeGreaterThan(
      functionEnd,
    );
  });
});
