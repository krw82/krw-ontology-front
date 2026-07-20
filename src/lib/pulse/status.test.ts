import { describe, expect, it } from "vitest";
import { summarizePulseFeedStatus } from "@/lib/pulse/status";

describe("summarizePulseFeedStatus", () => {
  it("only reports whether the caller revision differs from the current private revision", () => {
    expect(summarizePulseFeedStatus({
      now: new Date("2026-07-17T00:00:00.000Z"),
      revision: "p3.8.4.123",
      knownRevision: "p3.8.4.122",
    })).toEqual({
      generated_at: "2026-07-17T00:00:00.000Z",
      revision: "p3.8.4.123",
      changed: true,
    });
  });

  it("does not turn an equal revision into a fake new-item count", () => {
    expect(summarizePulseFeedStatus({
      now: new Date("2026-07-17T00:00:00.000Z"),
      revision: "p3.8.4.123",
      knownRevision: "p3.8.4.123",
    }).changed).toBe(false);
  });
});
