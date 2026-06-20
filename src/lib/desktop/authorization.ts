import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { DesktopAuthorizationRequestRow } from "@/types/database";
import { DesktopAuthError } from "./auth";
import { tokenHash } from "./device-auth";

const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;
const DEFAULT_CLIENT_ID = "krw-desktop-macos";
const DEFAULT_REDIRECT_URI = "com.krw.desktop:/oauth/callback";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const STATE_PATTERN = /^[A-Za-z0-9._~-]{32,200}$/;

export interface StartDesktopAuthorizationInput {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  installationId: string;
  deviceName: string;
  platform: string | null;
  arch: string | null;
  appVersion: string | null;
  protocolVersion: string;
}

export interface ExchangeDesktopAuthorizationInput {
  clientId: string;
  redirectUri: string;
  authorizationCode: string;
  codeVerifier: string;
}

export async function startDesktopAuthorization(
  input: StartDesktopAuthorizationInput,
  requestOrigin: string,
  now = new Date(),
) {
  validateClient(input.clientId, input.redirectUri);
  if (
    input.codeChallengeMethod !== "S256" ||
    !CODE_CHALLENGE_PATTERN.test(input.codeChallenge)
  ) {
    throw invalidAuthorization(
      "PKCE S256 code challenge is required",
      "Desktop 인증 요청이 올바르지 않습니다.",
    );
  }
  if (!STATE_PATTERN.test(input.state)) {
    throw invalidAuthorization(
      "Invalid authorization state",
      "Desktop 인증 state가 올바르지 않습니다.",
    );
  }
  if (!UUID_PATTERN.test(input.installationId)) {
    throw invalidAuthorization(
      "Invalid installation_id",
      "Desktop 설치 식별자가 올바르지 않습니다.",
    );
  }
  if (input.protocolVersion !== "desktop/v1") {
    throw invalidAuthorization(
      "Unsupported Desktop protocol version",
      "지원하지 않는 KRW Desktop 버전입니다. 앱을 업데이트해주세요.",
    );
  }

  const expiresAt = new Date(now.getTime() + AUTHORIZATION_TTL_MS).toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("desktop_authorization_requests")
    .insert({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
      installation_id: input.installationId,
      device_name: boundedText(input.deviceName, "KRW Desktop", 120),
      platform: nullableBoundedText(input.platform, 40),
      arch: nullableBoundedText(input.arch, 40),
      app_version: nullableBoundedText(input.appVersion, 40),
      protocol_version: boundedText(
        input.protocolVersion,
        "desktop/v1",
        40,
      ),
      expires_at: expiresAt,
    })
    .select(
      "id, client_id, redirect_uri, state, code_challenge, code_challenge_method, installation_id, device_name, platform, arch, app_version, protocol_version, status, user_id, device_id, authorization_code_hash, expires_at, approved_at, consumed_at, created_at, updated_at",
    )
    .single<DesktopAuthorizationRequestRow>();

  if (error || !data) {
    throw new DesktopAuthError("Failed to create Desktop authorization request", {
      publicMessage: "Desktop 로그인 요청을 만들지 못했습니다.",
      status: 500,
      retryable: true,
    });
  }

  const appOrigin =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ||
    requestOrigin.replace(/\/+$/, "");
  const authorizationUrl = new URL("/desktop/connect", appOrigin);
  authorizationUrl.searchParams.set("request", data.id);

  return {
    ok: true as const,
    request_id: data.id,
    authorization_url: authorizationUrl.toString(),
    expires_at: data.expires_at,
    callback_scheme: new URL(data.redirect_uri).protocol.replace(/:$/, ""),
  };
}

export async function getDesktopAuthorizationRequestForWeb(
  requestId: string,
  now = new Date(),
) {
  if (!UUID_PATTERN.test(requestId)) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("desktop_authorization_requests")
    .select(
      "id, client_id, redirect_uri, state, code_challenge, code_challenge_method, installation_id, device_name, platform, arch, app_version, protocol_version, status, user_id, device_id, authorization_code_hash, expires_at, approved_at, consumed_at, created_at, updated_at",
    )
    .eq("id", requestId)
    .maybeSingle<DesktopAuthorizationRequestRow>();
  if (error || !data) return null;

  if (data.status === "pending" && Date.parse(data.expires_at) <= now.getTime()) {
    await getSupabaseAdmin()
      .from("desktop_authorization_requests")
      .update({ status: "expired", updated_at: now.toISOString() })
      .eq("id", data.id)
      .eq("status", "pending");
    return { ...data, status: "expired" as const };
  }
  return data;
}

