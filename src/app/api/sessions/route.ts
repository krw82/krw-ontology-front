import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { getIndexedCompanies } from "@/lib/ontology/catalog";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveFilingAccess } from "@/lib/filing-notifications/filing-access";
import type { CreateSessionRequest } from "@/types/api-contracts";
import type { ChatSessionRow, SecFilingEventRow } from "@/types/database";
import { sanitizeAssistantPreviewContent } from "@/lib/chat/assistant-content";
import { canAccessMenuFeature } from "@/lib/billing/feature-access-server";
import {
  isOptionalStringArray,
  isPlainObject,
  normalizeStringList,
  parsePositiveIntParam,
} from "@/lib/api/validation";
import { ServerTiming } from "@/lib/performance/server-timing";

function internalError(message: string) {
  return Response.json(
    { error: { code: "internal_error" as const, message } },
    { status: 500 },
  );
}

export async function GET(request: NextRequest) {
  const timing = new ServerTiming();
  let user;
  try {
    user = await timing.measure("auth", () => getAuthUser());
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const supabase = await createClient();
  const url = new URL(request.url);
  const page = parsePositiveIntParam(url.searchParams.get("page"), 1);
  const limit = parsePositiveIntParam(url.searchParams.get("limit"), 20, {
    max: 50,
  });
  const offset = (page - 1) * limit;

  const { data: sessionRows, error } = await timing.measure(
    "sessions",
    () => supabase
      .from("chat_sessions")
      .select(
        "id, title, scope_type, default_tickers, last_message_preview, last_message_at, latest_run_status, created_at, updated_at",
      )
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .is("closed_at", null)
      .or("last_message_at.not.is.null,latest_run_status.in.(pending,queued,running)")
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit)
      .returns<ChatSessionRow[]>(),
  );

  if (error) {
    return internalError("채팅 목록을 불러오지 못했습니다.");
  }

  const sessions = sessionRows ?? [];
  const hasMore = sessions.length > limit;
  const summaries = sessions.slice(0, limit).map((s) => ({
    id: s.id,
    title: s.title,
    scope_type: s.scope_type,
    default_tickers: s.default_tickers ?? [],
    last_message_preview: s.last_message_preview
      ? sanitizeAssistantPreviewContent(s.last_message_preview)
      : s.last_message_preview,
    last_message_at: s.last_message_at,
    latest_run_status: s.latest_run_status,
    created_at: s.created_at,
    updated_at: s.updated_at,
  }));

  return Response.json({
    sessions: summaries,
    total: offset + summaries.length + (hasMore ? 1 : 0),
    page,
    limit,
  }, { headers: timing.headers({ "Cache-Control": "private, no-store" }) });
}

