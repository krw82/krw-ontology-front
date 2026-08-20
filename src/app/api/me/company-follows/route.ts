import { getAuthUser, handleAuthError } from "@/lib/auth";
import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { listUserCompanyFollows } from "@/lib/follow/company-follow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 관심 기업 목록(모든 플랜). 관심=알림 통일 이후 관심 마킹이 목록의
 * 원천이며, 무료 3개 제한 표시를 위해 active_limit을 함께 내린다.
 */
export async function GET() {
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  try {
    const [companies, entitlement] = await Promise.all([
      listUserCompanyFollows(user.id),
      getEntitlementStatus(user.id, user.email ?? null),
    ]);
    // coverage/repository.ts의 p_active_limit 산식과 동일하게 유지한다.
    const activeLimit = entitlement.plan.key === "free" ? 3 : null;
    return Response.json(
      { companies, active_limit: activeLimit },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return Response.json(
      {
        error: {
          code: "internal_error",
          message: "관심 기업 목록을 불러오지 못했습니다.",
        },
      },
      { status: 500 },
    );
  }
}
