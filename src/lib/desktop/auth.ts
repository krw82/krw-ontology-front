import "server-only";

import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { EntitlementStatus } from "@/types/entitlement";
import { DesktopAuthError, type DesktopAuthContext } from "./auth-context";
import { authenticateDesktopAccessToken } from "./device-auth";

export { DesktopAuthError, type DesktopAuthContext } from "./auth-context";

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
    if (!isDesktopDevTokenAllowed(request)) {
      throw new DesktopAuthError("Desktop dev token is disabled for this request", {
        publicMessage: "KRW Desktop 로그인이 필요합니다.",
        status: 401,
      });
    }
    return {
      userId: process.env.KRW_DESKTOP_DEV_USER_ID ?? "desktop-dev-user",
      userEmail: process.env.KRW_DESKTOP_DEV_USER_EMAIL ?? "desktop-dev@example.test",
      deviceId: request.headers.get("x-krw-device-id") ?? "desktop-dev-device",
      authMethod: "dev_token",
    };
  }

  const desktopAuth = await authenticateDesktopAccessToken(token);
  if (desktopAuth) return desktopAuth;

  throw new DesktopAuthError("Invalid desktop bearer token", {
    publicMessage: "KRW Desktop 로그인이 만료되었습니다. 다시 로그인해주세요.",
    status: 401,
  });
}

export async function requireDesktopEntitlement(
  auth: DesktopAuthContext,
): Promise<EntitlementStatus> {
  return requireDesktopRunEntitlement(auth);
}

export async function getDesktopEntitlement(
  auth: DesktopAuthContext,
): Promise<EntitlementStatus> {
  return getEntitlementStatus(auth.userId, auth.userEmail, {
    supabase: getSupabaseAdmin(),
  });
}

export async function requireDesktopFeatureAccess(
  auth: DesktopAuthContext,
  featureKey: EntitlementStatus["features"][number]["key"] = "evidence_research",
): Promise<EntitlementStatus> {
  const entitlement = await getDesktopEntitlement(auth);
  const feature = entitlement.features.find(
    (candidate) => candidate.key === featureKey,
  );

  if (feature?.enabled === false) {
    throw new DesktopAuthError("Desktop feature access required", {
      code: "entitlement_required",
      publicMessage: "현재 플랜에서 사용할 수 없는 기능입니다.",
      status: 403,
    });
  }

  return entitlement;
}

export async function requireDesktopRunEntitlement(
  auth: DesktopAuthContext,
): Promise<EntitlementStatus> {
  const entitlement = await requireDesktopFeatureAccess(
    auth,
    "evidence_research",
  );

  if (!entitlement.usage.can_run) {
    throw new DesktopAuthError("Desktop entitlement required", {
      code: "entitlement_required",
      publicMessage: "새 분석을 시작할 수 있는 사용량이 부족합니다.",
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

function isDesktopDevTokenAllowed(request: Request): boolean {
  if (!isLocalRequest(request)) return false;
  if (process.env.NODE_ENV !== "production") return true;
  return isTruthyEnv(process.env.KRW_DESKTOP_DEV_TOKEN_ENABLED);
}

function isLocalRequest(request: Request): boolean {
  const hostHeader = request.headers.get("host");
  const candidates = [hostnameFromUrl(request.url), hostnameFromHost(hostHeader)];
  return candidates.some((hostname) => {
    if (!hostname) return false;
    const normalized = hostname.toLowerCase();
    return (
      normalized === "localhost" ||
      normalized === "127.0.0.1" ||
      normalized === "::1" ||
      normalized.endsWith(".localhost")
    );
  });
}

function hostnameFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

function hostnameFromHost(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end > 0 ? trimmed.slice(1, end) : null;
  }
  return trimmed.split(":")[0] || null;
}

function isTruthyEnv(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}
