#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

function fail(message) {
  throw new Error(message);
}

function assertCanonicalExecutable(file, label) {
  if (!path.isAbsolute(file) || realpathSync(file) !== file) {
    fail(`${label} must be an absolute canonical path: ${file}`);
  }
  const stats = lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o111) === 0) {
    fail(`${label} must be a regular executable file: ${file}`);
  }
}

function isolatedProbeEnv(companion = "") {
  const env = { ...process.env };
  // Supabase's Go companion intentionally fetches GitHub's latest release on
  // every --version invocation, and its default HTTP client has no deadline.
  // Version pinning is an artifact-integrity check, so make that optional
  // update lookup fail locally and deterministically instead of depending on
  // public-network availability. The CLI still exits cleanly with its embedded
  // version, which is the value this gate must compare.
  for (const key of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
  ]) {
    env[key] = "http://127.0.0.1:0";
  }
  env.NO_PROXY = "";
  env.no_proxy = "";
  env.GITHUB_TOKEN = "";
  if (companion) {
    env.SUPABASE_GO_BINARY = companion;
  }
  return env;
}

function readVersion(
  executable,
  label,
  companion = "",
  timeout = 15_000,
) {
  // This is a read-only, local-only probe over a source or staged inode. A
  // transient TERM observed on the child process must not make an otherwise
  // intact cutover fail before any artifact is published. Retrying here does
  // not weaken the checksum or version comparisons below.
  let result;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    result = spawnSync(executable, ["--version"], {
      encoding: "utf8",
      env: isolatedProbeEnv(companion),
      maxBuffer: 1024 * 1024,
      timeout,
    });
    if (result.signal !== "SIGTERM" || attempt === 3) break;
  }
  if (result.error || result.status !== 0 || !result.stdout.trim()) {
    const detail =
      result.error?.message ||
      result.stderr.trim() ||
      (result.signal ? `signal ${result.signal}` : `exit ${result.status}`);
    fail(`${label} failed its isolated --version probe: ${detail}`);
  }
  const version = result.stdout.trim();
  if (!/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`${label} returned an invalid version: ${version}`);
  }
  return version;
}

function stageExecutable(source, temporary) {
  copyFileSync(source, temporary, constants.COPYFILE_EXCL);
  chmodSync(temporary, 0o500);
  const descriptor = openSync(temporary, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

const [
  sourceArgument,
  launcherDestinationArgument,
  companionDestinationArgument,
  versionArgument,
] = process.argv.slice(2);
if (
  !sourceArgument ||
  !launcherDestinationArgument ||
  !companionDestinationArgument ||
  !versionArgument
) {
  console.error(
    "Usage: scripts/pin-supabase-cli.mjs SOURCE LAUNCHER_DESTINATION COMPANION_DESTINATION VERSION_FILE",
  );
  process.exit(2);
}

const source = realpathSync(path.resolve(sourceArgument));
const launcherDestination = path.resolve(launcherDestinationArgument);
const companionDestination = path.resolve(companionDestinationArgument);
const versionFile = path.resolve(versionArgument);
const launcherTemporary = `${launcherDestination}.tmp.${process.pid}`;
const companionTemporary = `${companionDestination}.tmp.${process.pid}`;
const versionTemporary = `${versionFile}.tmp.${process.pid}`;
let launcherCreated = false;
let companionCreated = false;
let versionCreated = false;

try {
  assertCanonicalExecutable(source, "Resolved Supabase CLI");
  for (const destination of [
    launcherDestination,
    companionDestination,
    versionFile,
  ]) {
    if (existsSync(destination)) {
      fail(`Refusing to overwrite a pinned Supabase CLI artifact: ${destination}`);
    }
  }

  const companionCandidate = path.join(path.dirname(source), "supabase-go");
  let companionSource = source;
  let distribution = "self-contained CLI mirrored as companion";
  const sourceVersion = readVersion(source, "Resolved Supabase CLI");

  // The standalone installer currently ships a Bun `supabase` launcher next
  // to the real `supabase-go` executable. The launcher handles `--version`
  // itself, so copying only it passes preparation but `db push` later fails.
  // If that sibling exists, require an exact version match and pin both bytes.
  // A monolithic/Homebrew CLI has no sibling; mirroring its self-contained
  // binary into the companion slot keeps one deterministic sealed contract.
  if (existsSync(companionCandidate)) {
    companionSource = realpathSync(companionCandidate);
    assertCanonicalExecutable(companionSource, "Supabase CLI companion");
    const companionVersion = readVersion(
      companionSource,
      "Supabase CLI companion",
    );
    if (companionVersion !== sourceVersion) {
      fail(
        `Supabase launcher/companion version mismatch: ${sourceVersion} != ${companionVersion}`,
      );
    }
    distribution = "launcher plus supabase-go companion";
  }

  // Probe the staged inodes before publication. A newly copied executable in
  // a protected macOS workspace can require a one-time provenance assessment
  // (observed at ~27 seconds), so copied artifacts receive a larger but still
  // bounded local-only budget. Renaming keeps the already-assessed inode and a
  // failed probe cannot leave a final pinned executable behind.
  stageExecutable(source, launcherTemporary);
  stageExecutable(companionSource, companionTemporary);

  const pinnedCompanionVersion = readVersion(
    companionTemporary,
    "Pinned Supabase CLI companion",
    "",
    60_000,
  );
  const pinnedLauncherVersion = readVersion(
    launcherTemporary,
    "Pinned Supabase CLI launcher",
    companionTemporary,
    60_000,
  );
  if (
    pinnedLauncherVersion !== sourceVersion ||
    pinnedCompanionVersion !== sourceVersion
  ) {
    fail("Pinned Supabase CLI pair changed version while its bytes were copied");
  }

  renameSync(companionTemporary, companionDestination);
  companionCreated = true;
  renameSync(launcherTemporary, launcherDestination);
  launcherCreated = true;

  writeFileSync(versionTemporary, `${sourceVersion}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  const versionDescriptor = openSync(versionTemporary, "r");
  try {
    fsyncSync(versionDescriptor);
  } finally {
    closeSync(versionDescriptor);
  }
  renameSync(versionTemporary, versionFile);
  versionCreated = true;
  chmodSync(versionFile, 0o400);
  console.log(`Pinned Supabase CLI distribution: ${distribution}`);
} catch (error) {
  for (const temporary of [
    launcherTemporary,
    companionTemporary,
    versionTemporary,
  ]) {
    rmSync(temporary, { force: true });
  }
  if (versionCreated) rmSync(versionFile, { force: true });
  if (companionCreated) rmSync(companionDestination, { force: true });
  if (launcherCreated) rmSync(launcherDestination, { force: true });
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
