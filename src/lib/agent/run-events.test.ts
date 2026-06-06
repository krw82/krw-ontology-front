import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  AgentRunEventWaiter,
  AgentRunEventWaitResult,
} from "@/lib/agent/run-event-listener";
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
  const selects: string[] = [];
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
          selects.push(table);
          const filters: Record<string, unknown> = {};
          const inFilters: Record<string, unknown[]> = {};
          const nullFilters: Record<string, null> = {};
          let greaterThanId = 0;
          let queryLimit = 100;

          const query = {
            eq(key: string, value: unknown) {
              filters[key] = value;
              return query;
            },
            in(key: string, values: unknown[]) {
              inFilters[key] = values;
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
              if (table === "agent_run_events") {
                const row =
                  events.find((event) => {
                    const matchesFilters = Object.entries(filters).every(
                      ([key, value]) =>
                        event[key as keyof AgentRunEventRow] === value,
                    );
                    const matchesInFilters = Object.entries(inFilters).every(
                      ([key, values]) =>
                        values.includes(event[key as keyof AgentRunEventRow]),
                    );
                    return matchesFilters && matchesInFilters;
                  }) ?? null;
                return Promise.resolve({ data: row, error: null });
              }

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
                .filter((event) =>
                  Object.entries(inFilters).every(([key, values]) =>
                    values.includes(event[key as keyof AgentRunEventRow]),
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
    selects,
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

function immediateTimeoutWaiter(): AgentRunEventWaiter {
  return {
    waitForRunEvent: vi.fn().mockResolvedValue("timeout"),
  };
}

function deferredNotificationWaiter() {
  let wake: (() => void) | null = null;
  const waiter: AgentRunEventWaiter = {
    waitForRunEvent: vi.fn(
      () =>
        new Promise<AgentRunEventWaitResult>((resolve) => {
          wake = () => resolve("notification");
        }),
    ),
  };

  return {
    waiter,
    wake() {
      if (!wake) throw new Error("waiter has not started waiting");
      wake();
    },
  };
}

async function waitForCondition(predicate: () => boolean) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 1_000) {
      throw new Error("Timed out waiting for test condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
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

  it("drops token SSE blocks while preserving durable state events", async () => {
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
      "activity_update",
      "done",
    ]);
    expect(fake.events[0]?.payload).toEqual({
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
      eventWaiter: immediateTimeoutWaiter(),
    });

    await expect(readStream(response)).resolves.toContain(
      'id: 2\nevent: done\ndata: {"run_id":"run-1","message_id":"message-1"}',
    );
  });

  it("redacts private release paths while replaying durable done events", async () => {
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
          event_type: "done",
          payload: {
            run_id: "run-1",
            message_id: "message-1",
            release: {
              ontology_release_id: "release-1",
              ontology_env: "dev",
              index_path: "/srv/private/index.sqlite",
              manifest_path: "/srv/private/manifest.json",
              company_count: 1,
              document_count: 2,
              object_count: 3,
              krw_ontology_commit: "abc123",
              web_commit: "def456",
            },
          },
          created_at: "2026-05-25T00:00:00.000Z",
        },
      ],
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = streamAgentRunEventsResponse({
      userId: "user-1",
      sessionId: "session-1",
      runId: "run-1",
      eventWaiter: immediateTimeoutWaiter(),
    });

    const text = await readStream(response);
    expect(text).toContain('"ontology_release_id":"release-1"');
    expect(text).not.toContain("index_path");
    expect(text).not.toContain("manifest_path");
    expect(text).not.toContain("/srv/private");
  });

  it("redacts raw error messages while replaying durable error events", async () => {
    const fake = createEventAdmin({
      runs: [
        {
          id: "run-1",
          session_id: "session-1",
          request_id: "req-1",
          status: "failed",
          error_code: "claude_api_error",
        },
      ],
      sessions: [{ id: "session-1", user_id: "user-1", deleted_at: null }],
      events: [
        {
          id: 1,
          run_id: "run-1",
          event_type: "error",
          payload: {
            run_id: "run-1",
            error_code: "claude_api_error",
            error_message: "stack trace: secret=/srv/claude-prod/token",
          },
          created_at: "2026-05-25T00:00:00.000Z",
        },
      ],
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = streamAgentRunEventsResponse({
      userId: "user-1",
      sessionId: "session-1",
      runId: "run-1",
      eventWaiter: immediateTimeoutWaiter(),
    });

    const text = await readStream(response);
    expect(text).toContain(
      "에이전트 실행 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
    );
    expect(text).not.toContain("secret=");
    expect(text).not.toContain("/srv/claude-prod/token");
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
      eventWaiter: immediateTimeoutWaiter(),
    });

    await expect(readStream(response)).resolves.toBe(
      'event: state_sync\ndata: {"session_id":"session-1","run_id":"run-1","status":"idle","reason":"stale_run"}\n\n',
    );
  });

  it("waits for run notifications instead of polling run status while open", async () => {
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
      sessions: [{ id: "session-1", user_id: "user-1", deleted_at: null }],
    });
    const deferred = deferredNotificationWaiter();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = streamAgentRunEventsResponse({
      userId: "user-1",
      sessionId: "session-1",
      runId: "run-1",
      eventWaiter: deferred.waiter,
    });
    const streamText = readStream(response);

    await waitForCondition(
      () => vi.mocked(deferred.waiter.waitForRunEvent).mock.calls.length === 1,
    );
    expect(fake.selects.filter((table) => table === "agent_runs")).toHaveLength(1);

    fake.events.push({
      id: 1,
      run_id: "run-1",
      event_type: "done",
      payload: { run_id: "run-1", message_id: "message-1" },
      created_at: "2026-05-25T00:00:01.000Z",
    });
    deferred.wake();

    await expect(streamText).resolves.toContain(
      'id: 1\nevent: done\ndata: {"run_id":"run-1","message_id":"message-1"}',
    );
    expect(fake.selects.filter((table) => table === "agent_run_events")).toHaveLength(2);
    expect(fake.selects.filter((table) => table === "agent_runs")).toHaveLength(1);
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
    const waiter = immediateTimeoutWaiter();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = streamAgentRunEventsResponse({
      userId: "user-1",
      sessionId: "session-1",
      runId: "run-1",
      eventWaiter: waiter,
    });

    await expect(readStream(response)).resolves.toBe(
      'id: 1\nevent: run_started\ndata: {"run_id":"run-1"}\n\n' +
        'event: state_sync\ndata: {"session_id":"session-1","run_id":"run-1","status":"completed","reason":"session_synced"}\n\n',
    );
    expect(fake.events).toHaveLength(1);
    expect(waiter.waitForRunEvent).toHaveBeenCalledTimes(1);
    expect(fake.selects.filter((table) => table === "agent_runs")).toHaveLength(2);
  });

  it("does not append a duplicate synthetic terminal event when the existing terminal event is past the first page", async () => {
    const durableEvents: AgentRunEventRow[] = [
      ...Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        run_id: "run-1",
        event_type: "token" as const,
        payload: { content: `chunk-${index + 1}` },
        created_at: "2026-05-25T00:00:00.000Z",
      })),
      {
        id: 101,
        run_id: "run-1",
        event_type: "error",
        payload: { run_id: "run-1", error_code: "worker_expired" },
        created_at: "2026-05-25T00:00:01.000Z",
      },
    ];
    const fake = createEventAdmin({
      runs: [
        {
          id: "run-1",
          session_id: "session-1",
          request_id: "req-1",
          status: "failed",
          error_code: "worker_expired",
        },
      ],
      sessions: [{ id: "session-1", user_id: "user-1", deleted_at: null }],
      events: durableEvents,
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = streamAgentRunEventsResponse({
      userId: "user-1",
      sessionId: "session-1",
      runId: "run-1",
      lastEventId: 101,
      eventWaiter: immediateTimeoutWaiter(),
    });

    await expect(readStream(response)).resolves.toBe("");
    expect(fake.events).toHaveLength(101);
    expect(fake.rpc).not.toHaveBeenCalled();
  });
});
