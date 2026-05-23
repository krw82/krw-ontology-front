import { getAuthUser, handleAuthError } from "@/lib/auth";
import { getEntitlementStatus } from "@/lib/billing/entitlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }

  if (!user) return handleAuthError(new Error("No user"));

  try {
    const entitlement = await getEntitlementStatus(user.id, user.email ?? null);
    return Response.json({ entitlement });
  } catch {
    return Response.json(
      {
        error: {
          code: "internal_error" as const,
          message: "사용량 정보를 불러오지 못했습니다.",
        },
      },
      { status: 500 },
    );
  }
}
