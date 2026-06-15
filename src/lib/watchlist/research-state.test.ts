import { describe, expect, it } from "vitest";
import {
  buildResearchInbox,
  buildResearchState,
  isNotebookEmpty,
} from "@/lib/watchlist/research-state";

const NOW = new Date("2026-06-15T00:00:00.000Z");
const EMPTY_AAPL_NOTEBOOK = [
  "## 내가 보고 있는 이유",
  "- 왜 이 종목을 계속 보고 있는지.",
  "",
  "## 긍정 논리",
  "- 이 회사가 좋아질 수 있다고 보는 이유.",
  "- 현재 생각을 지지하는 근거.",
  "",
  "## 반대 논리",
  "- 내 생각이 틀릴 수 있는 이유.",
  "- 시장이 우려할 만한 지점.",
  "",
  "## 생각이 바뀔 수 있는 신호",
  "- 어떤 일이 생기면 기존 생각을 다시 봐야 하는지.",
].join("\n");

describe("watchlist research state", () => {
  it("treats a missing notebook as empty", () => {
    expect(
      buildResearchState({
        ticker: "AAPL",
        notebook: null,
        openQuestionCount: 0,
        now: NOW,
      }),
    ).toMatchObject({
      status: "empty",
      reason: "empty_notebook",
      status_label: "비어 있음",
    });
  });

  it("treats the default notebook template as empty", () => {
    expect(
      isNotebookEmpty(
        "AAPL",
        EMPTY_AAPL_NOTEBOOK,
      ),
    ).toBe(true);
  });

  it("prioritizes empty notebooks over open questions", () => {
    expect(
      buildResearchState({
        ticker: "AAPL",
        notebook: {
          content_md: EMPTY_AAPL_NOTEBOOK,
          updated_at: "2026-06-14T00:00:00.000Z",
        },
        openQuestionCount: 3,
        now: NOW,
      }),
    ).toMatchObject({
      status: "empty",
      reason: "empty_notebook",
      notebook_age_days: 1,
    });
  });

  it("marks a non-empty notebook with open questions", () => {
    expect(
      buildResearchState({
        ticker: "GOOGL",
        notebook: {
          content_md: "# GOOGL 리서치 노트북\n\nAI capex를 확인 중.",
          updated_at: "2026-06-12T00:00:00.000Z",
        },
        openQuestionCount: 2,
        now: NOW,
      }),
    ).toMatchObject({
      status: "has_open_questions",
      reason: "open_questions",
      status_label: "열린 질문 있음",
    });
  });

  it("marks a non-empty notebook as stale after the threshold", () => {
    expect(
      buildResearchState({
        ticker: "MU",
        notebook: {
          content_md: "# MU 리서치 노트북\n\nHBM 수요를 확인 중.",
          updated_at: "2026-05-01T00:00:00.000Z",
        },
        openQuestionCount: 0,
        now: NOW,
      }),
    ).toMatchObject({
      status: "stale",
      reason: "stale_notebook",
      notebook_age_days: 45,
    });
  });

  it("returns ready when the notebook is recent and no questions are open", () => {
    expect(
      buildResearchState({
        ticker: "MSFT",
        notebook: {
          content_md: "# MSFT 리서치 노트북\n\nAzure 성장률을 확인 중.",
          updated_at: "2026-06-01T00:00:00.000Z",
        },
        openQuestionCount: 0,
        now: NOW,
      }),
    ).toMatchObject({
      status: "ready",
      reason: null,
      status_label: "정리됨",
      notebook_age_days: 14,
    });
  });

  it("builds a priority-sorted calculated inbox", () => {
    const inbox = buildResearchInbox([
      {
        ticker: "MU",
        company_name: "Micron",
        status: "stale",
        status_label: "오래됨",
        reason: "stale_notebook",
        notebook_updated_at: "2026-05-01T00:00:00.000Z",
        notebook_age_days: 45,
        open_question_count: 0,
      },
      {
        ticker: "AAPL",
        company_name: "Apple",
        status: "empty",
        status_label: "비어 있음",
        reason: "empty_notebook",
        notebook_updated_at: null,
        notebook_age_days: null,
        open_question_count: 0,
      },
      {
        ticker: "GOOGL",
        company_name: "Alphabet",
        status: "has_open_questions",
        status_label: "열린 질문 있음",
        reason: "open_questions",
        notebook_updated_at: "2026-06-12T00:00:00.000Z",
        notebook_age_days: 3,
        open_question_count: 2,
        current_question_id: "10000000-0000-4000-8000-000000000001",
        current_question: "Services 성장률은 유지되는가?",
      },
    ]);

    expect(inbox.map((item) => item.reason)).toEqual([
      "empty_notebook",
      "open_questions",
      "stale_notebook",
    ]);
    expect(inbox[1]).toMatchObject({
      title: "Services 성장률은 유지되는가?",
      description: "",
      action_label: "이 질문으로 리서치",
      action_href:
        "/chat/new?ticker=GOOGL&query=Services+%EC%84%B1%EC%9E%A5%EB%A5%A0%EC%9D%80+%EC%9C%A0%EC%A7%80%EB%90%98%EB%8A%94%EA%B0%80%3F",
      secondary_action_label: null,
      dismiss_question_id: "10000000-0000-4000-8000-000000000001",
    });
  });
});
