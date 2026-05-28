export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

export type OntologyEnv = "dev" | "staging" | "prod";

const ONTOLOGY_ENVS = new Set<OntologyEnv>(["dev", "staging", "prod"]);

export function normalizeOntologyEnv(value: string | undefined): OntologyEnv | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  return ONTOLOGY_ENVS.has(normalized as OntologyEnv)
    ? (normalized as OntologyEnv)
    : null;
}

export function getOntologyEnv(env: Record<string, string | undefined> = process.env): OntologyEnv {
  const configured = normalizeOntologyEnv(env.KRW_ONTOLOGY_ENV);
  if (configured) return configured;
  return env.NODE_ENV === "production" ? "prod" : "dev";
}

interface NumberEnvOptions {
  min?: number;
  max?: number;
}

function warnInvalidEnv(key: string, raw: string | undefined, fallback: number) {
  if (process.env.NODE_ENV === "test") return;
  console.warn(`[env] Invalid ${key}=${JSON.stringify(raw)}; using ${fallback}`);
}

function clampNumber(value: number, options: NumberEnvOptions): number | null {
  if (options.min != null && value < options.min) return null;
  if (options.max != null && value > options.max) return null;
  return value;
}

export function readIntEnv(
  key: string,
  fallback: number,
  options: NumberEnvOptions = {},
): number {
  const raw = process.env[key];
  if (raw == null || raw.trim() === "") return fallback;

  const value = Number.parseInt(raw, 10);
  const clamped = Number.isFinite(value) ? clampNumber(value, options) : null;
  if (clamped == null) {
    warnInvalidEnv(key, raw, fallback);
    return fallback;
  }

  return clamped;
}

export function readFloatEnv(
  key: string,
  fallback: number,
  options: NumberEnvOptions = {},
): number {
  const raw = process.env[key];
  if (raw == null || raw.trim() === "") return fallback;

  const value = Number.parseFloat(raw);
  const clamped = Number.isFinite(value) ? clampNumber(value, options) : null;
  if (clamped == null) {
    warnInvalidEnv(key, raw, fallback);
    return fallback;
  }

  return clamped;
}
