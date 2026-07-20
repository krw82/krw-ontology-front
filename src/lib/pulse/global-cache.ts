import "server-only";

import { createClient, type RedisClientType } from "redis";

const PULSE_CACHE_TTL_SECONDS = 60;
const REDIS_CONNECT_TIMEOUT_MS = 750;
const REDIS_RETRY_AFTER_FAILURE_MS = 10_000;

type JsonValue = Record<string, unknown> | unknown[];

let clientPromise: Promise<RedisClientType | null> | null = null;
let redisUnavailableUntil = 0;

export function pulseRedisUrl(
  env?: Partial<Record<"PULSE_REDIS_URL" | "REDIS_QUEUE_URL" | "DOCUMENT_QUEUE_REDIS_URL", string>>,
): string | null {
  const source = env ?? process.env;
  const value = source.PULSE_REDIS_URL?.trim()
    || source.REDIS_QUEUE_URL?.trim()
    || source.DOCUMENT_QUEUE_REDIS_URL?.trim()
    || null;
  return value || null;
}

export function pulseGlobalCacheKey(input: {
  env: string;
  globalRevision: bigint | number | string;
  timeBucket: bigint | number | string;
}): string {
  return [
    "krwo",
    "pulse",
    "global-filing-candidates",
    "v3",
    input.env,
    String(input.globalRevision),
    String(input.timeBucket),
  ].join(":");
}

/**
 * Shared cache only stores catalog-wide candidate rows. User IDs, judgments,
 * notes, and final personalized feeds must never enter this cache.
 */
export async function getOrLoadPulseGlobalCache<T extends JsonValue>(
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const client = await pulseRedisClient();
  if (!client) return load();

  try {
    const cached = await client.get(key);
    if (cached) {
      const parsed = JSON.parse(cached) as T;
      return parsed;
    }
  } catch {
    // Redis is an optional acceleration layer. A cache parse or transport
    // failure must never block a private, database-backed Pulse response.
  }

  const value = await load();
  try {
    await client.set(key, JSON.stringify(value), { EX: PULSE_CACHE_TTL_SECONDS });
  } catch {
    // The source of truth remains PostgreSQL; ignore failed cache writes.
  }
  return value;
}

async function pulseRedisClient(): Promise<RedisClientType | null> {
  if (Date.now() < redisUnavailableUntil) return null;
  if (!clientPromise) {
    clientPromise = connectPulseRedis();
  }
  const client = await clientPromise;
  if (!client) {
    clientPromise = null;
    redisUnavailableUntil = Date.now() + REDIS_RETRY_AFTER_FAILURE_MS;
  }
  return client;
}

async function connectPulseRedis(): Promise<RedisClientType | null> {
  const url = pulseRedisUrl();
  if (!url) return null;
  let client: RedisClientType | null = null;
  try {
    client = createClient({
      url,
      socket: {
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
        reconnectStrategy: false,
      },
      disableOfflineQueue: true,
    });
    client.on("error", () => undefined);
    await client.connect();
    return client;
  } catch {
    client?.destroy();
    return null;
  }
}
