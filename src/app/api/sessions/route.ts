import { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { buildSessionPreview } from "@/lib/chat/session-preview";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import { createClient } from "@/lib/supabase/server";
import type { CreateSessionRequest } from "@/types/api-contracts";
import type { ChatSessionRow, MessageRow, AgentRunRow } from "@/types/database";

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
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(
    50,
    Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10))
  );
  const offset = (page - 1) * limit;

  const {
    data: sessions,
    error,
  } = await supabase
    .from("chat_sessions")
    .select(
      "id, title, scope_type, default_tickers, created_at, updated_at"
    )
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1)
    .returns<ChatSessionRow[]>();

  if (error) {
    return Response.json(
      { error: { code: "internal_error" as const, message: "채팅 목록을 불러오지 못했습니다." } },
      { status: 500 }
    );
  }

  // Get last message preview for each session
  const sessionIds = (sessions ?? []).map((s) => s.id);
  const lastMessages: Record<string, { content: string; created_at: string }> =
    {};
  const latestRunStatus: Record<string, AgentRunRow["status"]> = {};

  if (sessionIds.length > 0) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("session_id, content, status, created_at")
      .in("session_id", sessionIds)
      .order("created_at", { ascending: false })
      .returns<MessageRow[]>();

    if (msgs) {
      for (const m of msgs) {
        if (!lastMessages[m.session_id]) {
          lastMessages[m.session_id] = {
            content: buildSessionPreview(m),
            created_at: m.created_at,
          };
        }
      }
    }

    const { data: runs } = await supabase
      .from("agent_runs")
      .select("session_id, status, started_at")
      .in("session_id", sessionIds)
      .order("started_at", { ascending: false })
      .returns<AgentRunRow[]>();

    if (runs) {
      for (const run of runs) {
        if (!latestRunStatus[run.session_id]) {
          latestRunStatus[run.session_id] = run.status;
        }
      }
    }
  }

  const summaries = (sessions ?? [])
    .map((s) => ({
      id: s.id,
      title: s.title,
      scope_type: s.scope_type,
      default_tickers: s.default_tickers ?? [],
      last_message_preview: lastMessages[s.id]?.content ?? null,
      last_message_at: lastMessages[s.id]?.created_at ?? null,
      latest_run_status: latestRunStatus[s.id] ?? null,
      created_at: s.created_at,
      updated_at: s.updated_at,
    }))
    .filter(
      (summary) =>
        summary.last_message_at !== null ||
        summary.latest_run_status === "running" ||
        summary.latest_run_status === "pending",
    );

  return Response.json({
    sessions: summaries,
    total: summaries.length,
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

  let body: CreateSessionRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: "validation_error" as const, message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  if (
    body.scope_type === "company" &&
    (!body.default_tickers || body.default_tickers.length === 0)
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

  if (body.scope_type === "company" && body.default_tickers) {
    const normalizedTickers = body.default_tickers.map((ticker) =>
      ticker.trim().toUpperCase(),
    );
    const indexedCompanies = await Promise.all(
      normalizedTickers.map((ticker) => getIndexedCompany(ticker)),
    );
    const missingTicker = normalizedTickers.find(
      (_, index) => !indexedCompanies[index],
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

  const title =
    body.title ||
    (body.scope_type === "company" && body.default_tickers
      ? `리서치: ${body.default_tickers.join(", ")}`
      : "새 채팅");

  if (title.length > 200) {
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
      title,
      scope_type: body.scope_type,
      default_tickers: body.default_tickers ?? [],
      default_document_types: body.default_document_types ?? [],
    })
    .select()
    .single();

  if (error || !session) {
    return Response.json(
      { error: { code: "internal_error", message: "새 채팅을 만들지 못했습니다." } },
      { status: 500 }
    );
  }

  return Response.json({ session }, { status: 201 });
}
