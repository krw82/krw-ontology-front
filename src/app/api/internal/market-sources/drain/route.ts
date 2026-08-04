import { createHmac, timingSafeEqual } from "node:crypto";

import {
  getMarketWebSourceRuntimeConfig,
  runMarketWebSourceIngestionCycle,
} from "@/lib/market-issues/web-ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIGNATURE_AGE_SECONDS = 300;

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.MARKET_ISSUE_WORKER_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "market_source_webhook_not_configured" }, { status: 503 });

  const environment = request.headers.get("x-krw-environment") || "";
  const timestamp = request.headers.get("x-krw-timestamp") || "";
  const maxJobsHeader = request.headers.get("x-krw-max-jobs") || "20";
  const signature = request.headers.get("x-krw-signature") || "";
  if (!isValidEnvironment(environment) || !isFreshTimestamp(timestamp) || !isValidSignature({
    secret,
    timestamp,
    environment,
    maxJobs: maxJobsHeader,
    signature,
  })) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    // The scheduler always sends JSON, but the authenticated headers are the source of truth.
  }
  if (body.environment && body.environment !== environment) {
    return Response.json({ error: "environment_mismatch" }, { status: 400 });
  }

  const baseConfig = getMarketWebSourceRuntimeConfig();
  const result = await runMarketWebSourceIngestionCycle({
    config: { ...baseConfig, environment },
    maxQueueJobs: boundedNumber(maxJobsHeader, 20, 1, 100),
  });
  return Response.json(result, { status: 200 });
}

function isValidEnvironment(value: string): value is "dev" | "staging" | "prod" {
  return value === "dev" || value === "staging" || value === "prod";
}

function isFreshTimestamp(value: string): boolean {
  const seconds = Number(value);
  return Number.isFinite(seconds) && Math.abs(Date.now() / 1000 - seconds) <= MAX_SIGNATURE_AGE_SECONDS;
}

function isValidSignature(input: {
  secret: string;
  timestamp: string;
  environment: string;
  maxJobs: string;
  signature: string;
}): boolean {
  const expected = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.environment}.${input.maxJobs}`)
    .digest("hex");
  if (expected.length !== input.signature.length) return false;
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(input.signature, "utf8"));
}

function boundedNumber(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
