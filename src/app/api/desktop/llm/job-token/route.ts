import type { NextRequest } from "next/server";
import {
  authenticateDesktopRequest,
  requireDesktopEntitlement,
} from "@/lib/desktop/auth";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import {
  createDesktopLlmJob,
  validateCreateDesktopLlmJobInput,
} from "@/lib/desktop/llm-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateDesktopRequest(request);
    await requireDesktopEntitlement(auth);
    const input = validateCreateDesktopLlmJobInput(await request.json());
    const job = await createDesktopLlmJob(auth, input);

    return Response.json(job, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleDesktopApiError(error);
  }
}
