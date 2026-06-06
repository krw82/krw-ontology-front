import type { NextRequest } from "next/server";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { forbiddenError, getAuthUser, handleAuthError } from "@/lib/auth";
import { isPlainObject, isUuid } from "@/lib/api/validation";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AgentRunRow, ChatSessionRow } from "@/types/database";
import type { UpdateSessionRequest } from "@/types/api-contracts";

const MAX_SESSION_TITLE_LENGTH = 200;

type SessionOwnerRow = Pick<ChatSessionRow, "id" | "user_id"> &
  Record<string, unknown>;
type ActiveRunRow = Pick<AgentRunRow, "id" | "status"> &
  Record<string, unknown>;

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

function normalizeTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.replace(/\s+/g, " ").trim();
  return title.length > 0 ? title : null;
}

async function getOwnedVisibleSession(sessionId: string, userId: string) {
  const admin = getSupabaseAdmin();
  const { data: session, error } = await admin
    .from("chat_sessions")
    .select("id, user_id")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle<SessionOwnerRow>();

  if (error || !session) {
    return {
      ok: false as const,
      response: errorResponse(404, "not_found", "채팅을 찾지 못했습니다."),
    };
  }

  if (session.user_id !== userId) {
    return {
      ok: false as const,
      response: forbiddenError("이 채팅에 접근할 권한이 없습니다."),
    };
  }

  return { ok: true as const, session };
}

async function hasActiveRun(sessionId: string): Promise<boolean> {
  const { data: activeRuns } = await getSupabaseAdmin()
    .from("agent_runs")
    .select("id, status")
    .eq("session_id", sessionId)
    .in("status", ["pending", "queued", "running"])
    .limit(1)
    .returns<ActiveRunRow[]>();

  return Boolean(activeRuns?.length);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  if (!isUuid(sessionId)) {
    return errorResponse(404, "not_found", "채팅을 찾지 못했습니다.");
  }

  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const parsedBody = await request.json().catch(() => null);
  if (!isPlainObject(parsedBody)) {
    return errorResponse(400, "validation_error", "요청 본문 형식이 올바르지 않습니다.");
  }

  const body = parsedBody as Partial<UpdateSessionRequest>;
  const title = normalizeTitle(body.title);
  if (!title) {
    return errorResponse(400, "validation_error", "채팅 이름을 입력해주세요.");
  }
  if (title.length > MAX_SESSION_TITLE_LENGTH) {
    return errorResponse(
      400,
      "validation_error",
      `채팅 이름은 ${MAX_SESSION_TITLE_LENGTH}자 이하여야 합니다.`,
    );
  }

  const ownership = await getOwnedVisibleSession(sessionId, user.id);
  if (!ownership.ok) return ownership.response;

  const { data: session, error } = await getSupabaseAdmin()
    .from("chat_sessions")
    .update({
      title,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .is("deleted_at", null)
    .select("id, title, updated_at")
    .single<Pick<ChatSessionRow, "id" | "title" | "updated_at">>();

  if (error || !session) {
    return errorResponse(500, "internal_error", "채팅 이름을 저장하지 못했습니다.");
  }

  await recordAnalyticsEventFromRequest(request, {
    eventName: "session_renamed",
    userId: user.id,
    sessionId,
    properties: {
      title_length: title.length,
    },
  });

  return Response.json({ session });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  if (!isUuid(sessionId)) {
    return errorResponse(404, "not_found", "채팅을 찾지 못했습니다.");
  }

  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const ownership = await getOwnedVisibleSession(sessionId, user.id);
  if (!ownership.ok) return ownership.response;

  if (await hasActiveRun(sessionId)) {
    return errorResponse(
      409,
      "active_run_exists",
      "응답 생성이 끝난 뒤 삭제할 수 있습니다.",
    );
  }

  const deletedAt = new Date().toISOString();
  const { error } = await getSupabaseAdmin()
    .from("chat_sessions")
    .update({ deleted_at: deletedAt, updated_at: deletedAt })
    .eq("id", sessionId)
    .is("deleted_at", null);

  if (error) {
    return errorResponse(500, "internal_error", "채팅을 삭제하지 못했습니다.");
  }

  await getSupabaseAdmin()
    .from("message_shares")
    .update({ revoked_at: deletedAt })
    .eq("source_session_id", sessionId)
    .is("revoked_at", null);

  await recordAnalyticsEventFromRequest(request, {
    eventName: "session_deleted",
    userId: user.id,
    sessionId,
    properties: {
      deleted_at: deletedAt,
    },
  });

  return Response.json({
    success: true,
    session_id: sessionId,
    deleted_at: deletedAt,
  });
}
