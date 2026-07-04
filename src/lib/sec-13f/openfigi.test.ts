import { describe, expect, it, vi } from "vitest";
import {
  fetchOpenFigiCusipMappings,
  getTickerForCusip,
  normalizeCusip,
} from "@/lib/sec-13f/openfigi";

describe("normalizeCusip", () => {
  it("normalizes valid CUSIP values", () => {
    expect(normalizeCusip(" 037833100 ")).toBe("037833100");
    expect(normalizeCusip("037-833-100")).toBe("037833100");
    expect(normalizeCusip("bad")).toBeNull();
  });
});

describe("fetchOpenFigiCusipMappings", () => {
  it("maps CUSIP values to OpenFIGI ticker metadata", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        "Content-Type": "application/json",
        "X-OPENFIGI-APIKEY": "test-key",
      });
      expect(JSON.parse(String(init?.body))).toEqual([
        { idType: "ID_CUSIP", idValue: "037833100", exchCode: "US" },
      ]);

      return Response.json([
        {
          data: [
            {
              figi: "BBG000B9XRY4",
              securityType: "Common Stock",
              marketSector: "Equity",
              ticker: "AAPL",
              name: "APPLE INC",
              exchCode: "US",
              shareClassFIGI: "BBG001S5N8V8",
              compositeFIGI: "BBG000B9XRY4",
              securityType2: "Common Stock",
              securityDescription: "AAPL",
            },
          ],
        },
      ]);
    });

    const [mapping] = await fetchOpenFigiCusipMappings(["037833100"], {
      apiKey: "test-key",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(mapping).toMatchObject({
      cusip: "037833100",
      ticker: "AAPL",
      name: "APPLE INC",
      exchCode: "US",
      providerStatus: "mapped",
    });
  });

  it("returns not_found for empty mapping results", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json([{ warning: "No identifier found." }]),
    );

    await expect(
      fetchOpenFigiCusipMappings(["000000000"], {
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        cusip: "000000000",
        ticker: null,
        providerStatus: "not_found",
      }),
    ]);
  });
});

describe("getTickerForCusip", () => {
  it("returns the first mapped ticker", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json([
        {
          data: [
            {
              ticker: "MSFT",
              name: "MICROSOFT CORP",
              exchCode: "US",
            },
          ],
        },
      ]),
    );

    await expect(
      getTickerForCusip("594918104", { fetchImpl: fetchImpl as typeof fetch }),
    ).resolves.toBe("MSFT");
  });
});
