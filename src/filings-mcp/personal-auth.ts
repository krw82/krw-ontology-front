import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { authenticateDesktopAccessToken } from "@/lib/desktop/device-auth";
import type { DesktopAuthContext } from "@/lib/desktop/auth";

export const PERSONAL_FILINGS_MCP_AUTH_HEADER = "x-krw-user-authorization";
const INTERNAL_AUDIENCE = "krw-filings-personal";
const INTERNAL_ISSUER = "krw-web-agent";
const INTERNAL_TOKEN_VERSION = 1;
const DEFAULT_INTERNAL_TTL_SECONDS = 12 * 60;
const MAX_INTERNAL_TTL_SECONDS = 60 * 60;
const CLOCK_SKEW_SECONDS = 60;

type PersonalTokenAuthenticator = (
  token: string,
) => Promise<DesktopAuthContext | null>;

export interface PersonalFilingsMcpAuthContext {
  userId: string;
  userEmail: string | null;
  deviceId: string | null;
  authMethod: DesktopAuthContext["authMethod"] | "internal_web_session";
}

export class PersonalFilingsMcpAuthError extends Error {
  constructor() {
    super("Invalid personal filings MCP credential");
    this.name = "PersonalFilingsMcpAuthError";
  }
}

/**
 * The service Authorization header authenticates the MCP client itself. A
 * separate short-lived Desktop credential or server-signed web-session
 * identity opts the request into user-scoped tools, so a service token alone
 * can never read personal notes or judgments.
 */
export async function authenticatePersonalFilingsMcpHeader(
  headerValue: string | string[] | undefined,
  authenticate: PersonalTokenAuthenticator = authenticateDesktopAccessToken,
  now = Date.now(),
): Promise<PersonalFilingsMcpAuthContext | null> {
  if (headerValue === undefined) return null;
  if (Array.isArray(headerValue)) throw new PersonalFilingsMcpAuthError();
  if (headerValue.startsWith("Internal ")) {
    return verifyInternalPersonalFilingsMcpHeader(headerValue, now);
  }
  const token = personalBearerToken(headerValue);
  if (!token) throw new PersonalFilingsMcpAuthError();

  try {
    const context = await authenticate(token);
    if (!context) throw new PersonalFilingsMcpAuthError();
    return context;
  } catch (error) {
    if (error instanceof PersonalFilingsMcpAuthError) throw error;
    throw new PersonalFilingsMcpAuthError();
  }
}

export function createInternalPersonalFilingsMcpHeader(
  userId: string,
  now = Date.now(),
  ttlSeconds = DEFAULT_INTERNAL_TTL_SECONDS,
): string {
  if (!isUuid(userId)) throw new PersonalFilingsMcpAuthError();
  const secret = internalSecret();
  if (!secret) throw new PersonalFilingsMcpAuthError();
  if (
    !Number.isInteger(ttlSeconds)
    || ttlSeconds < 60
    || ttlSeconds > MAX_INTERNAL_TTL_SECONDS
  ) {
    throw new PersonalFilingsMcpAuthError();
  }
  const issuedAt = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: userId.toLowerCase(),
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    aud: INTERNAL_AUDIENCE,
    iss: INTERNAL_ISSUER,
    ver: INTERNAL_TOKEN_VERSION,
  }), "utf8").toString("base64url");
  return `Internal ${payload}.${signature(payload, secret)}`;
}

function verifyInternalPersonalFilingsMcpHeader(
  value: string,
  now: number,
): PersonalFilingsMcpAuthContext {
  if (value.length > 512) throw new PersonalFilingsMcpAuthError();
  const match = value.match(/^Internal ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  const payload = match?.[1];
  const suppliedSignature = match?.[2];
  const secret = internalSecret();
  if (!payload || !suppliedSignature || !secret) throw new PersonalFilingsMcpAuthError();
  const expectedSignature = signature(payload, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new PersonalFilingsMcpAuthError();
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: unknown;
      iat?: unknown;
      exp?: unknown;
      aud?: unknown;
      iss?: unknown;
      ver?: unknown;
    };
    const nowSeconds = Math.floor(now / 1000);
    if (
      typeof decoded.sub !== "string" ||
      !isUuid(decoded.sub) ||
      typeof decoded.iat !== "number" ||
      !Number.isInteger(decoded.iat) ||
      typeof decoded.exp !== "number" ||
      !Number.isInteger(decoded.exp) ||
      decoded.aud !== INTERNAL_AUDIENCE ||
      decoded.iss !== INTERNAL_ISSUER ||
      decoded.ver !== INTERNAL_TOKEN_VERSION ||
      decoded.iat > nowSeconds + CLOCK_SKEW_SECONDS ||
      decoded.exp < nowSeconds ||
      decoded.exp <= decoded.iat ||
      decoded.exp - decoded.iat > MAX_INTERNAL_TTL_SECONDS
    ) {
      throw new PersonalFilingsMcpAuthError();
    }
    return {
      userId: decoded.sub.toLowerCase(),
      userEmail: null,
      deviceId: null,
      authMethod: "internal_web_session",
    };
  } catch (error) {
    if (error instanceof PersonalFilingsMcpAuthError) throw error;
    throw new PersonalFilingsMcpAuthError();
  }
}

function internalSecret(): string | null {
  return process.env.FILINGS_MCP_PERSONAL_SIGNING_SECRET?.trim() || null;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function personalBearerToken(value: string | string[]): string | null {
  if (Array.isArray(value)) return null;
  if (value.length > 512) return null;
  const match = value.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  const token = match?.[1] ?? "";
  return token.startsWith("krw_dt_") && token.length >= 24 ? token : null;
}
