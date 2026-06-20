import type { NextRequest } from "next/server";
import { authenticateDesktopRequest } from "@/lib/desktop/auth";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import {
  finalizeDesktopLlmJob,
  validateFinalizeDesktopLlmJobInput,
} from "@/lib/desktop/llm-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const auth = await authenticateDesktopRequest(request);
    const { jobId } = await context.params;
    const input = validateFinalizeDesktopLlmJobInput(await request.json());
    const result = await finalizeDesktopLlmJob(auth, jobId, input);
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleDesktopApiError(error);
  }
}
