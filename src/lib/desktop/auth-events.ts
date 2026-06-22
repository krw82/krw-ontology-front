import { createHash } from "node:crypto";

const ALLOWED_FIELDS = new Set([
  "attempt_id_hash",
  "device_id_hash",
  "error_code",
  "latency_ms",
  "request_id_hash",
  "status",
  "user_id_hash",
]);

export function logDesktopAuthEvent(
  stage: string,
  details: Record<string, unknown> = {},
) {
  const event: Record<string, unknown> = {
    at: new Date().toISOString(),
    kind: "desktop_auth_event",
    stage: boundedToken(stage, "unknown"),
  };
  for (const [key, value] of Object.entries(details)) {
    if (!ALLOWED_FIELDS.has(key) || value === undefined || value === null) continue;
    if (key === "latency_ms") {
      event[key] = Math.max(0, Math.round(Number(value) || 0));
    } else {
      event[key] = boundedToken(value, "unknown");
    }
  }
  console.info(JSON.stringify(event));
  return event;
}

export function desktopAuthIdentifierHash(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text
    ? createHash("sha256").update(text).digest("hex").slice(0, 16)
    : "missing";
}

function boundedToken(value: unknown, fallback: string) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, "_")
    .slice(0, 120);
  return normalized || fallback;
}
