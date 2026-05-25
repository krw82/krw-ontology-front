import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { StreamingEventType } from "@/types/api-contracts";
import {
  appendAgentRunEvent,
  createAgentRunEventWriter,
  streamAgentRunEventsResponse,
  type AgentRunEventRow,
} from "./run-events";

type FakeRun = {
  id: string;
  session_id: string;
  request_id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "expired";
  error_code: string | null;
};

type FakeSession = {
  id: string;
  user_id: string;
  deleted_at: string | null;
};

function createEventAdmin(params: {
  runs?: FakeRun[];
  sessions?: FakeSession[];
  events?: AgentRunEventRow[];
} = {}) {
  const events: AgentRunEventRow[] = [...(params.events ?? [])];
  const inserts: Array<{
    table: string;
    payload: Record<string, unknown>;
  }> = [];
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

  const admin = {
    rpc,
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          inserts.push({ table, payload });
          return {
            select() {
              return {
                single() {
                  if (table === "agent_run_events") {
                    const id = events.length + 1;
                    events.push({
                      id,
                      run_id: String(payload.run_id),
                      event_type: payload.event_type as StreamingEventType,
                      payload: payload.payload as AgentRunEventRow["payload"],
                      created_at: "2026-05-25T00:00:00.000Z",
                    });
                    return Promise.resolve({ data: { id }, error: null });
                  }
                  return Promise.resolve({ data: null, error: null });
                },
              };
            },
          };
        },
        select() {
          const filters: Record<string, unknown> = {};
          const nullFilters: Record<string, null> = {};
          let greaterThanId = 0;
          let queryLimit = 100;

          const query = {
            eq(key: string, value: unknown) {
              filters[key] = value;
              return query;
            },
            is(key: string, value: null) {
              nullFilters[key] = value;
              return query;
            },
            gt(key: string, value: number) {
              if (key === "id") greaterThanId = value;
              return query;
            },
            order() {
              return query;
            },
            limit(value: number) {
              queryLimit = value;
              return query;
            },
            maybeSingle() {
              if (table === "agent_runs") {
                const row =
                  params.runs?.find((run) =>
                    Object.entries(filters).every(
                      ([key, value]) => run[key as keyof FakeRun] === value,
                    ),
                  ) ?? null;
                return Promise.resolve({ data: row, error: null });
              }

              if (table === "chat_sessions") {
                const row =
                  params.sessions?.find((session) => {
                    const matchesFilters = Object.entries(filters).every(
                      ([key, value]) =>
                        session[key as keyof FakeSession] === value,
                    );
                    const matchesNullFilters = Object.keys(nullFilters).every(
                      (key) => session[key as keyof FakeSession] === null,
                    );
                    return matchesFilters && matchesNullFilters;
                  }) ?? null;
                return Promise.resolve({ data: row, error: null });
              }

              return Promise.resolve({ data: null, error: null });
            },
            returns() {
              if (table !== "agent_run_events") {
                return Promise.resolve({ data: [], error: null });
              }

              const rows = events
                .filter((event) =>
                  Object.entries(filters).every(
                    ([key, value]) =>
                      event[key as keyof AgentRunEventRow] === value,
                  ),
                )
                .filter((event) => event.id > greaterThanId)
                .sort((a, b) => a.id - b.id)
                .slice(0, queryLimit);

              return Promise.resolve({ data: rows, error: null });
            },
          };

          return query;
        },
      };
    },
  };

  return {
    admin: admin as unknown as ReturnType<typeof getSupabaseAdmin>,
    events,
    inserts,
    rpc,
  };
}

async function readStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

describe("agent run events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends JSON-safe run events", async () => {
    const fake = createEventAdmin();

    const id = await appendAgentRunEvent(fake.admin, "run-1", "activity_update", {
      stage: "queued",
      ignored: undefined,
    });

    expect(id).toBe(1);
    expect(fake.inserts).toEqual([
      {
        table: "agent_run_events",
        payload: {
          run_id: "run-1",
          event_type: "activity_update",
          payload: {
            stage: "queued",
          },
        },
      },
    ]);
  });

  it("converts SDK SSE blocks into durable event rows", async () => {
    const fake = createEventAdmin();
    const writer = createAgentRunEventWriter(fake.admin, "run-1");
    const encoder = new TextEncoder();

    await writer.write(
      encoder.encode(
        [
          'event: token\ndata: {"content":"A"}',
          'event: activity_update\ndata: {"stage":"retrieving","label":"검색 중"}',
          'event: done\ndata: {"run_id":"run-1","message_id":"message-1"}',
          "",
        ].join("\n\n"),
      ),
    );
    await writer.flush();

    expect(fake.events.map((event) => event.event_type)).toEqual([
      "token",
      "activity_update",
      "done",
    ]);
    expect(fake.events[1]?.payload).toEqual({
      stage: "retrieving",
      label: "검색 중",
    });
  });

  it("replays durable events with SSE ids and stops at terminal events", async () => {
    const fake = createEventAdmin({
      runs: [
        {
          id: "run-1",
          session_id: "session-1",
          request_id: "req-1",
          status: "completed",
          error_code: null,
        },
      ],
      sessions: [{ id: "session-1", user_id: "user-1", deleted_at: null }],
      events: [
        {
          id: 1,
          run_id: "run-1",
          event_type: "run_started",
          payload: { run_id: "run-1" },
          created_at: "2026-05-25T00:00:00.000Z",
        },
        {
          id: 2,
          run_id: "run-1",
          event_type: "done",
          payload: { run_id: "run-1", message_id: "message-1" },
          created_at: "2026-05-25T00:00:01.000Z",
        },
      ],
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = streamAgentRunEventsResponse({
      userId: "user-1",
      sessionId: "session-1",
      runId: "run-1",
    });

    await expect(readStream(response)).resolves.toContain(
      'id: 2\nevent: done\ndata: {"run_id":"run-1","message_id":"message-1"}',
    );
  });

  it("turns unknown or unauthorized runs into idle state sync", async () => {
    const fake = createEventAdmin({
      runs: [
        {
          id: "run-1",
          session_id: "session-1",
          request_id: "req-1",
          status: "running",
          error_code: null,
        },
      ],
      sessions: [{ id: "session-1", user_id: "other-user", deleted_at: null }],
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = streamAgentRunEventsResponse({
      userId: "user-1",
      sessionId: "session-1",
      runId: "run-1",
    });

    await expect(readStream(response)).resolves.toBe(
      'event: state_sync\ndata: {"session_id":"session-1","run_id":"run-1","status":"idle","reason":"stale_run"}\n\n',
    );
  });

  it("syncs completed runs without terminal events once and closes", async () => {
    const fake = createEventAdmin({
      runs: [
        {
          id: "run-1",
          session_id: "session-1",
          request_id: "req-1",
          status: "completed",
          error_code: null,
        },
      ],
      sessions: [{ id: "session-1", user_id: "user-1", deleted_at: null }],
      events: [
        {
          id: 1,
          run_id: "run-1",
          event_type: "run_started",
          payload: { run_id: "run-1" },
          created_at: "2026-05-25T00:00:00.000Z",
        },
      ],
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = streamAgentRunEventsResponse({
      userId: "user-1",
      sessionId: "session-1",
      runId: "run-1",
    });

    await expect(readStream(response)).resolves.toBe(
      'id: 1\nevent: run_started\ndata: {"run_id":"run-1"}\n\n' +
        'event: state_sync\ndata: {"session_id":"session-1","run_id":"run-1","status":"completed","reason":"session_synced"}\n\n',
    );
    expect(fake.events).toHaveLength(1);
  });
});
