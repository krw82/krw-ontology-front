import { describe, expect, it } from "vitest";
import {
  createPulseFeedRevision,
  matchesPulseFeedETag,
  pulseFeedETag,
} from "@/lib/pulse/revision";

describe("Pulse V3 revisions", () => {
  it("creates an opaque version from global, user, and temporal state", () => {
    expect(createPulseFeedRevision({
      globalRevision: 42.9,
      userRevision: 7,
      timeBucket: 123,
    })).toEqual({
      globalRevision: 42,
      userRevision: 7,
      timeBucket: 123,
      value: "p3.42.7.123",
    });
  });

  it("accepts exact and weak ETag validators but not a different private revision", () => {
    const revision = "p3.42.7.123";
    expect(pulseFeedETag(revision)).toBe('"p3.42.7.123"');
    expect(matchesPulseFeedETag('W/"p3.42.7.123", "elsewhere"', revision)).toBe(true);
    expect(matchesPulseFeedETag('"p3.42.7.122"', revision)).toBe(false);
  });
});
