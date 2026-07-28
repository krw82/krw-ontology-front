import type { PulseFeedDisplayEntry } from "@/lib/pulse/insider-trade-stack";
import type { PulseStoryContext } from "@/lib/pulse/device-ranking";
import type { PulseFeedResponse, PulseItem } from "@/types/api-contracts";

export interface PulseFeedViewMetrics {
  item_count: number;
  raw_item_count: number;
  display_entry_count: number;
  actionable_count: number;
  insider_stack_count: number;
  personal_signal_entry_count: number;
  discovery_entry_count: number;
}

/**
 * Analytics uses the cards the person could actually see, rather than the
 * server's raw candidate rows. This keeps a ten-row Form 4 stack from being
 * reported as ten independently viewed feed cards.
 */
export function buildPulseFeedViewMetrics(
  entries: PulseFeedDisplayEntry[],
  rawItems: PulseItem[],
): PulseFeedViewMetrics {
  const stacks = entries.filter((entry) => entry.type === "insider_trade_stack");
  const actionable = entries.filter((entry) => entry.type === "item"
    ? entry.item.actionable && !entry.item.reviewed_at
    : entry.items.some(({ item }) => item.actionable && !item.reviewed_at));
  const personalSignals = entries.filter((entry) => entry.type === "insider_trade_stack"
    ? entry.feed_slot === "signal"
    : entry.item.feed_slot === "signal");
  const discoveries = entries.filter((entry) => entry.type === "insider_trade_stack"
    ? entry.feed_slot === "discovery"
    : entry.item.feed_slot === "discovery");

  return {
    item_count: entries.length,
    raw_item_count: rawItems.length,
    display_entry_count: entries.length,
    actionable_count: actionable.length,
    insider_stack_count: stacks.length,
    personal_signal_entry_count: personalSignals.length,
    discovery_entry_count: discoveries.length,
  };
}

export function pulseViewProperties(
  feed: Pick<PulseFeedResponse, "ranking_version" | "active_analysis_items">,
  metrics: PulseFeedViewMetrics,
  options: {
    feedSessionId: string;
    entry: "first_value" | null;
    onboardingIntent: string | null;
    degradedSources: string[];
    storyContext?: PulseStoryContext;
  },
): Record<string, string | number | string[] | null> {
  return {
    feed_session_id: options.feedSessionId,
    ...metrics,
    active_analysis_count: feed.active_analysis_items.length,
    ranking_version: feed.ranking_version,
    entry: options.entry,
    onboarding_intent: options.onboardingIntent,
    degraded_sources: options.degradedSources,
    story_context: options.storyContext ?? "none",
  };
}
