import { NextResponse, type NextRequest } from "next/server";
import { getConfiguredBillingRedirectOrigin } from "@/lib/auth/origin";
import { markTossBillingOperationCallbackFailed } from "@/lib/billing/toss-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = getConfiguredBillingRedirectOrigin(request.nextUrl.origin);
  if (!origin) {
    return NextResponse.json(
      {
        error: {
          code: "billing_redirect_origin_not_configured",
          message: "결제 리다이렉트 주소가 설정되지 않았습니다.",
        },
      },
      { status: 503 },
    );
  }
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  const callbackToken = request.nextUrl.searchParams.get("callbackToken");
  const code =
    request.nextUrl.searchParams.get("code") ?? "billing_auth_failed";
  let operationId: string | null = null;

  try {
    if (sessionId && callbackToken) {
      operationId = await markTossBillingOperationCallbackFailed({
        sessionId,
        callbackToken,
        code,
      });
    }
  } catch {
    // Never put provider messages or callback values back into a browser URL.
  }

  const url = new URL("/settings/billing", origin);
  if (operationId) url.searchParams.set("operation", operationId);
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
