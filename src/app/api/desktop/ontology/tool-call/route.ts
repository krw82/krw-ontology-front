import type { NextRequest } from "next/server";
import {
  authenticateDesktopRequest,
  requireDesktopEntitlement,
} from "@/lib/desktop/auth";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import { executeDesktopOntologyTool } from "@/lib/desktop/ontology-service";
import {
  checkDesktopOntologyRateLimit,
  createDesktopOntologyToolAuditStart,
  finishDesktopOntologyToolAuditFailure,
  finishDesktopOntologyToolAuditSuccess,
  withDesktopOntologyUsage,
} from "@/lib/desktop/ontology-usage";
import { validateDesktopOntologyToolCallRequest } from "@/lib/desktop/ontology-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateDesktopRequest(request);
    await requireDesktopEntitlement(auth);
    const body = await request.json();
    const toolCall = validateDesktopOntologyToolCallRequest(body);
    const rateLimit = await checkDesktopOntologyRateLimit(auth);
    if (!rateLimit.ok) return rateLimit.response;

    const audit = await createDesktopOntologyToolAuditStart(toolCall, auth);
    let response: Awaited<ReturnType<typeof executeDesktopOntologyTool>>;
    try {
      response = await executeDesktopOntologyTool(toolCall, auth);
    } catch (error) {
      await finishDesktopOntologyToolAuditFailure(audit, error);
      throw error;
    }

    const latencyMs = await finishDesktopOntologyToolAuditSuccess(audit, response);

    return Response.json(
      withDesktopOntologyUsage(response, audit, rateLimit, latencyMs),
    );
  } catch (error) {
    return handleDesktopApiError(error);
  }
}
