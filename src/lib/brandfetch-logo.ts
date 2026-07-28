import { normalizeTicker } from "@/lib/ontology/ticker";

const BRANDFETCH_LOGO_BASE_URL = "https://cdn.brandfetch.io";
const DEFAULT_LOGO_SIZE = 96;

export interface BrandfetchLogoOptions {
  clientId?: string | null;
  size?: number;
}

/**
 * Logos in this map are verified assets shipped with the application. Keep the
 * project-owned asset as the first choice when a third-party ticker endpoint
 * can return a generic or incorrect mark.
 */
const LOCAL_TICKER_LOGO_PATHS: Readonly<Record<string, string>> = {
  AAPL: "/company-logos/AAPL.png",
  AMZN: "/company-logos/AMZN.png",
  CVX: "/company-logos/CVX.png",
  JNJ: "/company-logos/JNJ.png",
  META: "/company-logos/META.png",
  MSFT: "/company-logos/MSFT.png",
  NVDA: "/company-logos/nvda.svg",
  TSLA: "/company-logos/TSLA.png",
  XOM: "/company-logos/XOM.png",
};

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

export function buildCompanyTickerLogoUrl(
  ticker: string,
  options: BrandfetchLogoOptions = {},
): string | null {
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker) return null;

  return (
    LOCAL_TICKER_LOGO_PATHS[normalizedTicker] ??
    buildBrandfetchTickerLogoUrl(normalizedTicker, options)
  );
}
