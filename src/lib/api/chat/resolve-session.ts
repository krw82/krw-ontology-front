import { createClient } from "@/lib/supabase/server";
import { forbiddenError } from "@/lib/auth";
import type { ChatSessionRow } from "@/types/database";
import type { ErrorCode } from "@/types/api-contracts";

export interface ResolvedSession {
  id: string;
  userId: string;
  scopeType: "global" | "company";
  defaultTickers: string[];
  defaultDocumentTypes: string[];
  sourceFilingEventId?: string | null;
}

function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  requestId?: string
) {
  return Response.json(
    { error: { code, message }, request_id: requestId },
    { status }
  );
}

/**
 * Looks up the chat session, verifies ownership, and returns a resolved session.
 */
export async function resolveSession(
  sessionId: string,
  userId: string,
  requestId?: string
): Promise<{ ok: true; session: ResolvedSession } | { ok: false; response: Response }> {
  const supabase = await createClient();
  const { data: session, error: sessionError } = await supabase
    .from("chat_sessions")
    .select("id, user_id, scope_type, default_tickers, default_document_types, source_filing_event_id")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .single<ChatSessionRow>();

  if (sessionError || !session) {
    return {
      ok: false,
      response: errorResponse(404, "not_found", "채팅을 찾지 못했습니다.", requestId),
    };
  }

  if (session.user_id !== userId) {
    return { ok: false, response: forbiddenError("이 채팅에 접근할 권한이 없습니다.", requestId) };
  }

  return {
    ok: true,
    session: {
      id: session.id,
      userId: session.user_id,
      scopeType: session.scope_type,
      defaultTickers: session.default_tickers ?? [],
      defaultDocumentTypes: session.default_document_types ?? [],
      sourceFilingEventId: session.source_filing_event_id ?? null,
    },
  };
}
