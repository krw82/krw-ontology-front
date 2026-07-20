import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  queries: [] as Array<{
    table: string;
    selected: string | null;
    filters: Array<{ method: string; column: string; value: unknown }>;
  }>,
  responses: new Map<string, { data: unknown[] | null; error: { message: string } | null }>(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const query = {
        table,
        selected: null as string | null,
        filters: [] as Array<{ method: string; column: string; value: unknown }>,
      };
      database.queries.push(query);
      const response = () => database.responses.get(table) ?? { data: [], error: null };
      const builder = {
        select: (columns: string) => {
          query.selected = columns;
          return builder;
        },
        in: (column: string, value: unknown) => {
          query.filters.push({ method: "in", column, value });
          return builder;
        },
        neq: (column: string, value: unknown) => {
          query.filters.push({ method: "neq", column, value });
          return builder;
        },
        eq: (column: string, value: unknown) => {
          query.filters.push({ method: "eq", column, value });
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(response()).then(resolve, reject),
      };
      return builder;
    },
  }),
}));

import { loadFilingDecisionNotificationContexts } from "./decision-context";

beforeEach(() => {
  database.queries.length = 0;
  database.responses.clear();
});

describe("filing decision notification context", () => {
  it("loads only bounded relationship facts and never personal prose", async () => {
    const currentEventId = "123e4567-e89b-42d3-a456-426614174000";
    database.responses.set("user_filing_judgments", {
      data: [{
        id: "judgment-1",
        user_id: "user-a",
        filing_event_id: "223e4567-e89b-42d3-a456-426614174000",
        ticker: "AAPL",
      }],
      error: null,
    });
    database.responses.set("user_company_monitoring_rules", {
      data: [
        { id: "rule-1", user_id: "user-a", ticker: "AAPL" },
        { id: "rule-2", user_id: "user-a", ticker: "AAPL" },
      ],
      error: null,
    });
    const subscriptions = new Map([
      ["user-a", { user_id: "user-a", ticker: "AAPL" }],
      ["user-b", { user_id: "user-b", ticker: "MSFT" }],
    ]);

    const contexts = await loadFilingDecisionNotificationContexts(
      { id: currentEventId, ticker: "AAPL" },
      subscriptions,
    );

    expect(contexts.get("user-a")).toEqual({
      hasPreviousJudgment: true,
      activeMonitoringRuleCount: 2,
    });
    expect(contexts.get("user-b")).toEqual({
      hasPreviousJudgment: false,
      activeMonitoringRuleCount: 0,
    });
    expect(database.queries.map((query) => query.selected)).toEqual([
      "id, user_id, filing_event_id, ticker",
      "id, user_id, ticker",
    ]);
    expect(database.queries.map((query) => query.selected).join(",")).not.toMatch(
      /summary|rationale|\bvalue\b/,
    );
  });

  it("falls back to empty context when optional context tables are unavailable", async () => {
    database.responses.set("user_filing_judgments", {
      data: null,
      error: { message: "schema cache stale" },
    });
    database.responses.set("user_company_monitoring_rules", {
      data: null,
      error: { message: "schema cache stale" },
    });

    const contexts = await loadFilingDecisionNotificationContexts(
      { id: "123e4567-e89b-42d3-a456-426614174000", ticker: "AAPL" },
      new Map([["user-a", { user_id: "user-a", ticker: "AAPL" }]]),
    );

    expect(contexts.get("user-a")).toEqual({
      hasPreviousJudgment: false,
      activeMonitoringRuleCount: 0,
    });
  });
});
