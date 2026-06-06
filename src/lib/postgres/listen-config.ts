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
