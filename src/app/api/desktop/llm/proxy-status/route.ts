import type { NextRequest } from "next/server";
import {
  authenticateDesktopRequest,
  requireDesktopFeatureAccess,
} from "@/lib/desktop/auth";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import {
  availableDesktopLlmModelProfiles,
  resolveDesktopLlmModelProfile,
} from "@/lib/desktop/llm-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateDesktopRequest(request);
    await requireDesktopFeatureAccess(auth, "evidence_research");
    const profile = resolveDesktopLlmModelProfile();
    const readiness = await resolveGatewayReadiness();

    return Response.json(
      {
        ok: true,
        ready: readiness.ready,
        message: readiness.message,
        gateway_health: readiness.gatewayHealth,
        provider: profile.provider,
        gateway_base_url: profile.gatewayBaseUrl,
        models: availableDesktopLlmModelProfiles(),
        job_token_ttl_seconds: profile.jobTokenTtlSeconds,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return handleDesktopApiError(error);
  }
}

async function resolveGatewayReadiness() {
  const secret = process.env.KRW_LLM_JOB_TOKEN_SECRET?.trim();
  if (!secret) {
    return {
      ready: false,
      message: "LLM gateway job token secret is not configured",
      gatewayHealth: null,
    };
  }
  if (secret.length < 32) {
    return {
      ready: false,
      message: "LLM gateway job token secret must be at least 32 characters",
      gatewayHealth: null,
    };
  }

  const healthUrl = process.env.DESKTOP_LLM_GATEWAY_HEALTH_URL?.trim();
  if (healthUrl) {
    return checkGatewayHealth(healthUrl);
  }

  return {
    ready: true,
    message: "LLM gateway configured",
    gatewayHealth: null,
  };
}

async function checkGatewayHealth(healthUrl: string) {
  try {
    const response = await fetch(healthUrl, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(readHealthTimeoutMs()),
    });
    const payload = await response.json().catch(() => null);
    const ok = response.ok && payload?.ok !== false;
    return {
      ready: ok,
      message: ok
        ? "LLM gateway health check passed"
        : "LLM gateway health check failed",
      gatewayHealth: {
        url: healthUrl,
        status: response.status,
        service: payload?.service ?? null,
      },
    };
  } catch (error) {
    return {
      ready: false,
      message:
        error instanceof Error
          ? `LLM gateway health check failed: ${error.message}`
          : "LLM gateway health check failed",
      gatewayHealth: {
        url: healthUrl,
        status: null,
        service: null,
      },
    };
  }
}

function readHealthTimeoutMs() {
  const parsed = Number(process.env.DESKTOP_LLM_GATEWAY_HEALTH_TIMEOUT_MS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5_000;
}
