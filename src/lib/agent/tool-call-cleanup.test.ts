import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { closeOpenToolCallsForRuns } from "./tool-call-cleanup";

function createToolCallAdmin(params: {
  openToolCalls: Array<{ id: string; error_message: string | null }>;
  selectError?: { message: string } | null;
  updateErrorIds?: string[];
}) {
  const updates: Array<{
    table: string;
    payload: Record<string, unknown>;
    filters: Record<string, unknown>;
  }> = [];
  const queries: Array<{
    table: string;
    inFilters: Record<string, unknown[]>;
    nullFilters: Record<string, null>;
  }> = [];

  const admin = {
    from(table: string) {
      return {
        select() {
          const inFilters: Record<string, unknown[]> = {};
          const nullFilters: Record<string, null> = {};
          const query = {
            in(key: string, values: unknown[]) {
              inFilters[key] = values;
              return query;
            },
            is(key: string, value: null) {
              nullFilters[key] = value;
              return query;
            },
            returns() {
              queries.push({ table, inFilters, nullFilters });
              return Promise.resolve({
                data: params.selectError ? null : params.openToolCalls,
                error: params.selectError ?? null,
              });
            },
          };
          return query;
        },
        update(payload: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          const query = {
            eq(key: string, value: unknown) {
              filters[key] = value;
              updates.push({ table, payload, filters: { ...filters } });
              return Promise.resolve({
                data: null,
                error: params.updateErrorIds?.includes(String(value))
                  ? { message: "update failed" }
                  : null,
              });
            },
          };
          return query;
        },
      };
    },
  };

  return { admin: admin as never, updates, queries };
}

describe("tool call cleanup", () => {
  it("closes every open tool call for terminal runs", async () => {
    const fake = createToolCallAdmin({
      openToolCalls: [
        { id: "tool-1", error_message: null },
        { id: "tool-2", error_message: "" },
      ],
    });

    await expect(
      closeOpenToolCallsForRuns({
        admin: fake.admin,
        runIds: ["run-1", "run-1", "run-2"],
        finishedAt: "2026-05-26T00:00:00.000Z",
        errorMessage: "Run ended before tool result was received",
      }),
    ).resolves.toBe(2);

    expect(fake.queries).toEqual([
      {
        table: "tool_calls",
        inFilters: { run_id: ["run-1", "run-2"] },
        nullFilters: { finished_at: null },
      },
    ]);
    expect(fake.updates).toEqual([
      {
        table: "tool_calls",
        payload: {
          finished_at: "2026-05-26T00:00:00.000Z",
          error_message: "Run ended before tool result was received",
        },
        filters: { id: "tool-1" },
      },
      {
        table: "tool_calls",
        payload: {
          finished_at: "2026-05-26T00:00:00.000Z",
          error_message: "Run ended before tool result was received",
        },
        filters: { id: "tool-2" },
      },
    ]);
  });

  it("preserves a tool-specific error message when one already exists", async () => {
    const fake = createToolCallAdmin({
      openToolCalls: [
        { id: "tool-1", error_message: "MCP transport closed" },
      ],
    });

    await expect(
      closeOpenToolCallsForRuns({
        admin: fake.admin,
        runIds: ["run-1"],
        finishedAt: "2026-05-26T00:00:00.000Z",
        errorMessage: "Lease expired",
      }),
    ).resolves.toBe(1);

    expect(fake.updates[0]?.payload).toEqual({
      finished_at: "2026-05-26T00:00:00.000Z",
      error_message: "MCP transport closed",
    });
  });

  it("does not throw when the cleanup query fails", async () => {
    const fake = createToolCallAdmin({
      openToolCalls: [],
      selectError: { message: "select failed" },
    });

    await expect(
      closeOpenToolCallsForRuns({
        admin: fake.admin,
        runIds: ["run-1"],
        errorMessage: "Lease expired",
      }),
    ).resolves.toBe(0);
    expect(fake.updates).toEqual([]);
  });
});
