import "server-only";

import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { EntitlementStatus } from "@/types/entitlement";
import { authenticateDesktopAccessToken } from "./device-auth";
import type { DesktopErrorCode } from "./ontology-contracts";

export interface DesktopAuthContext {
  userId: string;
  userEmail: string | null;
  deviceId: string | null;
  authMethod: "desktop_access_token" | "supabase_bearer" | "dev_token";
}

export class DesktopAuthError extends Error {
  code: DesktopErrorCode;
  publicMessage: string;
  status: number;
  retryable: boolean;

  constructor(
    message: string,
    options: {
      code?: DesktopErrorCode;
      publicMessage?: string;
      status?: number;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "DesktopAuthError";
    this.code = options.code ?? "authentication_error";
    this.publicMessage = options.publicMessage ?? message;
    this.status = options.status ?? 401;
    this.retryable = Boolean(options.retryable);
  }
}

export async function authenticateDesktopRequest(
  request: Request,
): Promise<DesktopAuthContext> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) {
    throw new DesktopAuthError("Missing desktop bearer token", {
      publicMessage: "로그인이 필요합니다.",
      status: 401,
    });
  }

  const devToken = process.env.KRW_DESKTOP_DEV_TOKEN;
  if (devToken && token === devToken) {
    return {
      userId: process.env.KRW_DESKTOP_DEV_USER_ID ?? "desktop-dev-user",
      userEmail: process.env.KRW_DESKTOP_DEV_USER_EMAIL ?? "desktop-dev@example.test",
      deviceId: request.headers.get("x-krw-device-id") ?? "desktop-dev-device",
      authMethod: "dev_token",
    };
  }

  const desktopAuth = await authenticateDesktopAccessToken(token);
  if (desktopAuth) return desktopAuth;

  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user) {
    throw new DesktopAuthError("Invalid desktop bearer token", {
      publicMessage: "로그인이 만료되었습니다. 다시 로그인해주세요.",
      status: 401,
    });
  }

  return {
    userId: data.user.id,
    userEmail: data.user.email ?? null,
    deviceId: request.headers.get("x-krw-device-id"),
    authMethod: "supabase_bearer",
  };
}

export async function requireDesktopEntitlement(
  auth: DesktopAuthContext,
): Promise<EntitlementStatus> {
  const entitlement = await getEntitlementStatus(auth.userId, auth.userEmail);
  const evidenceResearch = entitlement.features.find(
    (feature) => feature.key === "evidence_research",
  );

  if (!entitlement.usage.can_run || evidenceResearch?.enabled === false) {
    throw new DesktopAuthError("Desktop entitlement required", {
      code: "entitlement_required",
      publicMessage: "KRW Desktop 사용 권한 또는 분석 크레딧이 부족합니다.",
      status: 403,
    });
  }

  return entitlement;
}

function bearerToken(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}
