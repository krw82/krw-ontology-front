import { describe, expect, it } from "vitest";
import {
  decodePulseCursor,
  encodeLegacyPulseCursor,
  encodePulseCursor,
} from "@/lib/pulse/cursor";

describe("pulse cursor", () => {
  it("round-trips a valid cursor", () => {
    const cursor = encodePulseCursor({
      version: 2,
      snapshot_at: "2026-07-15T00:00:00.000Z",
      filter: "all",
      boundary: {
        lane: 10,
        priority_rank: 1,
        holding_rank: 0,
        saved_rank: 1,
        occurred_at: "2026-07-15T00:00:00.000Z",
        item_key: "filing:1",
      },
    });

    expect(decodePulseCursor(cursor)).toEqual({
      version: 2,
      snapshot_at: "2026-07-15T00:00:00.000Z",
      filter: "all",
      boundary: {
        lane: 10,
        priority_rank: 1,
        holding_rank: 0,
        saved_rank: 1,
        occurred_at: "2026-07-15T00:00:00.000Z",
        item_key: "filing:1",
      },
    });
  });

  it("recognizes a legacy cursor for a graceful client reset and rejects malformed cursors", () => {
    expect(decodePulseCursor("not-base64-json")).toBeNull();
    const legacy = Buffer.from(
      JSON.stringify({
        version: 1,
        offset: 0,
        filter: "all",
        generated_at: new Date().toISOString(),
      }),
    ).toString("base64url");
    expect(decodePulseCursor(legacy)).toMatchObject({ version: 1, offset: 0 });
    const malformedV2 = Buffer.from(
      JSON.stringify({
        version: 2,
        filter: "all",
        snapshot_at: new Date().toISOString(),
      }),
    ).toString("base64url");
    expect(decodePulseCursor(malformedV2)).toBeNull();
  });

  it("keeps an offset cursor encoder only for the temporary legacy fallback", () => {
    const cursor = encodeLegacyPulseCursor({
      version: 1,
      offset: 20,
      filter: "filing",
      generated_at: "2026-07-15T00:00:00.000Z",
    });
    expect(decodePulseCursor(cursor)).toEqual({
      version: 1,
      offset: 20,
      filter: "filing",
      generated_at: "2026-07-15T00:00:00.000Z",
    });
  });
});
