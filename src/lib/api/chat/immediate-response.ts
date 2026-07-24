import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Json, MessageRow } from "@/types/database";

export async function createImmediateAssistantResponse(params: {
  sessionId: string;
  requestId: string;
  content: string;
}): Promise<Response> {
  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data: assistantMessage, error } = await admin
    .from("messages")
    .insert({
      session_id: params.sessionId,
      role: "assistant",
      content: params.content,
      status: "completed",
      request_id: params.requestId,
    })
    .select("id, created_at")
    .single<Pick<MessageRow, "id" | "created_at">>();

  if (error || !assistantMessage) {
    return Response.json(
      {
        error: {
          code: "internal_error",
          message: "안전 응답을 저장하지 못했습니다.",
        },
        request_id: params.requestId,
      },
      { status: 500 },
    );
  }

  const payload = {
    run_id: `immediate:${params.requestId}`,
    message_id: assistantMessage.id,
    content: params.content,
    rich_answers: [],
    artifacts: [],
    chat_artifacts: [],
    visualizations: [],
    presentation: null,
    release: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
      latency_ms: Math.max(0, Date.now() - new Date(now).getTime()),
    },
    execution_budget: null,
  } satisfies Json;

  const body = `event: done\ndata: ${JSON.stringify(payload)}\n\n`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
