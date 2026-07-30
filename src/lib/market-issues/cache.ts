import "server-only";

import { createClient, type RedisClientType } from "redis";

const CACHE_TTL_SECONDS = 60;
const CONNECT_TIMEOUT_MS = 750;
const RETRY_AFTER_FAILURE_MS = 10000;

let clientPromise: Promise<RedisClientType | null> | null = null;
let unavailableUntil = 0;

export function marketIssueRedisUrl(): string | null {
  return (
    process.env.MARKET_ISSUE_REDIS_URL?.trim() ||
    process.env.PULSE_REDIS_URL?.trim() ||
    process.env.REDIS_QUEUE_URL?.trim() ||
    process.env.DOCUMENT_QUEUE_REDIS_URL?.trim() ||
    null
  );
}

export function marketIssueGlobalCacheKey(input: {
  env: string;
  revision: number | string;
}): string {
  return [
    "krwo",
    "market-issues",
    "published",
    "v1",
    input.env,
    String(input.revision),
  ].join(":");
}

export async function getOrLoadMarketIssueGlobalCache<T>(
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const client = await marketIssueRedisClient();
  if (!client) return load();

  try {
    const cached = await client.get(key);
    if (cached) return JSON.parse(cached) as T;
  } catch {
    // PostgreSQL remains authoritative when the optional cache is unavailable.
  }

  const value = await load();
  try {
    await client.set(key, JSON.stringify(value), { EX: CACHE_TTL_SECONDS });
  } catch {
    // A failed acceleration write must never fail a market issue response.
  }
  return value;
}

async function marketIssueRedisClient(): Promise<RedisClientType | null> {
  if (Date.now() < unavailableUntil) return null;
  if (!clientPromise) clientPromise = connectMarketIssueRedis();

  const client = await clientPromise;
  if (!client) {
    clientPromise = null;
    unavailableUntil = Date.now() + RETRY_AFTER_FAILURE_MS;
  }
  return client;
}

async function connectMarketIssueRedis(): Promise<RedisClientType | null> {
  const url = marketIssueRedisUrl();
  if (!url) return null;

  let client: RedisClientType | null = null;
  try {
    client = createClient({
      url,
      socket: {
        connectTimeout: CONNECT_TIMEOUT_MS,
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
