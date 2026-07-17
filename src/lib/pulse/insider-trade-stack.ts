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
  items: Array<{ item: PulseItem; position: number }>;
  position: number;
  state: PulseItemState;
}

export type PulseFeedDisplayEntry = PulseFeedItemEntry | PulseInsiderTradeStackEntry;

/**
 * Keeps server ordering and pagination intact while presenting repeated Form 4
 * filings as one card in the client. Groups never span a local calendar day or
 * the reviewed divider, so the visual summary remains truthful.
 */
export function buildPulseFeedDisplayEntries(
  items: PulseItem[],
  timezone: string,
): PulseFeedDisplayEntry[] {
  const candidatesByGroup = new Map<string, Array<{ item: PulseItem; position: number }>>();

  items.forEach((item, index) => {
    if (!isForm4(item)) return;
    const position = index + 1;
    const groupKey = insiderTradeGroupKey(item, timezone);
    const group = candidatesByGroup.get(groupKey) ?? [];
    group.push({ item, position });
    candidatesByGroup.set(groupKey, group);
  });

  const stackByFirstItemId = new Map<string, PulseInsiderTradeStackEntry>();
  const groupedItemIds = new Set<string>();
  for (const [groupKey, group] of candidatesByGroup) {
    if (group.length < 2) continue;
    const first = group[0];
    if (!first) continue;
    const state = first.item.state;
    stackByFirstItemId.set(first.item.id, {
      type: "insider_trade_stack",
      id: `insider-stack:${groupKey}`,
      group_key: groupKey,
      items: group,
      position: first.position,
      state,
    });
    for (const member of group) groupedItemIds.add(member.item.id);
  }

  const entries: PulseFeedDisplayEntry[] = [];
  items.forEach((item, index) => {
    const stack = stackByFirstItemId.get(item.id);
    if (stack) {
      entries.push(stack);
      return;
    }
    if (groupedItemIds.has(item.id)) return;
    entries.push({ type: "item", id: item.id, item, position: index + 1, state: item.state });
  });
  return entries;
}

export function isForm4(item: PulseItem): boolean {
  if (item.kind !== "filing") return false;
  const formType = String(item.metadata.form_type ?? "");
  return formType === "4" || formType === "4/A";
}

function insiderTradeGroupKey(item: PulseItem, timezone: string): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(item.occurred_at));
  const reviewBucket = item.state === "reviewed" ? "reviewed" : "open";
  return `${reviewBucket}:${day}`;
}
