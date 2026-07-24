import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  queries: [] as Array<{
    table: string;
    filters: Array<{ method: string; column: string; value: unknown }>;
    limit: number | null;
  }>,
  responses: new Map<string, { data: unknown; error: { message: string } | null; count?: number | null }>(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const query = {
        table,
        filters: [] as Array<{ method: string; column: string; value: unknown }>,
        limit: null as number | null,
      };
      database.queries.push(query);
      const response = () => database.responses.get(table) ?? { data: [], error: null, count: null };
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          query.filters.push({ method: "eq", column, value });
          return builder;
        },
        neq: (column: string, value: unknown) => {
          query.filters.push({ method: "neq", column, value });
          return builder;
        },
        lte: (column: string, value: unknown) => {
          query.filters.push({ method: "lte", column, value });
          return builder;
        },
        order: () => builder,
        limit: (value: number) => {
          query.limit = value;
          return builder;
        },
        returns: () => Promise.resolve(response()),
        maybeSingle: () => Promise.resolve(response()),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(response()).then(resolve, reject),
      };
      return builder;
    },
  }),
}));

import {
  getCoverageState,
  getDecisionTimeline,
  listFilingJudgments,
  listOpenQuestions,
  PERSONAL_MCP_COVERAGE_COLLECTION_LIMIT,
  PERSONAL_MCP_LIST_MAX_LIMIT,
  PERSONAL_MCP_MAX_RESPONSE_BYTES,
  PERSONAL_MCP_MAX_RESPONSE_CHARS,
  serializePersonalMcpResult,
} from "./personal-filing-reader";

beforeEach(() => {
  database.queries.length = 0;
  database.responses.clear();
});

