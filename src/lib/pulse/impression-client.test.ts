import { afterEach, describe, expect, it, vi } from "vitest";
import {
  persistPulseItemImpression,
  persistPulseItemImpressions,
  pulseImpressionStorageKey,
} from "./impression-client";

describe("Pulse impression persistence", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("scopes local duplicate suppression to the feed session", () => {
    expect(pulseImpressionStorageKey("session-a", "filing:1")).not.toBe(
      pulseImpressionStorageKey("session-b", "filing:1"),
    );
  });

  it("persists the exact item and feed session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      persistPulseItemImpression({
        itemId: "filing:abc/123",
        feedSessionId: "00000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pulse/items/filing%3Aabc%2F123",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          action: "impression",
          feed_session_id: "00000000-0000-4000-8000-000000000001",
        }),
      }),
    );
  });

  it("retries transient failures before reporting a durable impression", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = persistPulseItemImpression({
      itemId: "filing:1",
      feedSessionId: "00000000-0000-4000-8000-000000000001",
    });
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("persists a deduplicated visible stack in one request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(persistPulseItemImpressions({
      itemIds: ["filing-a", "filing-b", "filing-a"],
      feedSessionId: "00000000-0000-4000-8000-000000000001",
    })).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pulse/impressions",
      expect.objectContaining({
        body: JSON.stringify({
          item_ids: ["filing-a", "filing-b"],
          feed_session_id: "00000000-0000-4000-8000-000000000001",
        }),
      }),
    );
  });
});
