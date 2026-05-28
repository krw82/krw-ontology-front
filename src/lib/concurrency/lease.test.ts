import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { tryAcquireLease } from "./lease";

function createLeaseAdmin() {
  const updates: Array<{
    table: string;
    payload: Record<string, unknown>;
    filters: Record<string, unknown>;
    inFilters: Record<string, unknown[]>;
    nullFilters: Record<string, null>;
  }> = [];
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const selects: Array<{
    table: string;
    filters: Record<string, unknown>;
    lessThanFilters: Record<string, unknown>;
  }> = [];
  const rpc = vi.fn().mockResolvedValue({
    data: [{ id: "run-new" }],
    error: null,
  });

  const admin = {
    rpc,
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          inserts.push({ table, payload });
          return Promise.resolve({ data: null, error: null });
        },
        update(payload: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          const inFilters: Record<string, unknown[]> = {};
          const nullFilters: Record<string, null> = {};
          const query = {
            eq(key: string, value: unknown) {
              filters[key] = value;
              updates.push({
                table,
                payload,
                filters: { ...filters },
                inFilters: { ...inFilters },
                nullFilters: { ...nullFilters },
              });
              return Promise.resolve({ data: null, error: null });
            },
            in(key: string, values: unknown[]) {
              inFilters[key] = values;
              updates.push({
                table,
                payload,
                filters: { ...filters },
                inFilters: { ...inFilters },
                nullFilters: { ...nullFilters },
              });
              return query;
            },
            is(key: string, value: null) {
              nullFilters[key] = value;
              updates.push({
                table,
                payload,
                filters: { ...filters },
                inFilters: { ...inFilters },
                nullFilters: { ...nullFilters },
              });
              return Promise.resolve({ data: null, error: null });
            },
          };
          return query;
        },
        select() {
          const filters: Record<string, unknown> = {};
          const lessThanFilters: Record<string, unknown> = {};
          const inFilters: Record<string, unknown[]> = {};
          const nullFilters: Record<string, null> = {};
          const query = {
            eq(key: string, value: unknown) {
              filters[key] = value;
              return query;
            },
            lt(key: string, value: unknown) {
              lessThanFilters[key] = value;
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
            limit() {
              return query;
            },
            maybeSingle() {
              selects.push({ table, filters, lessThanFilters });
              return Promise.resolve({ data: null, error: null });
            },
            returns() {
              selects.push({ table, filters, lessThanFilters });
              if (table === "agent_runs" && lessThanFilters.lease_expires_at) {
                return Promise.resolve({
                  data: [
                    {
                      id: "run-expired",
                      assistant_message_id: "assistant-expired",
                    },
                  ],
                  error: null,
                });
              }
              if (table === "agent_runs" && lessThanFilters.started_at) {
                return Promise.resolve({ data: [], error: null });
              }
              if (table === "tool_calls") {
                expect(inFilters).toEqual({ run_id: ["run-expired"] });
                expect(nullFilters).toEqual({ finished_at: null });
                return Promise.resolve({
                  data: [{ id: "tool-open", error_message: null }],
                  error: null,
                });
              }
              return Promise.resolve({ data: [], error: null });
            },
          };
          return query;
        },
      };
    },
  };

  return {
    admin: admin as unknown as ReturnType<typeof getSupabaseAdmin>,
    updates,
    inserts,
    selects,
    rpc,
  };
}

describe("lease cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("closes open tool calls when cleaning up expired runs before acquiring a new lease", async () => {
    const fake = createLeaseAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    await expect(
      tryAcquireLease(
        "session-1",
        "user-message-1",
        "request-1",
        "sonnet",
        "web",
        "ontology",
      ),
    ).resolves.toEqual({ acquired: true, runId: "run-new" });

    expect(fake.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "agent_runs",
          payload: expect.objectContaining({
            status: "failed",
            error_code: "lease_expired",
          }),
          inFilters: { id: ["run-expired"] },
        }),
        expect.objectContaining({
          table: "tool_calls",
          payload: expect.objectContaining({
            finished_at: expect.any(String),
            error_message: "Lease expired before tool result was received",
          }),
          filters: { id: "tool-open" },
        }),
        expect.objectContaining({
          table: "messages",
          payload: expect.objectContaining({
            status: "failed",
          }),
          inFilters: { id: ["assistant-expired"] },
        }),
        expect.objectContaining({
          table: "concurrency_leases",
          payload: { released_at: expect.any(String) },
          inFilters: { run_id: ["run-expired"] },
          nullFilters: { released_at: null },
        }),
      ]),
    );
    expect(fake.rpc).toHaveBeenCalledWith(
      "try_acquire_lease",
      expect.objectContaining({
        p_session_id: "session-1",
        p_request_id: "request-1",
      }),
    );
  });
});
