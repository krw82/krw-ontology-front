import { getAuthUser, handleAuthError } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const now = new Date().toISOString();
  const { count, error } = await getSupabaseAdmin()
    .from("user_filing_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null)
    .is("archived_at", null)
    .or(`snoozed_until.is.null,snoozed_until.lte.${now}`);

  if (error) {
    return Response.json(
      {
        error: {
          code: "service_unavailable",
          message: "공시 미확인 건수를 불러오지 못했습니다.",
        },
      },
      { status: 503 },
    );
  }

  return Response.json(
    { unread_count: count ?? 0 },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