export async function decideDesktopAuthorizationRequest(input: {
  requestId: string;
  userId: string;
  approved: boolean;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const request = await getDesktopAuthorizationRequestForWeb(
    input.requestId,
    now,
  );
  if (
    !request ||
    request.status !== "pending" ||
    Date.parse(request.expires_at) <= now.getTime()
  ) {
    throw invalidAuthorization(
      "Desktop authorization request is not pending",
      "Desktop 로그인 요청이 만료되었거나 이미 처리되었습니다.",
    );
  }

  const authorizationCode = input.approved
    ? `krw_ac_${randomBytes(TOKEN_BYTES).toString("base64url")}`
    : null;
  const nextStatus = input.approved ? "approved" : "denied";
  const { data, error } = await getSupabaseAdmin()
    .from("desktop_authorization_requests")
    .update({
      status: nextStatus,
      user_id: input.userId,
      authorization_code_hash: authorizationCode
        ? tokenHash(authorizationCode)
        : null,
      approved_at: input.approved ? now.toISOString() : null,
      updated_at: now.toISOString(),
    })
    .eq("id", request.id)
    .eq("status", "pending")
    .is("user_id", null)
    .select(
      "id, client_id, redirect_uri, state, code_challenge, code_challenge_method, installation_id, device_name, platform, arch, app_version, protocol_version, status, user_id, device_id, authorization_code_hash, expires_at, approved_at, consumed_at, created_at, updated_at",
    )
    .maybeSingle<DesktopAuthorizationRequestRow>();
  if (error || !data) {
    throw invalidAuthorization(
      "Failed to claim Desktop authorization request",
      error
        ? "Desktop 로그인 승인을 저장하지 못했습니다."
        : "Desktop 로그인 요청이 이미 처리되었습니다.",
      error ? 500 : 400,
      Boolean(error),
    );
  }

  const redirect = new URL(data.redirect_uri);
  redirect.searchParams.set("state", data.state);
  if (authorizationCode) {
    redirect.searchParams.set("code", authorizationCode);
  } else {
    redirect.searchParams.set("error", "access_denied");
  }

  return {
    ok: true as const,
    status: data.status,
    redirect_uri: redirect.toString(),
  };
}

export async function exchangeDesktopAuthorizationCode(
  input: ExchangeDesktopAuthorizationInput,
  now = new Date(),
) {
  validateClient(input.clientId, input.redirectUri);
  if (!input.authorizationCode.startsWith("krw_ac_")) {
    throw invalidAuthorization(
      "Invalid Desktop authorization code",
      "Desktop 인증 코드가 올바르지 않습니다.",
    );
  }
  if (!CODE_VERIFIER_PATTERN.test(input.codeVerifier)) {
    throw invalidAuthorization(
      "Invalid PKCE code verifier",
      "Desktop 인증 verifier가 올바르지 않습니다.",
    );
  }

  const codeChallenge = createHash("sha256")
    .update(input.codeVerifier)
    .digest("base64url");
  const tokens = createDesktopTokenPair(now);
  const { data, error } = await getSupabaseAdmin().rpc(
    "exchange_desktop_authorization_code",
    {
      p_authorization_code_hash: tokenHash(input.authorizationCode),
      p_client_id: input.clientId,
      p_redirect_uri: input.redirectUri,
      p_code_challenge: codeChallenge,
      p_new_access_token_hash: tokenHash(tokens.desktop_access_token),
      p_new_access_expires_at: tokens.expires_at,
      p_new_refresh_token_hash: tokenHash(tokens.desktop_refresh_token),
      p_new_refresh_expires_at: tokens.refresh_expires_at,
      p_now: now.toISOString(),
    },
  );
  if (error) {
    throw new DesktopAuthError("Failed to exchange Desktop authorization code", {
      publicMessage: "Desktop 로그인을 완료하지 못했습니다.",
      status: 500,
      retryable: true,
    });
  }

  const exchange = data?.[0];
  if (
    !exchange?.exchanged ||
    !exchange.user_id ||
    !exchange.device_id ||
    !exchange.device_name ||
    !exchange.device_status
  ) {
    throw invalidAuthorization(
      "Desktop authorization code is invalid or already used",
      "Desktop 인증 코드가 만료되었거나 이미 사용되었습니다.",
      401,
    );
  }

  return {
    ok: true as const,
    account: {
      user_id: exchange.user_id,
      email: await loadDesktopUserEmail(exchange.user_id),
    },
    device: {
      id: exchange.device_id,
      name: exchange.device_name,
      status: exchange.device_status,
    },
    tokens,
  };
}

function validateClient(clientId: string, redirectUri: string) {
  const allowedClientId =
    process.env.DESKTOP_AUTH_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID;
  const allowedRedirectUri =
    process.env.DESKTOP_AUTH_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
  if (clientId !== allowedClientId || redirectUri !== allowedRedirectUri) {
    throw invalidAuthorization(
      "Desktop OAuth client or redirect URI is not allowed",
      "지원하지 않는 Desktop 로그인 요청입니다.",
    );
  }
}

function createDesktopTokenPair(now: Date) {
  return {
    desktop_access_token: `krw_dt_${randomBytes(TOKEN_BYTES).toString("base64url")}`,
    desktop_refresh_token: `krw_dr_${randomBytes(TOKEN_BYTES).toString("base64url")}`,
    expires_at: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString(),
    refresh_expires_at: new Date(
      now.getTime() + REFRESH_TOKEN_TTL_MS,
    ).toISOString(),
  };
}

async function loadDesktopUserEmail(userId: string): Promise<string | null> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error) return null;
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

function boundedText(value: string, fallback: string, max: number) {
  const text = value.trim() || fallback;
  return text.slice(0, max);
}

function nullableBoundedText(value: string | null, max: number) {
  if (!value?.trim()) return null;
  return value.trim().slice(0, max);
}

function invalidAuthorization(
  message: string,
  publicMessage: string,
  status = 400,
  retryable = false,
) {
  return new DesktopAuthError(message, {
    publicMessage,
    status,
    retryable,
  });
}
