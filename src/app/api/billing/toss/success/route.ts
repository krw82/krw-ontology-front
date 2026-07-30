import { NextResponse, type NextRequest } from "next/server";
import { getConfiguredBillingRedirectOrigin } from "@/lib/auth/origin";
import {
  completeTossBillingOperationCallback,
  getTossBillingOperationIdForCallback,
} from "@/lib/billing/toss-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function billingRedirectOrigin(request: NextRequest): string | null {
  return getConfiguredBillingRedirectOrigin(request.nextUrl.origin);
}

function redirectOriginNotConfigured() {
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

function redirectToBilling(origin: string, operationId?: string | null) {
  const url = new URL("/settings/billing", origin);
  if (operationId) url.searchParams.set("operation", operationId);
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function callbackOperationId({
  sessionId,
  callbackToken,
}: {
  sessionId: string | null;
  callbackToken: string | null;
}): Promise<string | null> {
  if (!sessionId || !callbackToken) return null;
  try {
    return await getTossBillingOperationIdForCallback({
      sessionId,
      callbackToken,
    });
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const origin = billingRedirectOrigin(request);
  if (!origin) return redirectOriginNotConfigured();
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  const authKey = request.nextUrl.searchParams.get("authKey");
  const customerKey = request.nextUrl.searchParams.get("customerKey");
  const callbackToken = request.nextUrl.searchParams.get("callbackToken");

  if (!sessionId || !callbackToken || !authKey || !customerKey) {
    return redirectToBilling(origin);
  }

  try {
    const result = await completeTossBillingOperationCallback({
      sessionId,
      callbackToken,
      authKey,
      customerKey,
    });
    return redirectToBilling(origin, result.operationId);
  } catch {
    return redirectToBilling(
      origin,
      await callbackOperationId({ sessionId, callbackToken }),
    );
  }
}
