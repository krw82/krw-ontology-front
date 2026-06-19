import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { MAX_PROMPT_HISTORY_MESSAGES } from "@/lib/agent/system-prompt";
import type { ErrorCode } from "@/types/api-contracts";

export interface HistoryResult {
  userMessageId: string;
  userMessageCreated?: boolean;
  history: Array<{ role: string; content: string }>;
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
 * Saves the user message, loads previous messages for multi-turn context,
 * and returns the user message ID plus history.
 */
export async function fetchHistory(
  sessionId: string,
  content: string,
  requestId?: string
): Promise<{ ok: true; result: HistoryResult } | { ok: false; response: Response }> {
  const admin = getSupabaseAdmin();

  const userMessageResult = await getOrCreateUserMessage(
    admin,
    sessionId,
    content,
    requestId,
  );

  if (!userMessageResult) {
    return {
      ok: false,
      response: errorResponse(500, "internal_error", "메시지를 저장하지 못했습니다.", requestId),
    };
  }

  // Load previous messages for multi-turn context
  const { data: previousMessages, error: previousMessagesError } = await admin
    .from("messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .eq("status", "completed")
    .neq("id", userMessageResult.id)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(MAX_PROMPT_HISTORY_MESSAGES)
    .returns<Array<{ role: string; content: string }>>();

  if (previousMessagesError) {
    if (userMessageResult.created) {
      await admin.from("messages").delete().eq("id", userMessageResult.id);
    }

    return {
      ok: false,
      response: errorResponse(
        500,
        "internal_error",
        "대화 기록을 불러오지 못했습니다.",
        requestId,
      ),
    };
  }

  const history: Array<{ role: string; content: string }> = [
    ...(previousMessages ?? []),
  ].reverse();

  return {
    ok: true,
    result: {
      userMessageId: userMessageResult.id,
      userMessageCreated: userMessageResult.created,
      history,
    },
  };
}

async function getOrCreateUserMessage(
  admin: ReturnType<typeof getSupabaseAdmin>,
  sessionId: string,
  content: string,
  requestId?: string,
): Promise<{ id: string; created: boolean } | null> {
  const insertPayload = {
    session_id: sessionId,
    role: "user" as const,
    content,
    status: "completed" as const,
    request_id: requestId ?? null,
  };

  const { data: userMessage, error } = await admin
    .from("messages")
    .insert(insertPayload)
    .select("id")
    .single<{ id: string }>();

  if (userMessage) return { id: userMessage.id, created: true };

  if (error?.code !== "23505" || !requestId) return null;

  const { data: existing } = await admin
    .from("messages")
    .select("id")
    .eq("session_id", sessionId)
    .eq("request_id", requestId)
    .eq("role", "user")
    .maybeSingle<{ id: string }>();

  return existing ? { id: existing.id, created: false } : null;
}
