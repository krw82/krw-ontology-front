import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import { decideDesktopAuthorizationRequest } from "@/lib/desktop/authorization";
import { DesktopAuthError } from "@/lib/desktop/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  try {
    const body = await request.json();
    if (typeof body.request_id !== "string" || !body.request_id.trim()) {
      throw new DesktopAuthError("request_id is required", {
        publicMessage: "Desktop 로그인 요청 식별자가 필요합니다.",
        status: 400,
      });
    }
    if (body.decision !== "approve" && body.decision !== "deny") {
      throw new DesktopAuthError("decision must be approve or deny", {
        publicMessage: "Desktop 로그인 승인 여부가 올바르지 않습니다.",
        status: 400,
      });
    }

    const response = await decideDesktopAuthorizationRequest({
      requestId: body.request_id.trim(),
      userId: user.id,
      approved: body.decision === "approve",
    });
    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleDesktopApiError(error);
  }
}
