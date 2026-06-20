import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  DesktopAccessTokenRow,
  DesktopDeviceLoginCodeRow,
  DesktopDeviceRow,
} from "@/types/database";
import { DesktopAuthError, type DesktopAuthContext } from "./auth";

const DEVICE_CODE_BYTES = 32;
const TOKEN_BYTES = 32;
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface StartDesktopDeviceLoginInput {
  deviceName: string;
  installationId?: string | null;
  platform?: string | null;
  arch?: string | null;
  appVersion?: string | null;
  protocolVersion: string;
  now?: Date;
}

export interface DesktopTokenPair {
  desktop_access_token: string;
  desktop_refresh_token: string;
  expires_at: string;
  refresh_expires_at: string;
}

export interface PollDesktopDeviceLoginResult {
  ok: true;
  status: "pending" | "denied" | "expired" | "complete";
  poll_interval_ms?: number;
  account?: {
    user_id: string;
    email: string | null;
  };
  device?: {
    id: string;
    name: string;
    status: string;
  };
  tokens?: DesktopTokenPair;
}

export async function startDesktopDeviceLogin(
  input: StartDesktopDeviceLoginInput,
) {
  const now = input.now ?? new Date();
  const deviceCode = randomSecret(DEVICE_CODE_BYTES);
  const userCode = randomUserCode();
  const expiresAt = new Date(now.getTime() + DEVICE_CODE_TTL_MS).toISOString();

  const { data, error } = await getSupabaseAdmin()
    .from("desktop_device_login_codes")
    .insert({
      device_code_hash: tokenHash(deviceCode),
      user_code_hash: tokenHash(normalizeUserCode(userCode)),
      user_code_display: userCode,
      device_name: boundedText(input.deviceName, "KRW Desktop"),
      installation_id: nullableBoundedText(input.installationId),
      platform: nullableBoundedText(input.platform),
      arch: nullableBoundedText(input.arch),
      app_version: nullableBoundedText(input.appVersion),
      protocol_version: boundedText(input.protocolVersion, "desktop/v1"),
      expires_at: expiresAt,
    })
    .select(
      "id, device_code_hash, user_code_hash, user_code_display, device_name, installation_id, platform, arch, app_version, protocol_version, status, user_id, device_id, expires_at, approved_at, consumed_at, created_at, updated_at",
    )
    .single<DesktopDeviceLoginCodeRow>();

  if (error || !data) {
    throw new DesktopAuthError("Failed to create desktop device login code", {
      publicMessage: "Desktop 로그인 코드를 만들지 못했습니다.",
      status: 500,
      retryable: true,
    });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://krwontology.com";
  const loginUrl = `${appUrl.replace(/\/+$/, "")}/login?desktop_code=${encodeURIComponent(
    userCode,
  )}`;

  return {
    ok: true,
    device_code: deviceCode,
    user_code: userCode,
    login_url: loginUrl,
    verification_uri: loginUrl,
    expires_at: data.expires_at,
    poll_interval_ms: 2_000,
  };
}

export async function pollDesktopDeviceLogin(
  deviceCode: string,
  now = new Date(),
): Promise<PollDesktopDeviceLoginResult> {
  const row = await loadLoginCodeByDeviceCode(deviceCode);
  if (!row) {
    throw new DesktopAuthError("Invalid desktop device code", {
      publicMessage: "Desktop 로그인 코드가 올바르지 않습니다.",
      status: 400,
    });
  }

  if (row.status === "denied") return { ok: true, status: "denied" };
  if (row.status === "expired" || Date.parse(row.expires_at) <= now.getTime()) {
    await markLoginCode(row.id, "expired", now);
    return { ok: true, status: "expired" };
  }
  if (row.status === "pending") {
    return { ok: true, status: "pending", poll_interval_ms: 2_000 };
  }
  if (row.status === "complete") {
    return { ok: true, status: "complete" };
  }
  if (!row.user_id) {
    throw new DesktopAuthError("Approved desktop code has no user", {
      publicMessage: "Desktop 로그인 승인 상태가 올바르지 않습니다.",
      status: 500,
    });
  }

  const tokens = createDesktopTokenPair(now);
  const { data, error } = await getSupabaseAdmin().rpc(
    "complete_desktop_device_login",
    {
      p_device_code_hash: tokenHash(deviceCode),
      p_new_access_token_hash: tokenHash(tokens.desktop_access_token),
      p_new_access_expires_at: tokens.expires_at,
      p_new_refresh_token_hash: tokenHash(tokens.desktop_refresh_token),
      p_new_refresh_expires_at: tokens.refresh_expires_at,
      p_now: now.toISOString(),
    },
  );
  if (error) {
    throw new DesktopAuthError("Failed to complete desktop login", {
      publicMessage: "Desktop 로그인을 완료하지 못했습니다.",
      status: 500,
      retryable: true,
    });
  }

  const completion = data?.[0];
  if (
    !completion?.completed ||
    !completion.user_id ||
    !completion.device_id ||
    !completion.device_name ||
    !completion.device_status
  ) {
    return { ok: true, status: "complete" };
  }
  const userEmail = await loadDesktopUserEmail(completion.user_id);

  return {
    ok: true,
    status: "complete",
    account: {
      user_id: completion.user_id,
      email: userEmail,
    },
    device: {
      id: completion.device_id,
      name: completion.device_name,
      status: completion.device_status,
    },
    tokens,
  };
}

export async function approveDesktopDeviceLoginCode(input: {
  userCode: string;
  userId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const normalizedCode = normalizeUserCode(input.userCode);
  const { data, error } = await getSupabaseAdmin()
    .from("desktop_device_login_codes")
    .select(
      "id, device_code_hash, user_code_hash, user_code_display, device_name, installation_id, platform, arch, app_version, protocol_version, status, user_id, device_id, expires_at, approved_at, consumed_at, created_at, updated_at",
    )
    .eq("user_code_hash", tokenHash(normalizedCode))
    .maybeSingle<DesktopDeviceLoginCodeRow>();

  if (error || !data) {
    throw new DesktopAuthError("Desktop login code not found", {
      publicMessage: "Desktop 로그인 코드를 찾지 못했습니다.",
      status: 404,
    });
  }
  if (data.status !== "pending" || Date.parse(data.expires_at) <= now.getTime()) {
    throw new DesktopAuthError("Desktop login code is not pending", {
      publicMessage: "Desktop 로그인 코드가 만료되었거나 이미 사용되었습니다.",
      status: 400,
    });
  }

  const { data: approved, error: updateError } = await getSupabaseAdmin()
    .from("desktop_device_login_codes")
    .update({
      status: "approved",
      user_id: input.userId,
      approved_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", data.id)
    .eq("status", "pending")
    .is("user_id", null)
    .select("id")
    .maybeSingle<Pick<DesktopDeviceLoginCodeRow, "id">>();

  if (updateError || !approved) {
    throw new DesktopAuthError("Failed to approve desktop login code", {
      publicMessage: updateError
        ? "Desktop 로그인 승인을 저장하지 못했습니다."
        : "Desktop 로그인 코드가 이미 사용되었습니다.",
      status: updateError ? 500 : 400,
      retryable: Boolean(updateError),
    });
  }

  return { ok: true };
}

export async function refreshDesktopTokens(input: {
  deviceId: string;
  refreshToken: string;
  now?: Date;
}): Promise<DesktopTokenPair> {
  const now = input.now ?? new Date();
  const tokens = createDesktopTokenPair(now);
  const { data, error } = await getSupabaseAdmin().rpc(
    "rotate_desktop_refresh_token",
    {
      p_device_id: input.deviceId,
      p_current_token_hash: tokenHash(input.refreshToken),
      p_new_access_token_hash: tokenHash(tokens.desktop_access_token),
      p_new_access_expires_at: tokens.expires_at,
      p_new_refresh_token_hash: tokenHash(tokens.desktop_refresh_token),
      p_new_refresh_expires_at: tokens.refresh_expires_at,
      p_now: now.toISOString(),
    },
  );

  if (error) {
    throw new DesktopAuthError("Failed to rotate desktop refresh token", {
      publicMessage: "Desktop 토큰을 갱신하지 못했습니다.",
      status: 500,
      retryable: true,
    });
  }
  if (!data?.[0]?.rotated) {
    throw new DesktopAuthError("Invalid desktop refresh token", {
      publicMessage: "Desktop 로그인이 만료되었습니다. 다시 로그인해주세요.",
      status: 401,
    });
  }

  return tokens;
}

export async function authenticateDesktopAccessToken(
  token: string,
  now = new Date(),
): Promise<DesktopAuthContext | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("desktop_access_tokens")
    .select(
      "id, device_id, user_id, token_hash, status, expires_at, last_used_at, created_at, revoked_at",
    )
    .eq("token_hash", tokenHash(token))
    .maybeSingle<DesktopAccessTokenRow>();

  if (error || !data) return null;
  if (data.status !== "active") {
    throw new DesktopAuthError("Desktop access token is not active", {
      publicMessage: "Desktop 로그인이 만료되었습니다. 다시 로그인해주세요.",
      status: 401,
    });
  }
  if (Date.parse(data.expires_at) <= now.getTime()) {
    await expireAccessToken(data.id, now);
    throw new DesktopAuthError("Desktop access token expired", {
      publicMessage: "Desktop 로그인이 만료되었습니다. 다시 로그인해주세요.",
      status: 401,
    });
  }

  const device = await loadActiveDevice(data.device_id, data.user_id);
  if (!device) {
    throw new DesktopAuthError("Desktop device is revoked", {
      publicMessage: "이 Desktop 기기의 로그인이 해제되었습니다.",
      status: 401,
    });
  }

  await Promise.all([
    getSupabaseAdmin()
      .from("desktop_access_tokens")
      .update({ last_used_at: now.toISOString() })
      .eq("id", data.id),
    getSupabaseAdmin()
      .from("desktop_devices")
      .update({ last_seen_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("id", device.id),
  ]);
  const userEmail = await loadDesktopUserEmail(data.user_id);

  return {
    userId: data.user_id,
    userEmail,
    deviceId: device.id,
    authMethod: "desktop_access_token",
  };
}

export async function revokeDesktopDevice(input: {
  auth: DesktopAuthContext;
  deviceId?: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const deviceId = input.deviceId ?? input.auth.deviceId;
  if (!deviceId) return { ok: true };

  await getSupabaseAdmin()
    .from("desktop_devices")
    .update({
      status: "revoked",
      revoked_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", deviceId)
    .eq("user_id", input.auth.userId);

  await Promise.all([
    getSupabaseAdmin()
      .from("desktop_access_tokens")
      .update({ status: "revoked", revoked_at: now.toISOString() })
      .eq("device_id", deviceId)
      .eq("user_id", input.auth.userId),
    getSupabaseAdmin()
      .from("desktop_refresh_tokens")
      .update({ status: "revoked", revoked_at: now.toISOString() })
      .eq("device_id", deviceId)
      .eq("user_id", input.auth.userId),
  ]);

  return { ok: true };
}

async function loadLoginCodeByDeviceCode(deviceCode: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("desktop_device_login_codes")
    .select(
      "id, device_code_hash, user_code_hash, user_code_display, device_name, installation_id, platform, arch, app_version, protocol_version, status, user_id, device_id, expires_at, approved_at, consumed_at, created_at, updated_at",
    )
    .eq("device_code_hash", tokenHash(deviceCode))
    .maybeSingle<DesktopDeviceLoginCodeRow>();

  if (error) {
    throw new DesktopAuthError("Failed to load desktop device login code", {
      publicMessage: "Desktop 로그인 상태를 확인하지 못했습니다.",
      status: 500,
      retryable: true,
    });
  }
  return data ?? null;
}

async function loadActiveDevice(deviceId: string, userId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("desktop_devices")
    .select(
      "id, user_id, device_name, installation_id, platform, arch, app_version, protocol_version, status, last_seen_at, revoked_at, created_at, updated_at",
    )
    .eq("id", deviceId)
    .eq("user_id", userId)
    .maybeSingle<DesktopDeviceRow>();

  if (error) {
    throw new DesktopAuthError("Failed to load desktop device", {
      publicMessage: "Desktop 기기 상태를 확인하지 못했습니다.",
      status: 500,
      retryable: true,
    });
  }
  return data?.status === "active" ? data : null;
}

async function markLoginCode(
  id: string,
  status: DesktopDeviceLoginCodeRow["status"],
  now: Date,
) {
  await getSupabaseAdmin()
    .from("desktop_device_login_codes")
    .update({ status, updated_at: now.toISOString() })
    .eq("id", id);
}

async function expireAccessToken(id: string, now: Date) {
  await getSupabaseAdmin()
    .from("desktop_access_tokens")
    .update({
      status: "expired",
      revoked_at: now.toISOString(),
    })
    .eq("id", id);
}

async function loadDesktopUserEmail(userId: string): Promise<string | null> {
  try {
    const admin = getSupabaseAdmin();
    const getUserById = admin.auth?.admin?.getUserById;
    if (typeof getUserById !== "function") return null;
    const { data, error } = await getUserById.call(admin.auth.admin, userId);
    if (error) return null;
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

function createDesktopTokenPair(now: Date): DesktopTokenPair {
  return {
    desktop_access_token: `krw_dt_${randomSecret(TOKEN_BYTES)}`,
    desktop_refresh_token: `krw_dr_${randomSecret(TOKEN_BYTES)}`,
    expires_at: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString(),
    refresh_expires_at: new Date(
      now.getTime() + REFRESH_TOKEN_TTL_MS,
    ).toISOString(),
  };
}

function randomSecret(bytes: number) {
  return randomBytes(bytes).toString("base64url");
}

function randomUserCode() {
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    const byte = randomBytes(1)[0];
    code += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeUserCode(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function boundedText(value: string | null | undefined, fallback: string) {
  const text = value?.trim() || fallback;
  return text.slice(0, 160);
}

function nullableBoundedText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text.slice(0, 80) : null;
}
