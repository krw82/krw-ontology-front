import type { PulseFeedSummary, PulseLinkAction } from "@/types/api-contracts";
import type { PulseRankedCandidate } from "@/lib/pulse/contract";

/**
 * The summary is deliberately derived from final visible candidates, never from
 * raw source output. That keeps the header count, CTA, and rendered list honest.
 */
export function buildPulseSummary(
  ranked: PulseRankedCandidate[],
): PulseFeedSummary {
  const actionable = ranked.filter((item) => item.actionable && !item.reviewed_at);
  const activeAnalysis = ranked.filter((item) => item.kind === "analysis" && item.phase === "active");

  return {
    actionable_count: actionable.length,
    active_analysis_count: activeAnalysis.length,
    counts: {
      filing: count(actionable, "filing"),
      analysis: actionable.filter((item) => item.kind === "analysis" && item.phase !== "active").length,
      question: count(actionable, "question"),
      resurface: count(actionable, "resurface"),
    },
    primary_action: toLinkAction(actionable[0]?.primary_action),
  };
}

function count(items: PulseRankedCandidate[], kind: PulseRankedCandidate["kind"]): number {
  return items.filter((item) => item.kind === kind).length;
}

function toLinkAction(
  action: PulseRankedCandidate["primary_action"] | undefined,
): PulseLinkAction | null {
  return action?.type === "link" ? action : null;
}
