import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { recordAnalyticsEvent } from "@/lib/analytics/server";
import { tryRecordCoverageActivation } from "@/lib/coverage/activation";
import {
  resolveFilingAccess,
  resolveFilingContextTicker,
} from "@/lib/filing-notifications/filing-access";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  SecFilingBriefRow,
  SecFilingDocumentRow,
  SecFilingEventRow,
} from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const targetSchema = z.enum(["index", "primary", "brief"]).catch("index");

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
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
  const { data: filing, error: filingError } = await admin
    .from("sec_filing_events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle<SecFilingEventRow>();
  if (filingError) return Response.json({ error: { code: "service_unavailable", message: "공시를 불러오지 못했습니다." } }, { status: 503 });
  if (!filing) return Response.json({ error: { code: "not_found", message: "공시를 찾지 못했습니다." } }, { status: 404 });

  let access;
  try {
    access = await resolveFilingAccess({ userId: user.id, filing });
  } catch {
    return Response.json({ error: { code: "service_unavailable", message: "공시 접근 권한을 확인하지 못했습니다." } }, { status: 503 });
  }
  if (!access) return Response.json({ error: { code: "forbidden", message: "내 공시 알림 또는 현재 카탈로그 피드에 있는 공시만 열 수 있습니다." } }, { status: 403 });

  const documentId = request.nextUrl.searchParams.get("document");
  const target = targetSchema.parse(request.nextUrl.searchParams.get("target"));
  let url = target === "primary"
    ? filing.primary_document_url ?? filing.filing_detail_url
    : filing.filing_detail_url;
  let source = url === filing.filing_detail_url ? "filing_index" : "primary_document";
  if (target === "brief" && !documentId) {
    const { data: brief, error: briefError } = await admin
      .from("sec_filing_briefs")
      .select("source_document_url")
      .eq("filing_event_id", filing.id)
      .maybeSingle<Pick<SecFilingBriefRow, "source_document_url">>();
    if (briefError) {
      return Response.json({ error: { code: "service_unavailable", message: "공시 요약 원문을 불러오지 못했습니다." } }, { status: 503 });
    }
    if (!brief) {
      return Response.json({ error: { code: "not_found", message: "공시 요약 원문을 찾지 못했습니다." } }, { status: 404 });
    }
    url = brief.source_document_url;
    source = "filing_brief";
  }
  if (documentId) {
    if (!z.string().uuid().safeParse(documentId).success) {
      return Response.json({ error: { code: "validation_error", message: "제출문서 식별자가 올바르지 않습니다." } }, { status: 400 });
    }
    const { data: document, error: documentError } = await admin
      .from("sec_filing_documents")
      .select("*")
      .eq("id", documentId)
      .eq("filing_event_id", filing.id)
      .maybeSingle<SecFilingDocumentRow>();
    if (documentError) return Response.json({ error: { code: "service_unavailable", message: "제출문서를 불러오지 못했습니다." } }, { status: 503 });
    if (!document) return Response.json({ error: { code: "not_found", message: "제출문서를 찾지 못했습니다." } }, { status: 404 });
    url = document.document_url;
    source = document.recommendation_score > 0 ? "recommended_exhibit" : "filing_document";
  }
  if (!isSecArchiveUrl(url)) {
    return Response.json({ error: { code: "invalid_source", message: "SEC 원문 주소가 올바르지 않습니다." } }, { status: 422 });
  }

  let ticker: string;
  try {
    ticker = await resolveFilingContextTicker({
      userId: user.id,
      filing,
      access,
      requestedTicker: request.nextUrl.searchParams.get("context_ticker"),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("invalid_filing_context_ticker")
    ) {
      return Response.json(
        {
          error: {
            code: "invalid_filing_context",
            message: "공시와 회사 맥락이 일치하지 않습니다.",
          },
        },
        { status: 422 },
      );
    }
    return Response.json(
      {
        error: {
          code: "service_unavailable",
          message: "이 공시의 회사 맥락을 확인하지 못했습니다. 다시 시도해주세요.",
        },
      },
      { status: 503 },
    );
  }
  const { error: sourceOpenError } = await admin
    .from("user_filing_source_opens")
    .upsert(
      {
        user_id: user.id,
        filing_event_id: filing.id,
        ticker,
        last_opened_at: new Date().toISOString(),
      },
      { onConflict: "user_id,filing_event_id" },
    );
  if (sourceOpenError) {
    return Response.json(
      {
        error: {
          code: "service_unavailable",
          message: "SEC 원문 확인을 기록하지 못했습니다. 다시 시도해주세요.",
        },
      },
      { status: 503 },
    );
  }

  await recordAnalyticsEvent({
    eventName: source === "recommended_exhibit" ? "key_exhibit_opened" : "sec_source_opened",
    userId: user.id,
    properties: { filing_event_id: filing.id, ticker, source, document_id: documentId },
  });
  await tryRecordCoverageActivation(user.id);
  return Response.redirect(url, 302);
}

function isSecArchiveUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.sec.gov" && url.pathname.startsWith("/Archives/");
  } catch {
    return false;
  }
}
