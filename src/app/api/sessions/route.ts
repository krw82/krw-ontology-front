import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { getIndexedCompanies } from "@/lib/ontology/catalog";
import { createClient } from "@/lib/supabase/server";
import type { CreateSessionRequest } from "@/types/api-contracts";
import type { ChatSessionRow } from "@/types/database";
import {
  isOptionalStringArray,
  isPlainObject,
  normalizeStringList,
  parsePositiveIntParam,
} from "@/lib/api/validation";

function internalError(message: string) {
  return Response.json(
    { error: { code: "internal_error" as const, message } },
    { status: 500 },
  );
}

export async function GET(request: NextRequest) {
  let user;
  try {
    user = await getAuthUser();
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

  const {
    data: sessions,
    error,
    count,
  } = await supabase
    .from("chat_sessions")
    .select(
      "id, title, scope_type, default_tickers, last_message_preview, last_message_at, latest_run_status, created_at, updated_at",
      { count: "exact" },
    )
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .or("last_message_at.not.is.null,latest_run_status.in.(pending,queued,running)")
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1)
    .returns<ChatSessionRow[]>();

  if (error) {
    return internalError("채팅 목록을 불러오지 못했습니다.");
  }

  const summaries = (sessions ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    scope_type: s.scope_type,
    default_tickers: s.default_tickers ?? [],
    last_message_preview: s.last_message_preview,
    last_message_at: s.last_message_at,
    latest_run_status: s.latest_run_status,
    created_at: s.created_at,
    updated_at: s.updated_at,
  }));

  return Response.json({
    sessions: summaries,
    total: count ?? summaries.length,
    page,
    limit,
  });
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

  const normalizedTickers = Array.from(
    new Set(
      normalizeStringList(default_tickers).map((ticker) => ticker.toUpperCase()),
    ),
  );
  const normalizedDocumentTypes = normalizeStringList(default_document_types);
  const normalizedTitle = rawTitle?.trim();
  const body: CreateSessionRequest = {
    scope_type,
    ...(normalizedTitle ? { title: normalizedTitle } : {}),
    default_tickers: normalizedTickers,
    default_document_types: normalizedDocumentTypes,
  };

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
      title: sessionTitle,
      scope_type: body.scope_type,
      default_tickers: body.default_tickers ?? [],
      default_document_types: body.default_document_types ?? [],
    })
    .select()
    .single();

  if (error || !session) {
    return internalError("새 채팅을 만들지 못했습니다.");
  }

  return Response.json({ session }, { status: 201 });
}
