import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildChatSessionHref } from "@/lib/chat/history-state";
import { makePulseItemKey, type PulseCandidate } from "@/lib/pulse/contract";
import type { AgentRunRow, ChatSessionRow, Database, MessageRow } from "@/types/database";

type AnalysisSession = Pick<
  ChatSessionRow,
  "id" | "title" | "default_tickers" | "latest_run_status" | "updated_at"
>;

type AnalysisRun = Pick<
  AgentRunRow,
  | "id"
  | "session_id"
  | "user_message_id"
  | "assistant_message_id"
  | "status"
  | "queued_at"
  | "started_at"
  | "finished_at"
>;

type AnalysisMessage = Pick<MessageRow, "id" | "content">;

const ACTIVE_STATUSES = new Set<AgentRunRow["status"]>([
  "pending",
  "queued",
  "running",
]);

export async function getAnalysisCandidates(
  supabase: SupabaseClient<Database>,
  userId: string,
  now = new Date(),
): Promise<PulseCandidate[]> {
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString();
  const { data: sessionRows, error: sessionsError } = await supabase
    .from("chat_sessions")
    .select("id, title, default_tickers, latest_run_status, updated_at")
    .eq("user_id", userId)
    .eq("scope_type", "company")
    .is("deleted_at", null)
    .gte("updated_at", cutoff)
    .order("updated_at", { ascending: false })
    .limit(20)
    .returns<AnalysisSession[]>();
  if (sessionsError) throw sessionsError;

  const sessions = sessionRows ?? [];
  if (sessions.length === 0) return [];

  const { data: runRows, error: runsError } = await supabase
    .from("agent_runs")
    .select("id, session_id, user_message_id, assistant_message_id, status, queued_at, started_at, finished_at")
    .in("session_id", sessions.map((session) => session.id))
    .in("status", ["pending", "queued", "running", "completed", "failed"])
    .order("queued_at", { ascending: false, nullsFirst: false })
    .limit(60)
    .returns<AnalysisRun[]>();
  if (runsError) throw runsError;

  const latestRunBySession = new Map<string, AnalysisRun>();
  for (const run of runRows ?? []) {
    if (!latestRunBySession.has(run.session_id)) latestRunBySession.set(run.session_id, run);
  }
  const latestRuns = [...latestRunBySession.values()];
  if (latestRuns.length === 0) return [];

  const messageIds = latestRuns
    .map((run) => run.user_message_id)
    .filter((id): id is string => Boolean(id));
  let messageRows: AnalysisMessage[] = [];
  if (messageIds.length > 0) {
    const { data, error: messagesError } = await supabase
      .from("messages")
      .select("id, content")
      .in("id", messageIds)
      .returns<AnalysisMessage[]>();
    if (messagesError) throw messagesError;
    messageRows = data ?? [];
  }

  return buildAnalysisCandidates(
    sessions,
    latestRuns,
    new Map(messageRows.map((message) => [message.id, message])),
  );
}

export function buildAnalysisCandidates(
  sessions: AnalysisSession[],
  runs: AnalysisRun[],
  messagesById: Map<string, AnalysisMessage>,
): PulseCandidate[] {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));

  return runs.flatMap((run) => {
    const session = sessionById.get(run.session_id);
    if (!session) return [];
    const ticker = session.default_tickers?.[0]?.trim().toUpperCase() || null;
    const question = compactQuestion(messagesById.get(run.user_message_id)?.content, session.title);
    const active = ACTIVE_STATUSES.has(run.status);
    const completed = run.status === "completed";
    const availableAt = run.queued_at ?? run.started_at ?? session.updated_at;
    const occurredAt = run.finished_at ?? run.started_at ?? availableAt;
    const href = buildChatSessionHref(session.id, { ticker });
    const phase = active ? "active" : completed ? "completed" : "failed";

    return [{
      item_key: makePulseItemKey("analysis", `${run.id}:${phase}`),
      kind: "analysis" as const,
      trigger: "state" as const,
      source_type: "analysis" as const,
      source_id: `${run.id}:${phase}`,
      ticker,
      coverage_level: null,
      judgment: null,
      linked_thesis: null,
      eyebrow: active
        ? "내가 시작한 분석 · 진행 중"
        : completed
          ? "내가 시작한 분석 · 완료"
          : "내가 시작한 분석 · 확인 필요",
      title: question,
      body: analysisBody(run.status),
      reason_code: "user_started_analysis",
      reason_label: "회사 채팅에서 직접 시작한 분석의 저장된 상태입니다. 피드에서 새 분석을 실행하지 않습니다.",
      priority: active ? "high" as const : completed ? "normal" as const : "low" as const,
      occurred_at: occurredAt,
      available_at: availableAt,
      expires_at: active
        ? null
        : new Date(Date.parse(occurredAt) + 30 * 24 * 60 * 60 * 1_000).toISOString(),
      saved_at: null,
      snoozed_until: null,
      phase,
      group_key: `analysis:${session.id}`,
      primary_action: {
        type: "link" as const,
        label: active ? "대화로 돌아가기" : completed ? "결과 이어보기" : "채팅에서 확인",
        href,
      },
      secondary_actions: active
        ? [{ type: "mutation" as const, label: "숨기기", action: "dismiss" as const }]
        : [],
      metadata: {
        run_status: run.status,
        session_id: session.id,
        user_started: true,
        // Keep a completed card stable across unchanged V3 snapshots. Using
        // compose time here made every delta treat the same analysis as new.
        updated_at: session.updated_at,
      },
    }];
  });
}

function compactQuestion(content: string | undefined, fallback: string): string {
  const withoutAttachments = (content ?? "")
    .replace(/<attached_file[\s\S]*?<\/attached_file>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const value = withoutAttachments || fallback.trim() || "회사 분석";
  return value.length > 140 ? `${value.slice(0, 137).trimEnd()}…` : value;
}

function analysisBody(status: AgentRunRow["status"]): string {
  if (status === "pending" || status === "queued") {
    return "분석 대기 중입니다. 원래 채팅에서 순서와 진행 상태를 확인할 수 있습니다.";
  }
  if (status === "running") {
    return "공시와 저장된 근거를 확인하고 있습니다. 완료되면 이 카드가 결과 카드로 바뀝니다.";
  }
  if (status === "failed") {
    return "분석을 완료하지 못했습니다. 원래 채팅에서 질문을 그대로 다시 시도할 수 있습니다.";
  }
  return "분석이 완료되었습니다. 원래 채팅에서 답변과 근거를 확인할 수 있습니다.";
}
