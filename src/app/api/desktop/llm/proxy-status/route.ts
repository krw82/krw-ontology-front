import type { NextRequest } from "next/server";
import {
  authenticateDesktopRequest,
  requireDesktopEntitlement,
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
    await requireDesktopEntitlement(auth);
    const profile = resolveDesktopLlmModelProfile();

    return Response.json(
      {
        ok: true,
        ready: isGatewayConfigured(),
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

function isGatewayConfigured() {
  return Boolean(process.env.KRW_LLM_JOB_TOKEN_SECRET?.trim());
}
