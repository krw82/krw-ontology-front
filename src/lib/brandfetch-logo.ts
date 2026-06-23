import { normalizeTicker } from "@/lib/ontology/ticker";

const BRANDFETCH_LOGO_BASE_URL = "https://cdn.brandfetch.io";
const DEFAULT_LOGO_SIZE = 96;

interface BrandfetchLogoOptions {
  clientId?: string | null;
  size?: number;
}

function normalizeClientId(clientId: string | null | undefined): string | null {
  const normalized = clientId?.trim();
  return normalized ? normalized : null;
}

function normalizeLogoSize(size: number | undefined): number {
  if (!Number.isFinite(size) || !size) return DEFAULT_LOGO_SIZE;
  return Math.min(Math.max(Math.round(size), 24), 256);
}

export function getBrandfetchClientId(): string | null {
  return normalizeClientId(process.env.NEXT_PUBLIC_BRANDFETCH_CLIENT_ID);
}

export function buildBrandfetchTickerLogoUrl(
  ticker: string,
  options: BrandfetchLogoOptions = {},
): string | null {
  const normalizedTicker = normalizeTicker(ticker);
  const clientId = normalizeClientId(
    options.clientId ?? getBrandfetchClientId(),
  );
  if (!normalizedTicker || !clientId) return null;

  const size = normalizeLogoSize(options.size);
  const encodedTicker = encodeURIComponent(normalizedTicker);
  const encodedClientId = encodeURIComponent(clientId);
  return `${BRANDFETCH_LOGO_BASE_URL}/ticker/${encodedTicker}/w/${size}/h/${size}/fallback/404/type/icon?c=${encodedClientId}`;
}
