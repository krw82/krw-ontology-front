import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { readIntEnv } from "@/lib/env";
import type { Json } from "@/types/database";
import type { RunStatus, StreamingEventType } from "@/types/api-contracts";

const EVENT_POLL_INTERVAL_MS = readIntEnv("AGENT_EVENT_POLL_INTERVAL_MS", 800, {
  min: 100,
});
const EVENT_STREAM_MAX_MS = readIntEnv("AGENT_EVENT_STREAM_MAX_MS", 120_000, {
  min: 10_000,
});

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

export interface AgentRunEventRow {
  id: number;
  run_id: string;
  event_type: StreamingEventType;
  payload: Json;
  created_at: string;
}

export async function appendAgentRunEvent(
  admin: SupabaseAdmin,
  runId: string,
  eventType: StreamingEventType,
  payload: unknown,
): Promise<number | null> {
  const { data, error } = await admin
    .from("agent_run_events")
    .insert({
      run_id: runId,
      event_type: eventType,
      payload: jsonForDb(payload) ?? {},
    })
    .select("id")
    .single<{ id: number }>();

  if (error) {
    console.warn("[agent-run-events] append failed", {
      runId,
      eventType,
      error: error.message,
    });
    return null;
  }

  return data?.id ?? null;
}

export function createAgentRunEventWriter(
  admin: SupabaseAdmin,
  runId: string,
) {
  const decoder = new TextDecoder();
  let buffer = "";

  async function flushBlock(block: string) {
    let eventType: StreamingEventType | null = null;
    const dataLines: string[] = [];

    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) {
        eventType = line.slice("event: ".length).trim() as StreamingEventType;
      } else if (line.startsWith("data: ")) {
        dataLines.push(line.slice("data: ".length));
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length));
      }
    }

    if (!eventType || dataLines.length === 0) return;

    let payload: unknown;
    try {
      payload = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }

    await appendAgentRunEvent(admin, runId, eventType, payload);
  }

  return {
    async write(chunk: Uint8Array) {
      buffer += decoder.decode(chunk, { stream: true });

      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        await flushBlock(block);
      }
    },
    async flush() {
      const remaining = buffer.trim();
      buffer = "";
      if (remaining) await flushBlock(remaining);
    },
  };
}

