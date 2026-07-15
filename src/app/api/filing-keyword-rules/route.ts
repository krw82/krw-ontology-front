import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { recordAnalyticsEvent } from "@/lib/analytics/server";
import { normalizeFilingTicker } from "@/lib/filing-notifications/company-identifiers";
import { invalidOriginResponse, isExpectedMutationOrigin } from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { UserFilingKeywordRuleRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_KEYWORD_RULES_PER_USER = 10;
const createSchema = z.object({
  phrase: z.string().trim().min(2).max(120),
  ticker: z.string().trim().max(12).optional().nullable(),
});

async function requireUser() {
  try {
    const user = await getAuthUser();
    if (!user) throw new Error("No user");
    return { user } as const;
  } catch (error) {
    return { response: handleAuthError(error) } as const;
  }
}

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { data, error } = await getSupabaseAdmin()
    .from("user_filing_keyword_rules")
    .select("*")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .returns<UserFilingKeywordRuleRow[]>();
  if (error) return Response.json({ error: { code: "service_unavailable", message: "키워드 규칙을 불러오지 못했습니다." } }, { status: 503 });
  return Response.json({ rules: data ?? [], limit: MAX_KEYWORD_RULES_PER_USER });
}

export async function POST(request: NextRequest) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: "validation_error", message: "키워드 규칙이 올바르지 않습니다." } }, { status: 400 });
  const ticker = parsed.data.ticker ? normalizeFilingTicker(parsed.data.ticker) : null;
  if (parsed.data.ticker && !ticker) return Response.json({ error: { code: "validation_error", message: "종목 코드가 올바르지 않습니다." } }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { count, error: countError } = await admin
    .from("user_filing_keyword_rules")
    .select("id", { count: "exact", head: true })
    .eq("user_id", auth.user.id)
    .eq("enabled", true);
  if (countError) return Response.json({ error: { code: "service_unavailable", message: "키워드 규칙을 확인하지 못했습니다." } }, { status: 503 });
  if ((count ?? 0) >= MAX_KEYWORD_RULES_PER_USER) return Response.json({ error: { code: "limit_reached", message: `키워드 규칙은 최대 ${MAX_KEYWORD_RULES_PER_USER}개까지 만들 수 있습니다.` } }, { status: 409 });

  const { data, error } = await admin
    .from("user_filing_keyword_rules")
    .insert({ user_id: auth.user.id, phrase: parsed.data.phrase, ticker })
    .select("*")
    .single<UserFilingKeywordRuleRow>();
  if (error || !data) {
    const message = error?.code === "23505" ? "같은 키워드 규칙이 이미 있습니다." : "키워드 규칙을 저장하지 못했습니다.";
    return Response.json({ error: { code: "service_unavailable", message } }, { status: error?.code === "23505" ? 409 : 503 });
  }
  await recordAnalyticsEvent({ eventName: "alert_rule_created", userId: auth.user.id, properties: { ticker, phrase_length: data.phrase.length } });
  return Response.json({ rule: data }, { status: 201 });
}
