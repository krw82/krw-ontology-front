#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
let envFile = ".env.mac-worker.production";
let timeoutMs = 120_000;
let intervalMs = 2_000;
let expectedReleaseId = "";

function usage() {
  console.log(`Usage: scripts/verify-mac-worker-heartbeats.mjs [--env-file FILE] [--timeout-ms MS] [--interval-ms MS] [--release-id ID]

Verify that all configured Mac production workers have fresh Supabase
heartbeats. Secrets are read from the env file but never printed.`);
}

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--env-file") {
    envFile = args[++index];
  } else if (arg === "--timeout-ms") {
    timeoutMs = Number(args[++index]);
  } else if (arg === "--interval-ms") {
    intervalMs = Number(args[++index]);
  } else if (arg === "--release-id") {
    expectedReleaseId = args[++index] || "";
  } else if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  } else {
    usage();
    process.exit(1);
  }
}

function loadEnv(path) {
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function requireEnv(key) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env value: ${key}`);
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

loadEnv(envFile);

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl) {
  throw new Error("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
}

const workerCount = Number(process.env.MAC_WORKER_COUNT || "1");
if (!Number.isInteger(workerCount) || workerCount < 1) {
  throw new Error(`MAC_WORKER_COUNT must be a positive integer: ${workerCount}`);
}

let workerPrefix =
  process.env.AGENT_WORKER_ID_PREFIX || process.env.AGENT_WORKER_ID || "";
workerPrefix = workerPrefix.replace(/-\d+$/, "");
if (!workerPrefix) {
  throw new Error("Missing AGENT_WORKER_ID_PREFIX or AGENT_WORKER_ID");
}

const expectedClaudeVersion = process.env.EXPECTED_CLAUDE_CODE_VERSION || "";
const expectedOntologyEnv = process.env.KRW_ONTOLOGY_ENV || "prod";
const expectedWorkerIds = Array.from(
  { length: workerCount },
  (_, index) => `${workerPrefix}-${index + 1}`,
);

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function readHeartbeats() {
  const { data, error } = await client
    .from("agent_worker_heartbeats")
    .select(
      "worker_id,status,last_seen_at,heartbeat_expires_at,claude_code_version,error,worker_env,ontology_env,ontology_release_id,manifest_valid,manifest_path,index_path,root,plugin_path",
    )
    .in("worker_id", expectedWorkerIds)
    .order("worker_id", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

function validate(rows) {
  const byId = new Map(rows.map((row) => [row.worker_id, row]));
  const now = Date.now();
  const problems = [];

  for (const workerId of expectedWorkerIds) {
    const row = byId.get(workerId);
    if (!row) {
      problems.push(`${workerId}: missing heartbeat`);
      continue;
    }

    const expiresAt = Date.parse(row.heartbeat_expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      problems.push(`${workerId}: expired heartbeat`);
    }
    if (row.status !== "idle" && row.status !== "running") {
      problems.push(`${workerId}: status=${row.status}`);
    }
    if (row.error) {
      problems.push(`${workerId}: error=${row.error}`);
    }
    if (row.worker_env !== expectedOntologyEnv) {
      problems.push(`${workerId}: worker_env=${row.worker_env || "missing"}`);
    }
    if (row.ontology_env !== expectedOntologyEnv) {
      problems.push(`${workerId}: ontology_env=${row.ontology_env || "missing"}`);
    }
    if (!row.ontology_release_id) {
      problems.push(`${workerId}: missing ontology_release_id`);
    } else if (expectedReleaseId && row.ontology_release_id !== expectedReleaseId) {
      problems.push(
        `${workerId}: release=${row.ontology_release_id}, expected=${expectedReleaseId}`,
      );
    }
    if (row.manifest_valid !== true) {
      problems.push(`${workerId}: manifest_valid=${String(row.manifest_valid)}`);
    }
    if (
      expectedClaudeVersion &&
      !(row.claude_code_version || "").includes(expectedClaudeVersion)
    ) {
      problems.push(
        `${workerId}: claude=${row.claude_code_version || "missing"}`,
      );
    }
  }

  return problems;
}

const deadline = Date.now() + timeoutMs;
let lastRows = [];
let lastProblems = [];

while (Date.now() <= deadline) {
  lastRows = await readHeartbeats();
  lastProblems = validate(lastRows);
  if (lastProblems.length === 0) break;
  await sleep(intervalMs);
}

const now = Date.now();
for (const row of lastRows) {
  const ageSeconds = Math.round((now - Date.parse(row.last_seen_at)) / 1000);
  const ttlSeconds = Math.round(
    (Date.parse(row.heartbeat_expires_at) - now) / 1000,
  );
  console.log(
    `${row.worker_id}\t${row.status}\tenv=${row.ontology_env || "unknown"}\trelease=${row.ontology_release_id || "unknown"}\tage=${ageSeconds}s\tttl=${ttlSeconds}s\tclaude=${row.claude_code_version || "unknown"}`,
  );
}

if (lastProblems.length > 0) {
  console.error("Mac worker heartbeat verification failed:");
  for (const problem of lastProblems) {
    console.error(`- ${problem}`);
  }
  process.exit(1);
}

console.log(`OK Mac worker heartbeats: ${expectedWorkerIds.join(", ")}`);
