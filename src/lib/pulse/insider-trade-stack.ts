import type { PulseItem, PulseItemState } from "@/types/api-contracts";

export interface PulseFeedItemEntry {
  type: "item";
  id: string;
  item: PulseItem;
  position: number;
  state: PulseItemState;
}

export interface PulseInsiderTradeStackEntry {
  type: "insider_trade_stack";
  id: string;
  group_key: string;
  /** Internal context only; it does not create a visible feed section. */
  feed_slot: "signal" | "discovery";
  items: Array<{ item: PulseItem; position: number }>;
  position: number;
  state: PulseItemState;
}

export type PulseFeedDisplayEntry = PulseFeedItemEntry | PulseInsiderTradeStackEntry;

/** The feed introduces a dense Form 4 set with only the three strongest rows. */
export const PULSE_INSIDER_FEATURED_ITEM_COUNT = 3;

/**
 * Keeps server ordering and pagination intact while presenting all regular
 * Form 4 filings in a single summary card. The first screen stays varied while
 * every underlying trade remains available from that one card.
 */
export function buildPulseFeedDisplayEntries(
  items: PulseItem[],
  timezone: string,
  displayLimit = Number.POSITIVE_INFINITY,
): PulseFeedDisplayEntry[] {
  const visibleItems = items
    .map((item, index) => ({ item, position: index + 1 }))
    // Protect an older device snapshot while it waits for the first server
    // refresh. New candidates are filtered at the filing source as well.
    .filter(({ item }) => isPulseFeedDisplayableItem(item));
  const regularForm4Items = visibleItems.filter(({ item }) => isRegularForm4(item));

  const stackByFirstItemId = new Map<string, PulseInsiderTradeStackEntry>();
  const groupedItemIds = new Set<string>();
  const feedAnchor = regularForm4Items[0];
  if (regularForm4Items.length >= 2 && feedAnchor) {
    const orderedItems = [...regularForm4Items].sort(compareInsiderTradeItems);
    const state = regularForm4Items.every(({ item }) => item.state === "reviewed")
      ? "reviewed"
      : regularForm4Items.some(({ item }) => item.state === "seen")
        ? "seen"
        : "new";
    const groupKey = insiderTradeSummaryKey(feedAnchor.item, timezone);
    stackByFirstItemId.set(feedAnchor.item.id, {
      type: "insider_trade_stack",
      id: `insider-stack:${groupKey}`,
      group_key: groupKey,
      feed_slot: summaryFeedSlot(orderedItems),
      items: orderedItems,
      position: feedAnchor.position,
      state,
    });
    for (const member of regularForm4Items) groupedItemIds.add(member.item.id);
  }

  const entries: PulseFeedDisplayEntry[] = [];
  visibleItems.forEach(({ item, position }) => {
    const stack = stackByFirstItemId.get(item.id);
    if (stack) {
      entries.push(stack);
      return;
    }
    if (groupedItemIds.has(item.id)) return;
    entries.push({ type: "item", id: item.id, item, position, state: item.state });
  });
  const limit = Number.isFinite(displayLimit)
    ? Math.max(0, Math.floor(displayLimit))
    : Number.POSITIVE_INFINITY;
  return entries.slice(0, limit);
}

export function isForm4(item: PulseItem): boolean {
  if (item.kind !== "filing") return false;
  const formType = String(item.metadata.form_type ?? "");
  return formType === "4" || formType === "4/A";
}

/** Urgent Form 4 filings remain independent cards so they cannot be buried. */
function isRegularForm4(item: PulseItem): boolean {
  return isForm4(item) && item.priority !== "urgent";
}

/** Form 4 records without an SEC-reported market P/S are not feed signals. */
export function isPulseFeedDisplayableItem(item: PulseItem): boolean {
  return !isForm4(item) || item.metadata.form4_has_reported_open_market_trade === true;
}

function insiderTradeSummaryKey(item: PulseItem, timezone: string): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(item.occurred_at));
  return `${day}:feed`;
}

function summaryFeedSlot(
  items: Array<{ item: PulseItem; position: number }>,
): "signal" | "discovery" {
  return items.some(({ item }) => item.feed_slot === "signal") ? "signal" : "discovery";
}

function compareInsiderTradeItems(
  left: { item: PulseItem; position: number },
  right: { item: PulseItem; position: number },
): number {
  const relevance = insiderTradeRelevance(right.item) - insiderTradeRelevance(left.item);
  if (relevance !== 0) return relevance;

  const value = reportedTradeValue(right.item) - reportedTradeValue(left.item);
  if (value !== 0) return value;

  const occurred = Date.parse(right.item.occurred_at) - Date.parse(left.item.occurred_at);
  if (occurred !== 0) return occurred;
  return left.position - right.position;
}

function insiderTradeRelevance(item: PulseItem): number {
  return Number(item.coverage_level === "interest") * 2
    + Number(item.metadata.has_recent_research === true);
}

function reportedTradeValue(item: PulseItem): number {
  return numberMetadata(item, "form4_reported_purchase_value")
    + numberMetadata(item, "form4_reported_sale_value");
}

function numberMetadata(item: PulseItem, key: string): number {
  const value = item.metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
