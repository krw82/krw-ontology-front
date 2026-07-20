import type { NextRequest } from "next/server";
import { getCompanyDisplayCopyForTicker } from "@/content/companies/display";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";
import { getIndexedCompanyBrowseCatalog } from "@/lib/ontology/catalog";
import { ServerTiming } from "@/lib/performance/server-timing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Connected company browsing is local-first in the client, then refreshed
 * through this small read model. The shared server cache remains keyed by the
 * active ontology release; the HTTP response itself is never shared between
 * accounts or browser sessions.
 */
export async function GET(request: NextRequest) {
  const timing = new ServerTiming();
  const requestedLocale = request.nextUrl.searchParams.get("locale");
  const locale = isLocale(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;

  try {
    const catalog = await timing.measure("catalog", () =>
      getIndexedCompanyBrowseCatalog(),
    );
    const payload = {
      release_id: catalog.release_id,
      generated_at: catalog.generated_at,
      companies: catalog.companies.map((company) => ({
        ...company,
        ...getCompanyDisplayCopyForTicker(locale, company.ticker),
      })),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;

    return Response.json(payload, {
      headers: timing.headers({
        "Cache-Control": "private, no-store",
        "X-Krw-Payload-Bytes": String(bytes),
      }),
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "internal_error",
          message: "회사 목록을 불러오지 못했습니다.",
        },
      },
      {
        status: 503,
        headers: timing.headers({ "Cache-Control": "private, no-store" }),
      },
    );
  }
}
