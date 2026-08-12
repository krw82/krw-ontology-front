import { lstatSync, readFileSync } from "node:fs";

const LOCAL_SUPABASE_DB_PORT = 54_322;

export function deriveSupabaseDatabaseUrl(
  supabaseUrl: string | undefined,
  password: string | undefined,
  portOverride?: string,
): string | null {
  if (!supabaseUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    return null;
  }

  const hostname = parsed.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    const port = parsePort(portOverride) ?? LOCAL_SUPABASE_DB_PORT;
    return `postgresql://postgres:${encodeURIComponent(
      password || "postgres",
    )}@${hostname}:${port}/postgres`;
  }

  const match = hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
  if (!match || !password) return null;

  const projectRef = match[1];
  return `postgresql://postgres:${encodeURIComponent(
    password,
  )}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`;
}

export function normalizePostgresListenChannel(
  raw: string | undefined,
  defaultChannel: string,
): string {
  const channel = raw?.trim() || defaultChannel;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(channel)) {
    throw new Error(`Invalid Postgres LISTEN channel: ${channel}`);
  }
  return channel;
}

export function shouldUsePostgresListenSsl(connectionString: string): boolean {
  try {
    const parsed = new URL(connectionString);
    const sslMode = parsed.searchParams.get("sslmode");
    if (sslMode === "disable") return false;
    return parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1";
  } catch {
    return true;
  }
}

export type PostgresTlsConfig = {
  readonly ca?: string;
  readonly rejectUnauthorized: true;
};

/**
 * Resolve one fail-closed TLS policy for Agent V1 PostgreSQL clients.
 * Local Supabase is deliberately plain TCP; every remote production database
 * verifies its certificate and requires an operator-provided CA bundle.
 */
export function resolvePostgresTls(
  connectionString: string,
  env: Record<string, string | undefined> = process.env,
): PostgresTlsConfig | undefined {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return undefined;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (local) return undefined;

  const caPem = firstNonEmpty(env.AGENT_V1_DATABASE_CA_PEM);
  const caFile = firstNonEmpty(env.AGENT_V1_DATABASE_CA_FILE);
  if (caPem && caFile) throw new Error("agent_v1_database_ca_ambiguous");

  let ca = caPem;
  if (caFile) {
    if (!caFile.startsWith("/")) throw new Error("agent_v1_database_ca_file_invalid");
    try {
      const metadata = lstatSync(caFile);
      if (!metadata.isFile()) throw new Error("agent_v1_database_ca_file_invalid");
      ca = readFileSync(caFile, "utf8");
    } catch (error) {
      if (error instanceof Error && error.message === "agent_v1_database_ca_file_invalid") throw error;
      throw new Error("agent_v1_database_ca_file_unreadable");
    }
  }

  const production = env.KRW_RUNTIME_ENVIRONMENT === "prod" || env.NODE_ENV === "production";
  const sslMode = parsed.searchParams.get("sslmode");
  if (sslMode === "disable" && production) {
    throw new Error("agent_v1_database_tls_disabled");
  }
  if (production && !ca) throw new Error("agent_v1_database_ca_missing");
  if (sslMode === "disable") return undefined;
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true };
}

export function firstNonEmpty(
  ...values: Array<string | undefined>
): string | undefined {
  return values.find((value) => value != null && value.trim() !== "");
}

function parsePort(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
