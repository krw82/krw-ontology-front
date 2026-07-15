import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { invalidOriginResponse, isExpectedMutationOrigin } from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { UserFilingFeedTokenRow } from "@/types/database";

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
  const { data, error } = await getSupabaseAdmin().from("user_filing_feed_tokens").select("*")
    .eq("user_id", user.id).is("revoked_at", null).maybeSingle<UserFilingFeedTokenRow>();
  if (error) return Response.json({ error: { code: "service_unavailable", message: "개인 피드 상태를 불러오지 못했습니다." } }, { status: 503 });
  return Response.json({ active: Boolean(data), created_at: data?.created_at ?? null, last_used_at: data?.last_used_at ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const admin = getSupabaseAdmin();
  const { error: revokeError } = await admin.from("user_filing_feed_tokens").update({ revoked_at: new Date().toISOString() })
    .eq("user_id", user.id).is("revoked_at", null);
  if (revokeError) return Response.json({ error: { code: "service_unavailable", message: "기존 개인 피드를 폐기하지 못했습니다." } }, { status: 503 });
  const { error: insertError } = await admin.from("user_filing_feed_tokens").insert({ user_id: user.id, token_hash: tokenHash });
  if (insertError) return Response.json({ error: { code: "service_unavailable", message: "개인 피드를 만들지 못했습니다." } }, { status: 503 });
  return Response.json({ token }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(request: NextRequest) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));
  const { error } = await getSupabaseAdmin().from("user_filing_feed_tokens").update({ revoked_at: new Date().toISOString() })
    .eq("user_id", user.id).is("revoked_at", null);
  if (error) return Response.json({ error: { code: "service_unavailable", message: "개인 피드를 폐기하지 못했습니다." } }, { status: 503 });
  return Response.json({ ok: true });
}
