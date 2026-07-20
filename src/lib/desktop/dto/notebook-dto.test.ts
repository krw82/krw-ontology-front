import { describe, expect, it } from "vitest";
import {
  toDesktopNotebookCompanyDetail,
  toDesktopNotebookOverview,
} from "./notebook-dto";

const mark = {
  user_id: "secret-user-id",
  ticker: "AAPL",
  coverage_status: "watching" as const,
  priority: 1,
  interest_reason: "Services",
  tags: ["quality"],
  last_activity_at: "2026-06-23T00:00:00.000Z",
  created_at: "2026-06-22T00:00:00.000Z",
  updated_at: "2026-06-23T00:00:00.000Z",
};

const company = {
  ticker: "AAPL",
  name: "Apple Inc.",
  companyNameKo: "애플",
  sector: "Technology",
  description: "Consumer technology company",
  latest_period: "FY2025",
  coverage: "10-K, 10-Q",
  document_count: 4,
  document_types: ["10-K"],
  notebook_preview: "서비스 매출 추적",
  mark,
  open_question_count: 1,
  note_count: 1,
  recent_chat_count: 2,
  latest_activity_at: "2026-06-23T00:00:00.000Z",
  research_status: "has_open_questions" as const,
  research_status_label: "질문 확인",
  research_status_reason: "open_questions" as const,
  notebook_updated_at: "2026-06-23T00:00:00.000Z",
  notebook_age_days: 0,
};

describe("Desktop notebook DTO", () => {
  it("replaces web hrefs with typed actions and removes account identifiers", () => {
    const result = toDesktopNotebookOverview({
      companies: [company],
      research_inbox: [
        {
          ticker: "AAPL",
          company_name: "애플",
          status: "has_open_questions",
          status_label: "질문 확인",
          reason: "open_questions",
          title: "서비스 성장 확인",
          description: "다음 질문",
          current_question_id: "question-1",
          current_question: "서비스 성장률은?",
          dismiss_question_id: "question-1",
          action_label: "질문하기",
          action_href: "/chat/new?ticker=AAPL",
          secondary_action_label: "닫기",
          secondary_action_href: "/watchlist/AAPL",
          priority: 1,
          age_days: 0,
          open_question_count: 1,
        },
      ],
      stats: {
        total: 1,
        exploring: 0,
        watching: 1,
        holding: 0,
        closed: 0,
        open_questions: 1,
        notes: 1,
        recent_activity: 1,
      },
    });

    expect(result.inbox[0].action).toEqual({
      type: "run_question",
      ticker: "AAPL",
      question_id: "question-1",
      question: "서비스 성장률은?",
    });
    expect(JSON.stringify(result)).not.toContain("secret-user-id");
    expect(JSON.stringify(result)).not.toContain("action_href");
    expect(JSON.stringify(result)).not.toContain("/chat/new");
  });

  it("removes web session and message ids from company detail", () => {
    const result = toDesktopNotebookCompanyDetail({
      company,
      notebook: {
        id: "notebook-1",
        user_id: "secret-user-id",
        ticker: "AAPL",
        title: "Apple notebook",
        content_md: "content",
        previous_content_md: "old",
        basis_release_id: "release-1",
        basis_period: "FY2025",
        last_source_chat_session_id: "web-session",
        last_source_message_id: "web-message",
        created_at: "2026-06-22T00:00:00.000Z",
        updated_at: "2026-06-23T00:00:00.000Z",
      },
      questions: [
        {
          id: "question-1",
          user_id: "secret-user-id",
          ticker: "AAPL",
          question: "서비스 성장률은?",
          status: "open",
          source: "saved_from_chat",
          source_chat_session_id: "web-session",
          source_message_id: "web-message",
          answered_at: null,
          visible_after_at: "2026-06-23T00:00:00.000Z",
          created_at: "2026-06-22T00:00:00.000Z",
          updated_at: "2026-06-23T00:00:00.000Z",
        },
      ],
      notes: [
        {
          id: "note-1",
          user_id: "secret-user-id",
          ticker: "AAPL",
          title: "메모",
          body: "본문",
          note_type: "manual",
          tags: [],
          source_chat_session_id: "web-session",
          source_message_id: "web-message",
          created_at: "2026-06-22T00:00:00.000Z",
          updated_at: "2026-06-23T00:00:00.000Z",
        },
      ],
      card: null,
      theses: [],
      thesis_checks: [],
      monitoring_rules: [],
      recent_sessions: [
        {
          id: "web-session",
          title: "Web research",
          scope_type: "company",
          default_tickers: ["AAPL"],
          last_message_preview: "preview",
          last_message_at: null,
          latest_run_status: null,
          created_at: "2026-06-22T00:00:00.000Z",
          updated_at: "2026-06-23T00:00:00.000Z",
        },
      ],
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret-user-id");
    expect(serialized).not.toContain("web-session");
    expect(serialized).not.toContain("web-message");
    expect(serialized).not.toContain("recent_sessions");
  });
});
