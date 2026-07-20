import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { makePulseItemKey, type PulseCandidate } from "@/lib/pulse/contract";
import type { Database } from "@/types/database";

export async function getQuestionCandidates(
  supabase: SupabaseClient<Database>,
  userId: string,
  now: Date,
): Promise<PulseCandidate[]> {
  const { data, error } = await supabase
    .from("user_company_questions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "open")
    .lte("visible_after_at", now.toISOString())
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  const remainingByTicker = new Map<string, number>();
  for (const question of data) {
    remainingByTicker.set(question.ticker, (remainingByTicker.get(question.ticker) ?? 0) + 1);
  }
  const seenTickers = new Set<string>();
  return data.flatMap((question) => {
    if (seenTickers.has(question.ticker)) return [];
    seenTickers.add(question.ticker);
    const params = new URLSearchParams({ ticker: question.ticker, query: question.question });
    return [{
      item_key: makePulseItemKey("question", question.id),
      kind: "question" as const,
      trigger: "state" as const,
      source_type: "question" as const,
      source_id: question.id,
      ticker: question.ticker,
      coverage_level: null,
      judgment: null,
      linked_thesis: null,
      eyebrow: "다음 질문",
      title: question.question,
      body: "답을 자동 생성하지 않습니다. 열면 질문이 입력된 상태에서 근거를 확인하고 직접 시작할 수 있습니다.",
      reason_code: "open_research_question",
      reason_label: `${question.ticker} 리서치 노트북에 남긴 열린 질문입니다.`,
      priority: "normal" as const,
      occurred_at: question.updated_at,
      available_at: question.visible_after_at,
      expires_at: null,
      saved_at: null,
      snoozed_until: null,
      group_key: `question:${question.ticker}`,
      primary_action: { type: "link" as const, label: "이 질문으로 리서치", href: `/chat/new?${params}` },
      secondary_actions: [
        { type: "mutation" as const, label: "질문 닫기", action: "dismiss" as const },
        { type: "mutation" as const, label: "내일 보기", action: "snooze" as const },
      ],
      metadata: {
        source: question.source,
        open_ticker_question_count: Math.max(0, (remainingByTicker.get(question.ticker) ?? 1) - 1),
      },
    }];
  });
}
