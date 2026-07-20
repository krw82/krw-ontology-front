import { describe, expect, it } from "vitest";
import { ServerTiming } from "./server-timing";

describe("ServerTiming", () => {
  it("emits measured work and total duration without unsafe metric names", async () => {
    const timing = new ServerTiming();
    await timing.measure("database/read", async () => "ok");

    const value = timing.headers().get("Server-Timing");
    expect(value).toContain("database_read;dur=");
    expect(value).toContain("total;dur=");
  });
});
