import { describe, expect, it } from "vitest";
import { decodePulseCursor, encodePulseCursor } from "@/lib/pulse/cursor";

describe("pulse cursor", () => {
  it("round-trips a valid cursor", () => {
    const cursor = encodePulseCursor({
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

  it("rejects malformed and unsupported cursors", () => {
    expect(decodePulseCursor("not-base64-json")).toBeNull();
    const unsupported = Buffer.from(
      JSON.stringify({ version: 2, offset: 0, filter: "all", generated_at: new Date().toISOString() }),
    ).toString("base64url");
    expect(decodePulseCursor(unsupported)).toBeNull();
  });
});
