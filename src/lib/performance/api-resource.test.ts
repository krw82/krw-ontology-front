import { describe, expect, it } from "vitest";
import { apiResourceMetricFromEntry } from "@/lib/performance/api-resource";

describe("api resource metrics", () => {
  it("keeps API timing and payload sizes without retaining an opaque identifier", () => {
    const metric = apiResourceMetricFromEntry(
      {
        name: "https://app.example.test/api/chat/123e4567-e89b-42d3-a456-426614174000?limit=50",
        initiatorType: "fetch",
        duration: 123.456,
        transferSize: 1200,
        encodedBodySize: 1000,
        decodedBodySize: 4200,
        serverTiming: [
          { name: "auth", duration: 12.34 },
          { name: "messages-runs", duration: 80.01 },
        ],
      },
      "https://app.example.test",
    );

    expect(metric).toEqual({
      apiPath: "/api/chat/:id",
      durationMs: 123.46,
      transferSizeBytes: 1200,
      encodedBodySizeBytes: 1000,
      decodedBodySizeBytes: 4200,
      serverTiming: { auth: 12.34, "messages-runs": 80.01 },
    });
  });

  it("does not measure analytics traffic or cross-origin resources", () => {
    expect(
      apiResourceMetricFromEntry(
        {
          name: "https://app.example.test/api/analytics/events",
          initiatorType: "fetch",
          duration: 10,
          transferSize: 10,
          encodedBodySize: 10,
          decodedBodySize: 10,
        },
        "https://app.example.test",
      ),
    ).toBeNull();
    expect(
      apiResourceMetricFromEntry(
        {
          name: "https://other.example.test/api/pulse",
          initiatorType: "fetch",
          duration: 10,
          transferSize: 10,
          encodedBodySize: 10,
          decodedBodySize: 10,
        },
        "https://app.example.test",
      ),
    ).toBeNull();
  });
});
