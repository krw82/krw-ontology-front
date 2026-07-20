import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ontology/catalog", () => ({
  getIndexedCompanyBrowseCards: vi.fn(),
  getIndexedCompany: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import {
  getIndexedCompanyBrowseCards,
  getIndexedCompany,
} from "@/lib/ontology/catalog";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  getWatchlistCompanyDetail,
  listWatchlistOverview,
} from "@/lib/watchlist/workspace";

const MARK_AAPL = {
  user_id: "user-1",
  ticker: "AAPL",
  coverage_level: "holding",
  priority: 0,
  interest_reason: "서비스 매출과 자사주를 확인 중",
  tags: ["service", "buyback"],
  last_activity_at: null,
  created_at: "2026-06-01T00:00:00.000Z",
  updated_at: "2026-06-10T00:00:00.000Z",
};

const MARK_MSFT = {
  user_id: "user-1",
  ticker: "MSFT",
  coverage_level: "interest",
  priority: 0,
  interest_reason: null,
  tags: [],
  last_activity_at: "2026-06-11T00:00:00.000Z",
  created_at: "2026-06-02T00:00:00.000Z",
  updated_at: "2026-06-11T00:00:00.000Z",
};

const COMPANY_AAPL = {
  ticker: "AAPL",
  name: "Apple Inc.",
  sector: "Technology",
  description: "Apple filing coverage.",
  latest_period: "CY2026Q1",
  coverage: "2개 공시 인덱싱 · 10-Q",
  document_count: 2,
  document_types: ["10-Q"],
};

const COMPANY_MSFT = {
  ticker: "MSFT",
  name: "Microsoft Corporation",
  sector: "Technology",
  description: "Microsoft filing coverage.",
  latest_period: "CY2026Q1",
  coverage: "1개 공시 인덱싱 · 10-Q",
  document_count: 1,
  document_types: ["10-Q"],
};

