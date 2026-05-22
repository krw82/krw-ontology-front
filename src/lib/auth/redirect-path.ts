const SAFE_NEXT_ORIGIN = "https://krw-ontology.local";
const DEFAULT_NEXT_PATH = "/companies";
const MAX_NEXT_UNWRAP_DEPTH = 5;

export function normalizeInternalNextPath(
  value: string | null | undefined,
  fallback = DEFAULT_NEXT_PATH,
): string {
  let current = value;

  for (let depth = 0; depth < MAX_NEXT_UNWRAP_DEPTH; depth++) {
    if (!current || !current.startsWith("/") || current.startsWith("//")) {
      return fallback;
    }

    try {
      const url = new URL(current, SAFE_NEXT_ORIGIN);
      if (url.origin !== SAFE_NEXT_ORIGIN) return fallback;

      const nestedNext = url.searchParams.get("next");
      if (
        nestedNext &&
        (url.pathname === "/login" || url.pathname === "/auth/callback")
      ) {
        current = nestedNext;
        continue;
      }

      url.searchParams.delete("next");
      const query = url.searchParams.toString();
      return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
    } catch {
      return fallback;
    }
  }

  return fallback;
}