export function streamAgentRunEventsResponse(params: {
  userId: string;
  sessionId: string;
  runId?: string | null;
  requestId?: string | null;
  lastEventId?: number;
}): Response {
  const { userId, sessionId, runId, requestId, lastEventId = 0 } = params;
  const admin = getSupabaseAdmin();
  const encoder = new TextEncoder();
  let clientConnected = true;

  const stream = new ReadableStream({
    async start(controller) {
      const write = async (chunk: string) => {
        if (!clientConnected) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          clientConnected = false;
        }
      };

      const sendEvent = async (
        eventType: StreamingEventType,
        payload: unknown,
        id?: number,
      ) => {
        await write(
          `${id != null ? `id: ${id}\n` : ""}event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`,
        );
      };

      let currentRunId = runId?.trim() || null;
      if (!currentRunId && requestId) {
        currentRunId = await findRunIdByRequestId(admin, requestId, sessionId);
      }

      if (!currentRunId) {
        await sendEvent("state_sync", {
          session_id: sessionId,
          run_id: null,
          status: "idle",
          reason: "stale_run",
        });
        controller.close();
        return;
      }

      const run = await loadOwnedRun(admin, currentRunId, sessionId, userId);
      if (!run) {
        await sendEvent("state_sync", {
          session_id: sessionId,
          run_id: currentRunId,
          status: "idle",
          reason: "stale_run",
        });
        controller.close();
        return;
      }

      let cursor = Math.max(0, Math.floor(lastEventId));
      const startedAt = Date.now();

      while (Date.now() - startedAt < EVENT_STREAM_MAX_MS) {
        const events = await loadEventsAfter(admin, currentRunId, cursor);

        for (const event of events) {
          cursor = Math.max(cursor, event.id);
          await sendEvent(event.event_type, event.payload, event.id);

          if (isTerminalEvent(event.event_type)) {
            controller.close();
            return;
          }
        }

        const latestStatus = await loadRunStatus(admin, currentRunId, sessionId);
        if (latestStatus && isTerminalStatus(latestStatus.status)) {
          if (latestStatus.status === "completed") {
            await sendEvent("state_sync", {
              session_id: sessionId,
              run_id: currentRunId,
              status: "completed",
              reason: "session_synced",
            });
            controller.close();
            return;
          }

          const terminalEventId = await loadEarliestTerminalEventId(
            admin,
            currentRunId,
          );
          if (terminalEventId != null) {
            if (terminalEventId <= cursor) {
              controller.close();
              return;
            }
            continue;
          }

          const syntheticEvent = await createSyntheticTerminalEvent({
            admin,
            runId: currentRunId,
            sessionId,
            userId,
            status: latestStatus.status,
            errorCode: latestStatus.error_code,
            requestId: latestStatus.request_id,
          });
          await sendEvent(
            syntheticEvent.eventType,
            syntheticEvent.payload,
            syntheticEvent.id ?? undefined,
          );
          controller.close();
          return;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, EVENT_POLL_INTERVAL_MS),
        );
      }

      const latestStatus = await loadRunStatus(admin, currentRunId, sessionId);
      await sendEvent("state_sync", {
        session_id: sessionId,
        run_id: currentRunId,
        status: latestStatus?.status ?? "running",
        reason: "poll_timeout",
      });
      controller.close();
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

async function findRunIdByRequestId(
  admin: SupabaseAdmin,
  requestId: string,
  sessionId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("agent_runs")
    .select("id")
    .eq("request_id", requestId)
    .eq("session_id", sessionId)
    .maybeSingle<{ id: string }>();

  return data?.id ?? null;
}

async function loadOwnedRun(
  admin: SupabaseAdmin,
  runId: string,
  sessionId: string,
  userId: string,
): Promise<{ id: string } | null> {
  const { data: run } = await admin
    .from("agent_runs")
    .select("id, session_id")
    .eq("id", runId)
    .eq("session_id", sessionId)
    .maybeSingle<{ id: string; session_id: string }>();

  if (!run) return null;

  const { data: session } = await admin
    .from("chat_sessions")
    .select("id, user_id")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle<{ id: string; user_id: string }>();

  return session?.user_id === userId ? { id: run.id } : null;
}

async function loadEventsAfter(
  admin: SupabaseAdmin,
  runId: string,
  cursor: number,
): Promise<AgentRunEventRow[]> {
  const { data } = await admin
    .from("agent_run_events")
    .select("id, run_id, event_type, payload, created_at")
    .eq("run_id", runId)
    .gt("id", cursor)
    .order("id", { ascending: true })
    .limit(100)
    .returns<AgentRunEventRow[]>();

  return data ?? [];
}

async function loadEarliestTerminalEventId(
  admin: SupabaseAdmin,
  runId: string,
): Promise<number | null> {
  const { data } = await admin
    .from("agent_run_events")
    .select("id")
    .eq("run_id", runId)
    .in("event_type", ["done", "error", "cancelled"])
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: number }>();

  return data?.id ?? null;
}

async function loadRunStatus(
  admin: SupabaseAdmin,
  runId: string,
  sessionId: string,
): Promise<{
  status: RunStatus;
  error_code: string | null;
  request_id: string;
} | null> {
  const { data } = await admin
    .from("agent_runs")
    .select("status, error_code, request_id")
    .eq("id", runId)
    .eq("session_id", sessionId)
    .maybeSingle<{
      status: RunStatus;
      error_code: string | null;
      request_id: string;
    }>();

  return data ?? null;
}

async function createSyntheticTerminalEvent(params: {
  admin: SupabaseAdmin;
  runId: string;
  sessionId: string;
  userId: string;
  status: RunStatus;
  errorCode: string | null;
  requestId: string;
}): Promise<{
  eventType: StreamingEventType;
  payload: unknown;
  id: number | null;
}> {
  const { admin, runId, sessionId, userId, status, errorCode, requestId } = params;

  if (status === "cancelled") {
    const payload = {
      run_id: runId,
      message_id: null,
    };
    return {
      eventType: "cancelled",
      payload,
      id: await appendAgentRunEvent(admin, runId, "cancelled", payload),
    };
  }

  if (status === "failed" || status === "expired") {
    await releaseExecutionBudget(
      userId,
      requestId,
      runId,
      errorCode ?? "worker_expired",
    );
    const payload = {
      run_id: runId,
      error_code: errorCode ?? "internal_error",
      error_message: "분석이 완료되지 않았습니다. 다시 시도해주세요.",
    };
    return {
      eventType: "error",
      payload,
      id: await appendAgentRunEvent(admin, runId, "error", payload),
    };
  }

  const payload = {
    session_id: sessionId,
    run_id: runId,
    status,
    reason: "session_synced",
  };
  return {
    eventType: "state_sync",
    payload,
    id: await appendAgentRunEvent(admin, runId, "state_sync", payload),
  };
}

async function releaseExecutionBudget(
  userId: string,
  requestId: string,
  runId: string | null,
  reason: string,
) {
  const { error } = await getSupabaseAdmin().rpc("release_execution_budget", {
    p_user_id: userId,
    p_request_id: requestId,
    p_run_id: runId,
    p_reason: reason,
  });
  if (error) {
    console.warn("[agent-run-events] failed to release execution budget", {
      code: error.code,
      message: error.message,
    });
  }
}

function isTerminalEvent(eventType: StreamingEventType): boolean {
  return eventType === "done" || eventType === "error" || eventType === "cancelled";
}

function isTerminalStatus(status: RunStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "expired"
  );
}

function jsonForDb(value: unknown): Json | null {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value)) as Json;
}
