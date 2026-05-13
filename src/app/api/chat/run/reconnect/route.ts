import { NextRequest } from "next/server";
import { getAuthUser, handleAuthError, forbiddenError } from "@/lib/auth";
import { checkQuota, getQuotaStatus } from "@/lib/concurrency/quota";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AgentRunRow, ChatSessionRow, MessageRow } from "@/types/database";

export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 800;
const MAX_POLL_MS = 55_000;

type ReconnectRun = Pick<
  AgentRunRow,
  | "id"
  | "session_id"
  | "assistant_message_id"
  | "status"
  | "input_tokens"
  | "output_tokens"
  | "estimated_cost_usd"
  | "latency_ms"
  | "ontology_release_id"
  | "index_generated_at"
  | "error_code"
  | "error_message"
>;

type ReconnectMessage = Pick<MessageRow, "id" | "content" | "status">;

export async function GET(request: NextRequest) {
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  const runId = url.searchParams.get("run_id");
  const contentLength = Math.max(
    0,
    Number.parseInt(url.searchParams.get("content_length") || "0", 10) || 0,
  );

  if (!sessionId || !runId) {
    return Response.json(
      {
        error: {
          code: "validation_error" as const,
          message: "채팅 ID와 실행 ID가 필요합니다.",
        },
      },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: session, error: sessionError } = await supabase
    .from("chat_sessions")
    .select("id, user_id")
    .eq("id", sessionId)
    .single<ChatSessionRow>();

  if (sessionError || !session) {
    return Response.json(
      { error: { code: "not_found" as const, message: "채팅을 찾지 못했습니다." } },
      { status: 404 },
    );
  }

  if (session.user_id !== user.id) {
    return forbiddenError("이 채팅에 접근할 권한이 없습니다.");
  }

  const encoder = new TextEncoder();
  const admin = getSupabaseAdmin();
  let clientConnected = true;

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = async (event: string, data: unknown) => {
        if (!clientConnected) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          clientConnected = false;
        }
      };

      let sentLength = contentLength;
      const startedAt = Date.now();

      while (Date.now() - startedAt < MAX_POLL_MS && clientConnected) {
        const { data: run } = await admin
          .from("agent_runs")
          .select(
            "id, session_id, assistant_message_id, status, input_tokens, output_tokens, estimated_cost_usd, latency_ms, ontology_release_id, index_generated_at, error_code, error_message",
          )
          .eq("id", runId)
          .eq("session_id", sessionId)
          .single<ReconnectRun>();

        if (!run) {
          await sendEvent("error", {
            run_id: runId,
            error_code: "not_found",
            error_message: "실행 정보를 찾지 못했습니다.",
          });
          break;
        }

        const message = run.assistant_message_id
          ? await loadAssistantMessage(admin, run.assistant_message_id)
          : null;

        if (message && message.content.length > sentLength) {
          await sendEvent("token", {
            text: message.content.slice(sentLength),
          });
          sentLength = message.content.length;
        }

        if (run.status === "completed") {
          await sendDoneEvent({
            sendEvent,
            userId: user.id,
            run,
            message,
          });
          break;
        }

        if (run.status === "failed") {
          await sendEvent("error", {
            run_id: run.id,
            error_code: run.error_code || "claude_api_error",
            error_message: run.error_message || "실행에 실패했습니다.",
          });
          break;
        }

        if (run.status === "cancelled") {
          await sendEvent("cancelled", {
            run_id: run.id,
            message_id: run.assistant_message_id,
          });
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      try {
        controller.close();
      } catch {
        // Client may have disconnected.
      }
    },
    cancel() {
      clientConnected = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function loadAssistantMessage(
  admin: ReturnType<typeof getSupabaseAdmin>,
  messageId: string,
): Promise<ReconnectMessage | null> {
  const { data } = await admin
    .from("messages")
    .select("id, content, status")
    .eq("id", messageId)
    .single<ReconnectMessage>();

  return data ?? null;
}

async function sendDoneEvent(params: {
  sendEvent: (event: string, data: unknown) => Promise<void>;
  userId: string;
  run: ReconnectRun;
  message: ReconnectMessage | null;
}) {
  const { sendEvent, userId, run, message } = params;
  const estimatedCost = Number(run.estimated_cost_usd ?? 0);
  const quota = await checkQuota(userId);

  await sendEvent("done", {
    run_id: run.id,
    message_id: message?.id ?? run.assistant_message_id ?? "",
    content: message?.content ?? "",
    release: {
      ontology_release_id: run.ontology_release_id ?? "",
      index_generated_at: run.index_generated_at ?? "",
      company_count: 0,
      document_count: 0,
      krw_ontology_commit: process.env.KRW_ONTOLOGY_COMMIT || "dev",
      web_commit: process.env.WEB_COMMIT || "dev",
    },
    usage: {
      input_tokens: run.input_tokens ?? 0,
      output_tokens: run.output_tokens ?? 0,
      estimated_cost_usd: estimatedCost,
      latency_ms: run.latency_ms ?? 0,
    },
    quota: getQuotaStatus(
      Math.max(0, quota.questionsUsed - 1),
      Math.max(0, quota.costUsed - estimatedCost),
      estimatedCost,
    ),
  });
}