describe("personal filing reader user boundary", () => {
  it("scopes coverage, monitoring rules, and question count to one user and ticker", async () => {
    database.responses.set("user_company_marks", {
      data: { ticker: "AAPL", coverage_level: "interest" },
      error: null,
    });
    database.responses.set("user_company_monitoring_rules", {
      data: [{ id: "rule-1", ticker: "AAPL", enabled: true }],
      error: null,
    });
    database.responses.set("user_company_questions", { data: null, error: null, count: 2 });

    const result = await getCoverageState("user-a", { ticker: " aapl " });

    expect(result).toMatchObject({
      scope: "personal",
      ticker: "AAPL",
      open_question_count: 2,
    });
    expectEveryQueryScopedTo("user-a", "AAPL");
  });

  it("lists current personal judgments without widening the user filter", async () => {
    const filingEventId = "123e4567-e89b-42d3-a456-426614174000";
    database.responses.set("user_filing_judgment_revisions", {
      data: [{
        id: "revision-1",
        judgment_id: "judgment-1",
        filing_event_id: filingEventId,
        ticker: "AAPL",
        is_current: true,
        summary: "내 판단",
      }],
      error: null,
    });

    const result = await listFilingJudgments("user-a", {
      ticker: "aapl",
      filingEventId,
    });

    expect(result.scope).toBe("personal");
    expect(result.items).toHaveLength(1);
    expect(database.queries[0]?.filters).toEqual(expect.arrayContaining([
      { method: "eq", column: "user_id", value: "user-a" },
      { method: "eq", column: "is_current", value: true },
      { method: "eq", column: "ticker", value: "AAPL" },
      { method: "eq", column: "filing_event_id", value: filingEventId },
    ]));
  });

  it("combines only user-scoped decision sources in chronological order", async () => {
    database.responses.set("user_filing_judgment_revisions", {
      data: [{ id: "j", created_at: "2026-07-18T03:00:00.000Z" }],
      error: null,
    });
    database.responses.set("user_company_questions", {
      data: [{ id: "q", created_at: "2026-07-18T01:00:00.000Z" }],
      error: null,
    });
    database.responses.set("user_thesis_checks", {
      data: [{ id: "t", created_at: "2026-07-18T02:00:00.000Z" }],
      error: null,
    });

    const result = await getDecisionTimeline("user-a", { ticker: "AAPL" });

    expect(result.items.map((item) => item.id)).toEqual(["j", "t", "q"]);
    expectEveryQueryScopedTo("user-a", "AAPL");
  });

  it("keeps an unfiltered question list user-scoped", async () => {
    database.responses.set("user_company_questions", { data: [], error: null });
    await listOpenQuestions("user-a", {});
    expect(database.queries[0]?.filters).toEqual(expect.arrayContaining([
      { method: "eq", column: "user_id", value: "user-a" },
      { method: "eq", column: "status", value: "open" },
    ]));
  });

  it("rejects an invalid ticker before making a database query", async () => {
    await expect(getCoverageState("user-a", { ticker: "../../all-users" })).rejects.toMatchObject({
      code: "invalid_ticker",
    });
    expect(database.queries).toHaveLength(0);
  });

  it("caps list rows, fetches one sentinel row, and marks long judgment fields", async () => {
    database.responses.set("user_filing_judgment_revisions", {
      data: Array.from({ length: PERSONAL_MCP_LIST_MAX_LIMIT + 1 }, (_, index) => ({
        id: `revision-${index}`,
        judgment_id: `judgment-${index}`,
        filing_event_id: "123e4567-e89b-42d3-a456-426614174000",
        ticker: "AAPL",
        revision_number: 1,
        impact: "unclear",
        next_action: "review_later",
        summary: "요".repeat(1_000),
        rationale: "근거".repeat(2_000),
        is_current: true,
        created_at: `2026-07-18T00:00:${String(index).padStart(2, "0")}.000Z`,
      })),
      error: null,
    });

    const result = await listFilingJudgments("user-a", { limit: 999 });

    expect(result.items).toHaveLength(PERSONAL_MCP_LIST_MAX_LIMIT);
    expect(result.pagination).toEqual({
      limit: PERSONAL_MCP_LIST_MAX_LIMIT,
      returned_count: PERSONAL_MCP_LIST_MAX_LIMIT,
      has_more: true,
    });
    expect(result.items[0]?.truncated_fields).toEqual(["summary", "rationale"]);
    expect(result.items[0]?.summary).toMatch(/\[TRUNCATED\]$/);
    expect(result.items[0]?.rationale).toMatch(/\[TRUNCATED\]$/);
    expect(result.truncation).toMatchObject({
      fields_truncated: true,
      truncated_field_count: PERSONAL_MCP_LIST_MAX_LIMIT * 2,
      response_truncated: false,
    });
    expect(database.queries[0]?.limit).toBe(PERSONAL_MCP_LIST_MAX_LIMIT + 1);
  });

  it("bounds coverage collections and marks each truncated thesis field", async () => {
    database.responses.set("user_company_marks", {
      data: {
        ticker: "AAPL",
        coverage_level: "interest",
        interest_reason: "관심 이유".repeat(300),
        tags: ["x".repeat(100)],
      },
      error: null,
    });
    database.responses.set("user_company_monitoring_rules", {
      data: Array.from(
        { length: PERSONAL_MCP_COVERAGE_COLLECTION_LIMIT + 1 },
        (_, index) => ({ id: `rule-${index}`, ticker: "AAPL", value: "v".repeat(500) }),
      ),
      error: null,
    });
    database.responses.set("user_company_questions", { data: null, error: null, count: 1 });
    database.responses.set("user_company_theses", {
      data: Array.from(
        { length: PERSONAL_MCP_COVERAGE_COLLECTION_LIMIT + 1 },
        (_, index) => ({
          id: `thesis-${index}`,
          ticker: "AAPL",
          title: "제목".repeat(300),
          thesis_text: "가설".repeat(1_200),
          monitored_variables: ["변수".repeat(200)],
          counter_evidence: "반대근거".repeat(500),
          decision_change_condition: "변경조건".repeat(400),
          status: "active",
          updated_at: "2026-07-18T00:00:00.000Z",
        }),
      ),
      error: null,
    });

    const result = await getCoverageState("user-a", { ticker: "AAPL" });

    expect(result.active_monitoring_rules).toHaveLength(
      PERSONAL_MCP_COVERAGE_COLLECTION_LIMIT,
    );
    expect(result.active_theses).toHaveLength(PERSONAL_MCP_COVERAGE_COLLECTION_LIMIT);
    expect(result.collections.active_monitoring_rules.has_more).toBe(true);
    expect(result.collections.active_theses.has_more).toBe(true);
    expect(result.coverage?.truncated_fields).toEqual(["interest_reason", "tags"]);
    expect(result.active_theses[0]?.truncated_fields).toEqual([
      "title",
      "thesis_text",
      "monitored_variables",
      "counter_evidence",
      "decision_change_condition",
    ]);
    expect(result.truncation.fields_truncated).toBe(true);
  });

  it("enforces both character and UTF-8 byte caps on the final personal payload", () => {
    const serialized = serializePersonalMcpResult({
      scope: "personal",
      items: Array.from({ length: 12 }, (_, index) => ({
        id: `item-${index}`,
        body: "한".repeat(12_000),
      })),
      pagination: { limit: 12, returned_count: 12, has_more: false },
      truncation: {
        fields_truncated: false,
        truncated_field_count: 0,
        response_truncated: false,
        dropped_item_count: 0,
        max_response_chars: PERSONAL_MCP_MAX_RESPONSE_CHARS,
        max_response_bytes: PERSONAL_MCP_MAX_RESPONSE_BYTES,
      },
    });
    const parsed = JSON.parse(serialized) as {
      items: unknown[];
      pagination: { returned_count: number; has_more: boolean };
      truncation: { response_truncated: boolean; dropped_item_count: number };
    };

    expect(serialized.length).toBeLessThanOrEqual(PERSONAL_MCP_MAX_RESPONSE_CHARS);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(
      PERSONAL_MCP_MAX_RESPONSE_BYTES,
    );
    expect(parsed.items.length).toBeLessThan(12);
    expect(parsed.pagination).toMatchObject({
      returned_count: parsed.items.length,
      has_more: true,
    });
    expect(parsed.truncation.response_truncated).toBe(true);
    expect(parsed.truncation.dropped_item_count).toBeGreaterThan(0);
  });
});

function expectEveryQueryScopedTo(userId: string, ticker: string): void {
  expect(database.queries.length).toBeGreaterThan(0);
  for (const query of database.queries) {
    expect(query.filters).toEqual(expect.arrayContaining([
      { method: "eq", column: "user_id", value: userId },
      { method: "eq", column: "ticker", value: ticker },
    ]));
  }
}
