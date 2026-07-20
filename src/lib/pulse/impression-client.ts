const IMPRESSION_RETRY_DELAYS_MS = [0, 350, 1_000] as const;

export function pulseImpressionStorageKey(
  feedSessionId: string,
  itemKey: string,
): string {
  return `pulse-impression:${feedSessionId}:${itemKey}`;
}

/**
 * Persist the server-authoritative feed impression before locally suppressing
 * duplicates. A transient network failure must not make the later day-close
 * RPC reject an otherwise valid feed session.
 */
export async function persistPulseItemImpression(params: {
  itemId: string;
  feedSessionId: string;
  signal?: AbortSignal;
}): Promise<boolean> {
  return persistImpressionRequest({
    path: `/api/pulse/items/${encodeURIComponent(params.itemId)}`,
    body: {
      action: "impression",
      feed_session_id: params.feedSessionId,
    },
    signal: params.signal,
  });
}

export async function persistPulseItemImpressions(params: {
  itemIds: string[];
  feedSessionId: string;
  signal?: AbortSignal;
}): Promise<boolean> {
  const itemIds = [...new Set(params.itemIds)].slice(0, 20);
  if (itemIds.length === 0) return false;
  return persistImpressionRequest({
    path: "/api/pulse/impressions",
    body: {
      item_ids: itemIds,
      feed_session_id: params.feedSessionId,
    },
    signal: params.signal,
  });
}

async function persistImpressionRequest(params: {
  path: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<boolean> {
  for (const delayMs of IMPRESSION_RETRY_DELAYS_MS) {
    if (params.signal?.aborted) return false;
    if (delayMs > 0) {
      const continued = await waitForRetry(delayMs, params.signal);
      if (!continued) return false;
    }
    try {
      const response = await fetch(
        params.path,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params.body),
          signal: params.signal,
        },
      );
      if (response.ok) return true;
      // Authentication, validation, and not-found failures are deterministic;
      // retry only transient server failures and rate limiting.
      if (response.status < 500 && response.status !== 429) return false;
    } catch (error) {
      if (params.signal?.aborted) return false;
      if (error instanceof DOMException && error.name === "AbortError") {
        return false;
      }
    }
  }
  return false;
}

function waitForRetry(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (continued: boolean) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timerId);
      signal?.removeEventListener("abort", handleAbort);
      resolve(continued);
    };
    const handleAbort = () => finish(false);
    const timerId = globalThis.setTimeout(() => finish(true), ms);
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}
