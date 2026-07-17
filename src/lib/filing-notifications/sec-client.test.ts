import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSecText } from "@/lib/filing-notifications/sec-client";

const SEC_URL = "https://www.sec.gov/Archives/edgar/data/320193/example-index.html";
const originalUserAgent = process.env.SEC_USER_AGENT;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalUserAgent === undefined) delete process.env.SEC_USER_AGENT;
  else process.env.SEC_USER_AGENT = originalUserAgent;
});

describe("SEC client", () => {
  it("retries a transient network failure before returning the SEC response", async () => {
    process.env.SEC_USER_AGENT = "KRW Ontology Filing Alerts hello@krwontology.com";
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("index", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSecText(SEC_URL)).resolves.toBe("index");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-transient SEC response", async () => {
    process.env.SEC_USER_AGENT = "KRW Ontology Filing Alerts hello@krwontology.com";
    const fetchMock = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSecText(SEC_URL)).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds on-demand document text before it can be retained in memory", async () => {
    process.env.SEC_USER_AGENT = "KRW Ontology Filing Alerts hello@krwontology.com";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("long-document", { status: 200 })));

    await expect(fetchSecText(SEC_URL, 10_000, { maxBytes: 4 })).rejects.toMatchObject({
      status: 413,
      code: "response_too_large",
    });
  });
});
