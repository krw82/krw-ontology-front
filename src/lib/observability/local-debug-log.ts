import { mkdir, appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface LocalDebugLogEntry {
  namespace: string;
  event: string;
  payload?: Record<string, unknown>;
}

export function writeLocalDebugLog(entry: LocalDebugLogEntry): void {
  void appendLocalDebugLog(entry).catch((error) => {
    console.warn("[local-debug-log] append failed", {
      namespace: entry.namespace,
      event: entry.event,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function localLogRoot() {
  const configured = process.env.KRW_LOG_DIR?.trim();
  return configured || path.join(homedir(), "krw-ontology-log");
}

async function appendLocalDebugLog(entry: LocalDebugLogEntry) {
  const envName = process.env.KRW_ONTOLOGY_ENV?.trim() || process.env.NODE_ENV || "local";
  const dir = path.join(localLogRoot(), "agent-worker", envName);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${sanitizeNamespace(entry.namespace)}.ndjson`);
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    worker_id:
      process.env.AGENT_WORKER_ID ||
      process.env.AGENT_SUPERVISOR_ID ||
      process.env.HOSTNAME ||
      null,
    event: entry.event,
    payload: entry.payload ?? {},
  });
  await appendFile(file, `${line}\n`, "utf8");
}

function sanitizeNamespace(namespace: string) {
  return namespace.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "debug";
}
