import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { markTossBillingCheckoutFailed } from "@/lib/billing/toss-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  const code =
    request.nextUrl.searchParams.get("code") ?? "billing_auth_failed";
  const message =
    request.nextUrl.searchParams.get("message") ??
    "자동결제 인증이 완료되지 않았습니다.";

  try {
    const user = await getAuthUser();
    if (user && sessionId) {
      await markTossBillingCheckoutFailed({
        userId: user.id,
        sessionId,
        code,
        message,
      });
    }
  } catch {
    // The redirect still carries Toss failure context even if local logging fails.
  }

  const url = new URL("/settings/billing", origin);
  url.searchParams.set("billing_error", code);
  url.searchParams.set("billing_message", message);
  return NextResponse.redirect(url);
}
