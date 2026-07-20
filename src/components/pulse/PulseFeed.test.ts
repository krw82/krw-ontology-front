import { describe, expect, it } from "vitest";
import {
  applyPulseJudgment,
  applyPulseItemMutation,
  capturePulseItemSnapshot,
  rollbackPulseItemMutation,
} from "@/components/pulse/PulseFeed";
import {
  buildPulseDayCloseSummary,
  pulseDecisionSessionToSummary,
} from "@/components/pulse/PulseDayCloseCard";
import type { PulseFeedResponse, PulseItem } from "@/types/api-contracts";

const timestampA = "2026-07-17T01:00:00.000Z";
const timestampB = "2026-07-17T01:00:01.000Z";

function filing(id: string): PulseItem {
  return {
    id,
    kind: "filing",
    trigger: "event",
    source_type: "filing",
    source_id: id,
    ticker: id.toUpperCase(),
    coverage_status: "watching",
    judgment: null,
    linked_thesis: null,
    eyebrow: "새 공시",
    title: id,
    body: "body",
    reason_code: "test",
    reason_label: "test",
    priority: "normal",
    occurred_at: "2026-07-17T00:00:00.000Z",
    available_at: "2026-07-17T00:00:00.000Z",
    expires_at: null,
    reviewed_at: null,
    saved_at: null,
    snoozed_until: null,
    state: "new",
    actionable: true,
    phase: null,
    group_key: null,
    primary_action: { type: "link", label: "열기", href: "/" },
    secondary_actions: [],
    metadata: {},
  };
}

function feed(items: PulseItem[]): PulseFeedResponse {
  return {
    generated_at: "2026-07-17T00:00:00.000Z",
    snapshot_at: "2026-07-17T00:00:00.000Z",
    ranking_version: "rule_v3",
    timezone: "Asia/Seoul",
    date_label: "7월 17일",
    filter: "all",
    summary: {
      actionable_count: items.length,
      active_analysis_count: 0,
      counts: {
        filing: items.length,
        analysis: 0,
        question: 0,
        resurface: 0,
      },
      primary_action: null,
    },
    active_analysis_items: [],
    items,
    new_item_count: 0,
    source_statuses: [],
  };
}

