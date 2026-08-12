/**
 * Return one deterministic page of a ticker list. The caller supplies a
 * monotonically increasing cycle number so scheduled workers rotate through
 * every page instead of repeatedly selecting the alphabetically first batch.
 */
export function selectTickerBatch<T>(
  items: readonly T[],
  batchSize: number,
  cycleNumber: number,
): T[] {
  if (items.length === 0 || batchSize <= 0) return [];

  const pageCount = Math.ceil(items.length / batchSize);
  const pageIndex = ((cycleNumber % pageCount) + pageCount) % pageCount;
  const start = pageIndex * batchSize;
  return items.slice(start, start + batchSize);
}