function createAdmin() {
  const updates: Array<{ table: string; payload: unknown }> = [];

  const tableData = {
    user_company_marks: [MARK_AAPL, MARK_MSFT],
    user_company_questions: [
      {
        id: "10000000-0000-4000-8000-000000000001",
        user_id: "user-1",
        ticker: "AAPL",
        question: "서비스 매출 성장률은 유지되는가?",
        status: "open",
        source: "manual",
        source_chat_session_id: null,
        source_message_id: null,
        answered_at: null,
        visible_after_at: "2026-06-11T00:00:00.000Z",
        created_at: "2026-06-11T00:00:00.000Z",
        updated_at: "2026-06-12T00:00:00.000Z",
      },
      {
        id: "10000000-0000-4000-8000-000000000002",
        user_id: "user-1",
        ticker: "AAPL",
        question: "중국 수요 리스크는 완화됐는가?",
        status: "answered",
        source: "manual",
        source_chat_session_id: null,
        source_message_id: null,
        answered_at: "2026-06-12T00:00:00.000Z",
        visible_after_at: "2026-06-10T00:00:00.000Z",
        created_at: "2026-06-10T00:00:00.000Z",
        updated_at: "2026-06-12T12:00:00.000Z",
      },
      {
        id: "10000000-0000-4000-8000-000000000004",
        user_id: "user-1",
        ticker: "AAPL",
        question: "미래에 보여야 하는 자동 질문",
        status: "open",
        source: "saved_from_chat",
        source_chat_session_id: null,
        source_message_id: null,
        answered_at: null,
        visible_after_at: "2099-06-10T00:00:00.000Z",
        created_at: "2026-06-10T00:00:00.000Z",
        updated_at: "2026-06-12T12:00:00.000Z",
      },
      {
        id: "10000000-0000-4000-8000-000000000003",
        user_id: "user-1",
        ticker: "MSFT",
        question: "AI capex 효율은 유지되는가?",
        status: "open",
        source: "manual",
        source_chat_session_id: null,
        source_message_id: null,
        answered_at: null,
        visible_after_at: "2026-06-09T00:00:00.000Z",
        created_at: "2026-06-09T00:00:00.000Z",
        updated_at: "2026-06-09T00:00:00.000Z",
      },
    ],
    user_research_notes: [
      {
        id: "20000000-0000-4000-8000-000000000001",
        user_id: "user-1",
        ticker: "AAPL",
        title: "서비스 매출 점검",
        body: "서비스 매출과 마진을 확인했다.",
        note_type: "filing_check",
        tags: ["service"],
        source_chat_session_id: null,
        source_message_id: null,
        created_at: "2026-06-12T10:00:00.000Z",
        updated_at: "2026-06-12T10:00:00.000Z",
      },
    ],
    user_company_cards: [
      {
        id: "30000000-0000-4000-8000-000000000001",
        user_id: "user-1",
        ticker: "AAPL",
        title: "AAPL 종목 카드",
        summary: "서비스 매출과 자사주가 핵심 변수",
        content_md: "사업 구조",
        basis_release_id: null,
        basis_period: "CY2026Q1",
        basis_document_type: "10-Q",
        source_chat_session_id: null,
        source_message_id: null,
        created_at: "2026-06-12T09:00:00.000Z",
        updated_at: "2026-06-12T09:00:00.000Z",
      },
    ],
    user_company_notebooks: [
      {
        id: "31000000-0000-4000-8000-000000000001",
        user_id: "user-1",
        ticker: "AAPL",
        title: "AAPL 리서치 노트북",
        content_md: "# AAPL 리서치 노트북\n\n서비스 매출을 계속 본다.",
        previous_content_md: null,
        basis_release_id: null,
        basis_period: "CY2026Q1",
        last_source_chat_session_id: null,
        last_source_message_id: null,
        created_at: "2026-06-12T14:00:00.000Z",
        updated_at: "2026-06-12T14:00:00.000Z",
      },
    ],
    user_company_theses: [
      {
        id: "40000000-0000-4000-8000-000000000001",
        user_id: "user-1",
        ticker: "AAPL",
        title: "서비스 매출 방어력",
        thesis_text: "서비스 매출과 자사주가 EPS를 방어할 수 있는지 본다.",
        monitored_variables: ["서비스 매출", "FCF"],
        counter_evidence: "중국 수요 약화가 서비스 성장까지 번질 수 있다.",
        decision_change_condition: "서비스 성장률이 두 분기 연속 둔화하면 재검토한다.",
        status: "active",
        tags: ["service", "buyback"],
        archived_at: null,
        source_chat_session_id: null,
        source_message_id: null,
        created_at: "2026-06-12T08:00:00.000Z",
        updated_at: "2026-06-12T08:00:00.000Z",
      },
    ],
    user_thesis_checks: [
      {
        id: "50000000-0000-4000-8000-000000000001",
        thesis_id: "40000000-0000-4000-8000-000000000001",
        user_id: "user-1",
        ticker: "AAPL",
        result_status: "mixed",
        summary: "서비스 매출은 강화 요인, 중국 수요는 확인 필요.",
        strengthening_points: ["서비스 매출 안정성"],
        weakening_points: ["중국 수요"],
        neutral_points: [],
        next_questions: ["중국 수요가 회복되는가?"],
        basis_release_id: null,
        basis_period: "CY2026Q1",
        source_chat_session_id: null,
        source_message_id: null,
        created_at: "2026-06-13T00:00:00.000Z",
      },
    ],
    user_company_monitoring_rules: [],
    chat_sessions: [
      {
        id: "60000000-0000-4000-8000-000000000001",
        user_id: "user-1",
        title: "AAPL 서비스 매출",
        scope_type: "company",
        default_tickers: ["AAPL"],
        default_document_types: [],
        last_message_preview: "서비스 매출을 봐줘",
        last_message_at: "2026-06-12T11:00:00.000Z",
        latest_run_status: "completed",
        deleted_at: null,
        created_at: "2026-06-12T11:00:00.000Z",
        updated_at: "2026-06-12T11:00:00.000Z",
      },
      {
        id: "60000000-0000-4000-8000-000000000002",
        user_id: "user-1",
        title: "AAPL MSFT 비교",
        scope_type: "company",
        default_tickers: ["AAPL", "MSFT"],
        default_document_types: [],
        last_message_preview: "둘을 비교해줘",
        last_message_at: "2026-06-12T13:00:00.000Z",
        latest_run_status: "completed",
        deleted_at: null,
        created_at: "2026-06-12T13:00:00.000Z",
        updated_at: "2026-06-12T13:00:00.000Z",
      },
    ],
  };

  function rowsFor(
    table: keyof typeof tableData,
    selected: string | null,
    visibleAfterCutoff: string | null,
  ) {
    let rows = tableData[table] as Array<Record<string, unknown>>;
    if (visibleAfterCutoff) {
      rows = rows.filter((row) => {
        const visibleAfterAt = row.visible_after_at;
        return (
          typeof visibleAfterAt !== "string" ||
          visibleAfterAt <= visibleAfterCutoff
        );
      });
    }
    if (
      table === "user_company_questions" &&
      selected === "ticker,id,question,visible_after_at,created_at,updated_at"
    ) {
      return rows.filter((row) => row.status === "open");
    }
    if (table === "user_company_questions" && selected === "ticker") {
      return rows
        .filter((row) => row.status === "open")
        .map((row) => ({ ticker: row.ticker }));
    }
    if (table === "user_company_questions") {
      return rows.filter((row) => row.ticker === "AAPL");
    }
    if (table === "user_research_notes" && selected === "ticker") {
      return rows.map((row) => ({ ticker: row.ticker }));
    }
    if (table === "chat_sessions" && selected === "default_tickers") {
      return rows.map((row) => ({ default_tickers: row.default_tickers }));
    }
    return rows;
  }

  const admin = {
    from(table: keyof typeof tableData) {
      let selected: string | null = null;
      let updatePayload: unknown = null;
      let visibleAfterCutoff: string | null = null;

      const query = {
        select(value: string) {
          selected = value;
          return query;
        },
        eq() {
          return query;
        },
        lte(column: string, value: string) {
          if (column === "visible_after_at") visibleAfterCutoff = value;
          return query;
        },
        or() {
          return query;
        },
        is() {
          return query;
        },
        not() {
          return query;
        },
        in() {
          return query;
        },
        contains() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        update(payload: unknown) {
          updatePayload = payload;
          updates.push({ table, payload });
          return query;
        },
        returns() {
          return Promise.resolve({
            data: rowsFor(table, selected, visibleAfterCutoff),
            error: null,
          });
        },
        maybeSingle() {
          const rows = rowsFor(table, selected, visibleAfterCutoff);
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        then(resolve: (value: { data: null; error: null }) => void) {
          if (updatePayload === null) {
            throw new Error(`Unexpected awaited query for table ${table}`);
          }
          resolve({ data: null, error: null });
        },
      };

      return query;
    },
  } as unknown as ReturnType<typeof getSupabaseAdmin>;

  return { admin, updates };
}

function createEmptyDetailAdmin() {
  const updates: Array<{ table: string; payload: unknown }> = [];

  const admin = {
    from(table: string) {
      let updatePayload: unknown = null;
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        lte() {
          return query;
        },
        is() {
          return query;
        },
        contains() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        update(payload: unknown) {
          updatePayload = payload;
          updates.push({ table, payload });
          return query;
        },
        returns() {
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (value: { data: null; error: null }) => void) {
          if (updatePayload === null) {
            throw new Error(`Unexpected awaited query for table ${table}`);
          }
          resolve({ data: null, error: null });
        },
      };

      return query;
    },
  } as unknown as ReturnType<typeof getSupabaseAdmin>;

  return { admin, updates };
}

