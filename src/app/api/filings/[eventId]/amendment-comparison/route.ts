import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { recordAnalyticsEvent } from "@/lib/analytics/server";
import { diffFilingText, findAmendedOriginal, originalFormType } from "@/lib/filing-notifications/amendment-comparison";
import { resolveFilingAccess } from "@/lib/filing-notifications/filing-access";
import { loadFilingDocuments } from "@/lib/filing-notifications/filing-documents";
import { fetchSecText } from "@/lib/filing-notifications/sec-client";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SecFilingEventRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));
  const { eventId } = await params;
  if (!z.string().uuid().safeParse(eventId).success) {
    return Response.json({ error: { code: "validation_error", message: "공시 식별자가 올바르지 않습니다." } }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: amendment, error: amendmentError } = await admin
    .from("sec_filing_events").select("*").eq("id", eventId).maybeSingle<SecFilingEventRow>();
  if (amendmentError) return Response.json({ error: { code: "service_unavailable", message: "정정 공시를 불러오지 못했습니다." } }, { status: 503 });
  if (!amendment) return Response.json({ error: { code: "not_found", message: "공시를 찾지 못했습니다." } }, { status: 404 });
  if (!amendment.is_amendment) {
    return Response.json({ available: false, reason: "not_an_amendment", message: "정정 공시에만 원본 비교를 제공합니다." });
  }

  let access;
  try {
    access = await resolveFilingAccess({ userId: user.id, filing: amendment });
  } catch {
    return Response.json({ error: { code: "service_unavailable", message: "공시 접근 권한을 확인하지 못했습니다." } }, { status: 503 });
  }
  if (!access) return Response.json({ error: { code: "forbidden", message: "내 공시 알림 또는 현재 카탈로그 피드에 있는 공시만 확인할 수 있습니다." } }, { status: 403 });
  if (!amendment.primary_document_url) {
    return Response.json({ available: false, reason: "no_primary_document", message: "SEC가 비교할 주요 제출문서를 제공하지 않았습니다." });
  }

  let amendmentText: string;
  try {
    amendmentText = await fetchSecText(amendment.primary_document_url);
  } catch {
    return Response.json({ available: false, reason: "source_unavailable", message: "SEC 원문을 지금 불러오지 못했습니다. 잠시 후 다시 시도해주세요." }, { status: 503 });
  }
  const { data: candidates, error: candidatesError } = await admin
    .from("sec_filing_events").select("*").eq("cik", amendment.cik)
    .eq("form_type", originalFormType(amendment.form_type)).eq("is_amendment", false)
    .lt("filing_date", amendment.filing_date).order("filing_date", { ascending: false }).limit(16)
    .returns<SecFilingEventRow[]>();
  if (candidatesError) return Response.json({ error: { code: "service_unavailable", message: "원본 후보를 불러오지 못했습니다." } }, { status: 503 });
  const matched = findAmendedOriginal({ amendment, candidates: candidates ?? [], amendmentText });
  if (!matched || !matched.filing.primary_document_url) {
    return Response.json({ available: false, reason: "original_not_identified", message: "SEC 제출 정보만으로 연결할 수 있는 원본 공시를 찾지 못했습니다." });
  }

  const [originalTextResult, amendmentDocuments, originalDocuments] = await Promise.allSettled([
    fetchSecText(matched.filing.primary_document_url), loadFilingDocuments(amendment), loadFilingDocuments(matched.filing),
  ]);
  const amendmentNames = amendmentDocuments.status === "fulfilled" ? new Set(amendmentDocuments.value.documents.map((document) => document.document_name)) : new Set<string>();
  const originalNames = originalDocuments.status === "fulfilled" ? new Set(originalDocuments.value.documents.map((document) => document.document_name)) : new Set<string>();
  const textDiff = originalTextResult.status === "fulfilled" ? diffFilingText(originalTextResult.value, amendmentText) : null;
  await recordAnalyticsEvent({ eventName: "amendment_comparison_opened", userId: user.id, properties: { filing_event_id: amendment.id, original_filing_event_id: matched.filing.id, match_reason: matched.reason, text_diff_available: Boolean(textDiff) } });

  return Response.json({
    available: true,
    original: { id: matched.filing.id, filing_date: matched.filing.filing_date, form_type: matched.filing.form_type },
    match_reason: matched.reason,
    text_diff: textDiff,
    document_changes: { added: [...amendmentNames].filter((name) => !originalNames.has(name)).slice(0, 20), removed: [...originalNames].filter((name) => !amendmentNames.has(name)).slice(0, 20) },
    note: textDiff ? "SEC 원문을 저장하지 않고, 이번 화면에서 정규화한 앞 1,000줄만 비교했습니다." : "원본 주요문서를 지금 불러오지 못해 첨부 목록만 비교했습니다.",
  }, { headers: { "Cache-Control": "private, no-store" } });
}
