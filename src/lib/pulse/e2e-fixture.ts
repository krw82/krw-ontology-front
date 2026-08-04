import "server-only";

import { isDevAuthBypassEnabled } from "@/lib/dev-auth-server";
import { isProductionE2ERuntimeConfigured } from "@/lib/dev-auth-runtime";
import type { PulseFeedResponse, PulseItem } from "@/types/api-contracts";

const FIXTURE_TIMESTAMP = "2026-07-17T00:00:00.000Z";

/**
 * The production-build E2E runner executes before pending database migrations.
 * This fixture is therefore gated by both an explicit test flag and the same
 * request-scoped, loopback-only auth bypass used by the E2E server.
 */
export async function shouldUseStaticPulseE2EFixture(): Promise<boolean> {
  if (!isStaticPulseE2EFixtureConfigured()) return false;
  return isDevAuthBypassEnabled();
}

export function isStaticPulseE2EFixtureConfigured(): boolean {
  if (
    process.env.KRW_E2E_STATIC_PULSE !== "1" ||
    process.env.DEV_AUTH_BYPASS !== "1"
  ) {
    return false;
  }

  return (
    process.env.NODE_ENV !== "production" ||
    isProductionE2ERuntimeConfigured()
  );
}

export function createStaticPulseE2EFeed(): PulseFeedResponse {
  const item: PulseItem = {
    id: "ZmlsaW5nOmUyZS1maXh0dXJl",
    kind: "filing",
    feed_slot: "signal",
    server_rank: 0,
    trigger: "event",
    source_type: "filing",
    source_id: "00000000-0000-4000-8000-000000000001",
    ticker: "AAPL",
    coverage_level: "interest",
    judgment: null,
    linked_thesis: null,
    eyebrow: "8-K 새 공시 · E2E fixture",
    title: "AAPL 중요 공시에서 확인할 변화가 있습니다",
    body: "신규 중요 공시가 제출되었습니다. 원문 근거를 확인한 뒤 판단을 남길 수 있습니다.",
    reason_code: "e2e_fixture",
    reason_label: "관심 기업에 새 중요 공시가 제출되었습니다.",
    priority: "high",
    occurred_at: FIXTURE_TIMESTAMP,
    available_at: FIXTURE_TIMESTAMP,
    expires_at: null,
    reviewed_at: null,
    saved_at: null,
    snoozed_until: null,
    state: "new",
    actionable: true,
    phase: null,
    group_key: null,
    primary_action: {
      type: "link",
      label: "출처 보기",
      href: "/filings/00000000-0000-4000-8000-000000000001?source=pulse&ticker=AAPL",
    },
    secondary_actions: [],
    metadata: {
      development_showcase: true,
      form_type: "8-K",
      filing_brief_ready: true,
      filing_brief_fact_count: 2,
    },
  };

  return {
    revision: "p4.1.1.1",
    generated_at: FIXTURE_TIMESTAMP,
    snapshot_at: FIXTURE_TIMESTAMP,
    ranking_version: "rule_v5_flat",
    timezone: "Asia/Seoul",
    date_label: "7월 17일 금요일",
    filter: "all",
    active_analysis_items: [],
    completed_analysis_items: [],
    candidate_items: [item],
    visible_limit: 12,
    item_versions: {},
    new_item_count: 0,
    source_statuses: [
      { source: "filing", status: "ready", item_count: 1 },
      { source: "analysis", status: "empty", item_count: 0 },
      { source: "question", status: "empty", item_count: 0 },
      { source: "resurface", status: "empty", item_count: 0 },
      { source: "learning", status: "empty", item_count: 0 },
    ],
  };
}
