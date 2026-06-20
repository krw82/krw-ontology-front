import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
  completeTossBillingCheckout,
  TossBillingFlowError,
} from "@/lib/billing/toss-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectToBilling(origin: string, params: Record<string, string>) {
  const url = new URL("/settings/billing", origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

function safeMessage(error: unknown): string {
  if (error instanceof TossBillingFlowError) return error.message;
  if (
    error instanceof Error &&
    error.message.includes("Missing required environment variable")
  ) {
    return "Toss Payments 환경변수가 설정되지 않았습니다.";
  }
  return "결제 처리 중 오류가 발생했습니다.";
}

function safeCode(error: unknown): string {
  if (error instanceof TossBillingFlowError) return error.code;
  if (
    error instanceof Error &&
    error.message.includes("Missing required environment variable")
  ) {
    return "billing_provider_not_configured";
  }
  return "billing_confirm_failed";
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  const authKey = request.nextUrl.searchParams.get("authKey");
  const customerKey = request.nextUrl.searchParams.get("customerKey");

  let user;
  try {
    user = await getAuthUser();
  } catch {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("next", "/settings/billing");
    return NextResponse.redirect(loginUrl);
  }
  if (!user) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("next", "/settings/billing");
    return NextResponse.redirect(loginUrl);
  }

  if (!sessionId || !authKey || !customerKey) {
    return redirectToBilling(origin, {
      billing_error: "missing_billing_auth",
      billing_message: "자동결제 인증 정보가 부족합니다.",
    });
  }

  try {
    await completeTossBillingCheckout({
      userId: user.id,
      sessionId,
      authKey,
      customerKey,
      userEmail: user.email ?? null,
      userName:
        typeof user.user_metadata?.name === "string"
          ? user.user_metadata.name
          : null,
    });
    return redirectToBilling(origin, { billing: "success" });
  } catch (error) {
    return redirectToBilling(origin, {
      billing_error: safeCode(error),
      billing_message: safeMessage(error),
    });
  }
}
