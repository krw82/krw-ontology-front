import { NextRequest } from "next/server";
import { getAuthUser, handleAuthError, forbiddenError } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ChatSessionRow, MessageRow, AgentRunRow } from "@/types/database";

function notFoundError(message: string) {
  return Response.json(
    { error: { code: "not_found" as const, message } },
    { status: 404 }
  );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const supabase = await createClient();

  const { data: session, error } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("id", sessionId)
    .single<ChatSessionRow>();

  if (error || !session) {
    return notFoundError("Session not found");
  }

  if (session.user_id !== user.id) {
    return forbiddenError("Session does not belong to user");
  }

  const { data: messages } = await supabase
    .from("messages")
    .select("id, session_id, role, content, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .returns<MessageRow[]>();

  const { data: runs } = await supabase
    .from("agent_runs")
    .select(
      "id, status, model, started_at, finished_at, latency_ms, input_tokens, output_tokens, ontology_release_id, error_code"
    )
    .eq("session_id", sessionId)
    .order("started_at", { ascending: true })
    .returns<Partial<AgentRunRow>[]>();

  return Response.json({
    session,
    messages: messages ?? [],
    runs: runs ?? [],
  });
}
