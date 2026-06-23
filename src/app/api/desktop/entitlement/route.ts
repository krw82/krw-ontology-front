import type { NextRequest } from "next/server";
import {
  authenticateDesktopRequest,
  getDesktopEntitlement,
} from "@/lib/desktop/auth";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateDesktopRequest(request);
    const entitlement = await getDesktopEntitlement(auth);

    return Response.json({
      ok: true,
      entitlement,
    });
  } catch (error) {
    return handleDesktopApiError(error);
  }
}
