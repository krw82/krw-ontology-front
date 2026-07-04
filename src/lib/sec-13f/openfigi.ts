import "server-only";

export type OpenFigiProviderStatus = "mapped" | "not_found" | "error";

export interface OpenFigiCusipMapping {
  cusip: string;
  ticker: string | null;
  name: string | null;
  exchCode: string | null;
  figi: string | null;
  compositeFigi: string | null;
  shareClassFigi: string | null;
  marketSector: string | null;
  securityType: string | null;
  securityType2: string | null;
  securityDescription: string | null;
  providerStatus: OpenFigiProviderStatus;
  rawResponse: unknown;
}

export interface FetchOpenFigiCusipMappingsOptions {
  apiKey?: string | null;
  batchSize?: number;
  exchCode?: string;
  fetchImpl?: typeof fetch;
}

const OPENFIGI_MAPPING_URL = "https://api.openfigi.com/v3/mapping";
const OPENFIGI_ID_TYPE_CUSIP = "ID_CUSIP";
const OPENFIGI_MAX_JOBS_WITH_KEY = 100;
const OPENFIGI_MAX_JOBS_WITHOUT_KEY = 5;

interface OpenFigiApiSecurity {
  figi?: unknown;
  securityType?: unknown;
  marketSector?: unknown;
  ticker?: unknown;
  name?: unknown;
  exchCode?: unknown;
  shareClassFIGI?: unknown;
  compositeFIGI?: unknown;
  securityType2?: unknown;
  securityDescription?: unknown;
}

interface OpenFigiApiJobResult {
  data?: unknown;
  error?: unknown;
  warning?: unknown;
}

export function normalizeCusip(value: string): string | null {
  const normalized = value.trim().replace(/[^a-z0-9]/gi, "").toUpperCase();
  return /^[A-Z0-9]{9}$/.test(normalized) ? normalized : null;
}

export async function fetchOpenFigiCusipMappings(
  cusips: string[],
  options: FetchOpenFigiCusipMappingsOptions = {},
): Promise<OpenFigiCusipMapping[]> {
  const normalizedCusips = Array.from(
    new Set(cusips.map((cusip) => normalizeCusip(cusip)).filter(Boolean)),
  ) as string[];
  if (normalizedCusips.length === 0) return [];

  const apiKey = options.apiKey ?? process.env.OPENFIGI_API_KEY ?? null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const exchCode = options.exchCode ?? "US";
  const defaultBatchSize = apiKey
    ? OPENFIGI_MAX_JOBS_WITH_KEY
    : OPENFIGI_MAX_JOBS_WITHOUT_KEY;
  const batchSize = Math.max(
    1,
    Math.min(options.batchSize ?? defaultBatchSize, defaultBatchSize),
  );
  const mappings: OpenFigiCusipMapping[] = [];

  for (let offset = 0; offset < normalizedCusips.length; offset += batchSize) {
    const batch = normalizedCusips.slice(offset, offset + batchSize);
    const response = await fetchImpl(OPENFIGI_MAPPING_URL, {
      method: "POST",
      headers: openFigiHeaders(apiKey),
      body: JSON.stringify(
        batch.map((cusip) => ({
          idType: OPENFIGI_ID_TYPE_CUSIP,
          idValue: cusip,
          exchCode,
        })),
      ),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `OpenFIGI mapping failed ${response.status}: ${body.slice(0, 200)}`,
      );
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error("OpenFIGI mapping returned a non-array response.");
    }

    payload.forEach((jobResult, index) => {
      const cusip = batch[index];
      if (cusip) mappings.push(mapJobResult(cusip, jobResult, exchCode));
    });
  }

  return mappings;
}

export async function getTickerForCusip(
  cusip: string,
  options: FetchOpenFigiCusipMappingsOptions = {},
): Promise<string | null> {
  const [mapping] = await fetchOpenFigiCusipMappings([cusip], options);
  return mapping?.providerStatus === "mapped" ? mapping.ticker : null;
}

function openFigiHeaders(apiKey: string | null): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { "X-OPENFIGI-APIKEY": apiKey } : {}),
  };
}

function mapJobResult(
  cusip: string,
  jobResult: unknown,
  preferredExchangeCode: string,
): OpenFigiCusipMapping {
  const result = objectValue(jobResult) as OpenFigiApiJobResult | null;
  const data = Array.isArray(result?.data) ? result.data : [];
  const security = selectSecurity(data, preferredExchangeCode);
  if (!security) {
    return {
      cusip,
      ticker: null,
      name: null,
      exchCode: null,
      figi: null,
      compositeFigi: null,
      shareClassFigi: null,
      marketSector: null,
      securityType: null,
      securityType2: null,
      securityDescription: null,
      providerStatus: result?.error ? "error" : "not_found",
      rawResponse: jobResult,
    };
  }

  return {
    cusip,
    ticker: stringValue(security.ticker),
    name: stringValue(security.name),
    exchCode: stringValue(security.exchCode),
    figi: stringValue(security.figi),
    compositeFigi: stringValue(security.compositeFIGI),
    shareClassFigi: stringValue(security.shareClassFIGI),
    marketSector: stringValue(security.marketSector),
    securityType: stringValue(security.securityType),
    securityType2: stringValue(security.securityType2),
    securityDescription: stringValue(security.securityDescription),
    providerStatus: "mapped",
    rawResponse: jobResult,
  };
}

function selectSecurity(
  data: unknown[],
  preferredExchangeCode: string,
): OpenFigiApiSecurity | null {
  const securities = data
    .map((item) => objectValue(item) as OpenFigiApiSecurity | null)
    .filter((item): item is OpenFigiApiSecurity => Boolean(item));
  return (
    securities.find(
      (security) =>
        stringValue(security.exchCode) === preferredExchangeCode &&
        Boolean(stringValue(security.ticker)),
    ) ??
    securities.find((security) => Boolean(stringValue(security.ticker))) ??
    securities[0] ??
    null
  );
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