describe("watchlist workspace helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);
    vi.mocked(getIndexedCompanyBrowseCards).mockResolvedValue([
      COMPANY_AAPL,
      COMPANY_MSFT,
    ] as Awaited<ReturnType<typeof getIndexedCompanyBrowseCards>>);
    vi.mocked(getIndexedCompany).mockResolvedValue(
      COMPANY_AAPL as Awaited<ReturnType<typeof getIndexedCompany>>,
    );
  });

  it("aggregates personal research state for the watchlist overview", async () => {
    const overview = await listWatchlistOverview("user-1");

    expect(getIndexedCompanyBrowseCards).toHaveBeenCalledWith([
      "AAPL",
      "MSFT",
    ]);
    expect(overview.stats).toEqual({
      total: 2,
      interest: 1,
      holding: 1,
      open_questions: 2,
      notes: 1,
      recent_activity: 2,
    });
    expect(overview.research_inbox).toEqual([
      expect.objectContaining({
        ticker: "MSFT",
        reason: "empty_notebook",
        status: "empty",
      }),
      expect.objectContaining({
        ticker: "AAPL",
        reason: "open_questions",
        status: "has_open_questions",
        open_question_count: 1,
        current_question_id: "10000000-0000-4000-8000-000000000001",
        current_question: "서비스 매출 성장률은 유지되는가?",
        dismiss_question_id: "10000000-0000-4000-8000-000000000001",
        action_label: "이 질문으로 리서치",
        secondary_action_label: null,
      }),
    ]);
    expect(overview.companies[0]).toMatchObject({
      ticker: "AAPL",
      name: "Apple Inc.",
      open_question_count: 1,
      note_count: 1,
      recent_chat_count: 2,
      notebook_preview: "서비스 매출을 계속 본다.",
      research_status: "has_open_questions",
      research_status_reason: "open_questions",
      mark: {
        coverage_level: "holding",
        interest_reason: "서비스 매출과 자사주를 확인 중",
      },
    });
    expect(overview.companies[1]).toMatchObject({
      ticker: "MSFT",
      notebook_preview: "아직 작성된 리서치 노트가 없습니다.",
      research_status: "empty",
      research_status_reason: "empty_notebook",
    });
  });

  it("loads a complete company workspace and refreshes mark activity", async () => {
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const detail = await getWatchlistCompanyDetail("user-1", "aapl");

    expect(detail).toMatchObject({
      company: {
        ticker: "AAPL",
        open_question_count: 1,
        note_count: 1,
        recent_chat_count: 2,
      },
      card: {
        title: "AAPL 종목 카드",
        basis_period: "CY2026Q1",
      },
      notebook: {
        title: "AAPL 리서치 노트북",
        basis_period: "CY2026Q1",
      },
      theses: [{ title: "서비스 매출 방어력" }],
      thesis_checks: [{ result_status: "mixed" }],
      notes: [{ title: "서비스 매출 점검" }],
    });
    expect(detail?.recent_sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "AAPL 서비스 매출" }),
      ]),
    );
    expect(fake.updates).toContainEqual({
      table: "user_company_marks",
      payload: { last_activity_at: "2026-06-12T14:00:00.000Z" },
    });
  });

  it("does not turn an unsaved company workspace into epoch activity", async () => {
    const fake = createEmptyDetailAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const detail = await getWatchlistCompanyDetail("user-1", "aapl");

    expect(detail?.company.latest_activity_at).toBeNull();
    expect(detail?.company.mark).toMatchObject({
      coverage_level: null,
      last_activity_at: null,
    });
    expect(detail?.company).toMatchObject({
      research_status: "empty",
      research_status_reason: "empty_notebook",
    });
    expect(fake.updates).toEqual([]);
  });
});