export async function POST(request: NextRequest) {
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return Response.json(
      { error: { code: "validation_error" as const, message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  if (!isPlainObject(parsedBody)) {
    return Response.json(
      { error: { code: "validation_error" as const, message: "Request body must be an object" } },
      { status: 400 },
    );
  }

  const {
    title: rawTitle,
    scope_type,
    default_tickers,
    default_document_types,
    source_filing_event_id,
  } = parsedBody;

  if (scope_type !== "global" && scope_type !== "company") {
    return Response.json(
      { error: { code: "validation_error" as const, message: "scope_type must be global or company" } },
      { status: 400 },
    );
  }

  if (rawTitle !== undefined && typeof rawTitle !== "string") {
    return Response.json(
      { error: { code: "validation_error" as const, message: "title must be a string" } },
      { status: 400 },
    );
  }

  if (
    source_filing_event_id !== undefined &&
    (typeof source_filing_event_id !== "string" || !isUuid(source_filing_event_id))
  ) {
    return Response.json(
      { error: { code: "validation_error" as const, message: "source_filing_event_id must be a UUID" } },
      { status: 400 },
    );
  }

  if (!isOptionalStringArray(default_tickers)) {
    return Response.json(
      { error: { code: "validation_error" as const, message: "default_tickers must be an array of strings" } },
      { status: 400 },
    );
  }

  if (!isOptionalStringArray(default_document_types)) {
    return Response.json(
      { error: { code: "validation_error" as const, message: "default_document_types must be an array of strings" } },
      { status: 400 },
    );
  }

  let normalizedTickers = Array.from(
    new Set(
      normalizeStringList(default_tickers).map((ticker) => ticker.toUpperCase()),
    ),
  );
  const normalizedDocumentTypes = normalizeStringList(default_document_types);
  const normalizedTitle = rawTitle?.trim();

  let sourceFilingEventId: string | null = null;
  if (typeof source_filing_event_id === "string") {
    const { data: filing, error: filingError } = await getSupabaseAdmin()
      .from("sec_filing_events")
      .select("*")
      .eq("id", source_filing_event_id)
      .maybeSingle<SecFilingEventRow>();
    if (filingError || !filing) {
      return Response.json(
        { error: { code: "not_found" as const, message: "연결할 공시를 찾지 못했습니다." } },
        { status: 404 },
      );
    }
    const access = await resolveFilingAccess({ userId: user.id, filing });
    if (!access) {
      return Response.json(
        { error: { code: "forbidden" as const, message: "이 공시를 리서치에 연결할 권한이 없습니다." } },
        { status: 403 },
      );
    }
    if (normalizedTickers.length > 0 && !normalizedTickers.includes(filing.ticker)) {
      return Response.json(
        { error: { code: "validation_error" as const, message: "공시의 회사와 채팅 회사가 일치하지 않습니다." } },
        { status: 400 },
      );
    }
    normalizedTickers = [filing.ticker];
    sourceFilingEventId = filing.id;
  }
  const body: CreateSessionRequest = {
    // A filing card always opens a single-company research context, even if a
    // caller forged a global scope in the browser request.
    scope_type: sourceFilingEventId ? "company" : scope_type,
    ...(normalizedTitle ? { title: normalizedTitle } : {}),
    default_tickers: normalizedTickers,
    default_document_types: normalizedDocumentTypes,
    ...(sourceFilingEventId ? { source_filing_event_id: sourceFilingEventId } : {}),
  };

  if (
    body.scope_type === "global" &&
    !(await canAccessMenuFeature(user.id, user.email ?? null, "wide_research"))
  ) {
    return Response.json(
      {
        error: {
          code: "forbidden" as const,
          message: "와이드 리서치는 Standard 플랜부터 사용할 수 있습니다.",
        },
      },
      { status: 403 },
    );
  }

  if (
    body.scope_type === "company" &&
    normalizedTickers.length === 0
  ) {
    return Response.json(
      {
        error: {
          code: "validation_error" as const,
          message: "default_tickers required for company scope",
        },
      },
      { status: 400 }
    );
  }

  if (body.scope_type === "company") {
    const indexedCompanies = await getIndexedCompanies(normalizedTickers);
    const indexedTickerSet = new Set(
      indexedCompanies.map((company) => company.ticker),
    );
    const missingTicker = normalizedTickers.find(
      (ticker) => !indexedTickerSet.has(ticker),
    );

    if (missingTicker) {
      return Response.json(
        {
          error: {
            code: "validation_error" as const,
            message: `현재 온톨로지 인덱스에 없는 회사입니다: ${missingTicker}`,
          },
        },
        { status: 400 },
      );
    }

    body.default_tickers = normalizedTickers;
  }

  const sessionTitle =
    body.title ||
    (body.scope_type === "company" && body.default_tickers
      ? `리서치: ${body.default_tickers.join(", ")}`
      : "새 채팅");

  if (sessionTitle.length > 200) {
    return Response.json(
      {
        error: {
          code: "validation_error" as const,
          message: "제목은 200자 이하여야 합니다.",
        },
      },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data: session, error } = await supabase
    .from("chat_sessions")
    .insert({
      user_id: user.id,
      agent_backend: "rust_agent",
      title: sessionTitle,
      scope_type: body.scope_type,
      default_tickers: body.default_tickers ?? [],
      default_document_types: body.default_document_types ?? [],
      source_filing_event_id: sourceFilingEventId,
    })
    .select(
      "id, user_id, agent_backend, closed_at, title, scope_type, default_tickers, default_document_types, deleted_at, created_at, updated_at",
    )
    .single();

  if (error || !session) {
    return internalError("새 채팅을 만들지 못했습니다.");
  }

  return Response.json({ session }, { status: 201 });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