describe("PulseFeed item-scoped optimistic rollback", () => {
  it("does not erase another item's successful review when one review fails", () => {
    const first = filing("first");
    const second = filing("second");
    const initial = feed([first, second]);
    const firstSnapshot = capturePulseItemSnapshot(initial, first.id);
    expect(firstSnapshot).not.toBeNull();

    const firstPending = applyPulseItemMutation(initial, first, "review", timestampA);
    const secondSucceeded = applyPulseItemMutation(
      firstPending,
      second,
      "review",
      timestampB,
    );
    const rolledBack = rollbackPulseItemMutation(
      secondSucceeded,
      firstSnapshot!,
      "review",
      timestampA,
    );

    expect(rolledBack.items[0]).toMatchObject({
      id: "first",
      reviewed_at: null,
      state: "new",
      actionable: true,
    });
    expect(rolledBack.items[1]).toMatchObject({
      id: "second",
      reviewed_at: timestampB,
      state: "reviewed",
      actionable: false,
    });
    expect(rolledBack.summary).toMatchObject({
      actionable_count: 1,
      counts: { filing: 1 },
    });
  });

  it("restores a dismissed item at its position without reverting another item", () => {
    const first = filing("first");
    const second = filing("second");
    const initial = feed([first, second]);
    const firstSnapshot = capturePulseItemSnapshot(initial, first.id);
    expect(firstSnapshot).not.toBeNull();

    const firstDismissed = applyPulseItemMutation(
      initial,
      first,
      "dismiss",
      timestampA,
    );
    const secondSucceeded = applyPulseItemMutation(
      firstDismissed,
      second,
      "review",
      timestampB,
    );
    const rolledBack = rollbackPulseItemMutation(
      secondSucceeded,
      firstSnapshot!,
      "dismiss",
      timestampA,
    );

    expect(rolledBack.items.map((item) => item.id)).toEqual(["first", "second"]);
    expect(rolledBack.items[1].reviewed_at).toBe(timestampB);
    expect(rolledBack.summary.actionable_count).toBe(1);
    expect(rolledBack.summary.counts.filing).toBe(1);
  });

  it("does not duplicate an item already restored by a fresher feed response", () => {
    const first = filing("first");
    const initial = feed([first]);
    const snapshot = capturePulseItemSnapshot(initial, first.id);
    expect(snapshot).not.toBeNull();

    const rolledBack = rollbackPulseItemMutation(
      initial,
      snapshot!,
      "dismiss",
      timestampA,
    );

    expect(rolledBack).toBe(initial);
    expect(rolledBack.items).toHaveLength(1);
  });

  it("completes a filing judgment and decrements the actionable summary once", () => {
    const initial = feed([filing("first"), filing("second")]);
    const completed = applyPulseJudgment(
      initial,
      "first",
      {
        id: "11111111-1111-4111-8111-111111111111",
        filing_event_id: "21111111-1111-4111-8111-111111111111",
        ticker: "FIRST",
        current_revision_id: "31111111-1111-4111-8111-111111111111",
        revision_number: 1,
        impact: "negative",
        next_action: "update_thesis",
        summary: "가설을 업데이트해야 합니다.",
        updated_at: timestampA,
      },
      timestampA,
    );

    expect(completed.items[0]).toMatchObject({
      id: "first",
      state: "reviewed",
      reviewed_at: timestampA,
      actionable: false,
      judgment: {
        impact: "negative",
        next_action: "update_thesis",
      },
    });
    expect(completed.items[1]).toMatchObject({
      id: "second",
      state: "new",
      actionable: true,
    });
    expect(completed.summary).toMatchObject({
      actionable_count: 1,
      counts: { filing: 1 },
    });

    const idempotent = applyPulseJudgment(
      completed,
      "first",
      {
        id: "11111111-1111-4111-8111-111111111111",
        filing_event_id: "21111111-1111-4111-8111-111111111111",
        ticker: "FIRST",
        current_revision_id: "41111111-1111-4111-8111-111111111111",
        revision_number: 2,
        impact: "positive",
        next_action: "complete",
        summary: "검토를 완료했습니다.",
        updated_at: timestampB,
      },
      timestampB,
    );
    expect(idempotent.summary.actionable_count).toBe(1);
    expect(idempotent.summary.counts.filing).toBe(1);
  });

  it("builds the finite-feed close summary only from feed state", () => {
    const first = filing("first");
    const second = filing("second");
    const third = filing("third");
    const fourth = filing("fourth");
    const withJudgments = feed([
      {
        ...first,
        state: "reviewed",
        actionable: false,
        judgment: judgment("update_thesis", 1),
      },
      {
        ...second,
        state: "reviewed",
        actionable: false,
        judgment: judgment("create_question", 2),
      },
      {
        ...third,
        state: "reviewed",
        actionable: false,
        judgment: judgment("review_later", 3),
      },
      fourth,
    ]);
    withJudgments.summary.actionable_count = 1;
    withJudgments.summary.active_analysis_count = 1;

    expect(buildPulseDayCloseSummary(withJudgments)).toEqual({
      judgmentCompleted: 3,
      observation: 1,
      thesisUpdates: 1,
      followUpQuestions: 1,
      nextChecks: 3,
    });
  });

  it("does not count an older judgment in today's close summary", () => {
    const oldJudgment = {
      ...judgment("complete", 1),
      updated_at: "2026-07-16T01:00:00.000Z",
    };
    const current = feed([
      {
        ...filing("old"),
        state: "reviewed",
        actionable: false,
        judgment: oldJudgment,
      },
    ]);
    current.summary.actionable_count = 0;

    expect(buildPulseDayCloseSummary(current).judgmentCompleted).toBe(0);
  });

  it("renders the persisted server-authoritative close totals after closing", () => {
    expect(pulseDecisionSessionToSummary({
      judgment_count: 4,
      observation_count: 1,
      thesis_update_count: 2,
      open_question_count: 3,
      next_check_count: 5,
    })).toEqual({
      judgmentCompleted: 4,
      observation: 1,
      thesisUpdates: 2,
      followUpQuestions: 3,
      nextChecks: 5,
    });
  });
});

function judgment(
  nextAction: NonNullable<PulseItem["judgment"]>["next_action"],
  revisionNumber: number,
): NonNullable<PulseItem["judgment"]> {
  return {
    id: `${revisionNumber}1111111-1111-4111-8111-111111111111`,
    filing_event_id: `${revisionNumber}2111111-1111-4111-8111-111111111111`,
    ticker: "TEST",
    current_revision_id: `${revisionNumber}3111111-1111-4111-8111-111111111111`,
    revision_number: revisionNumber,
    impact: "unclear",
    next_action: nextAction,
    summary: "테스트 판단",
    updated_at: timestampA,
  };
}
