import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getIndexedCompany,
  searchIndexedCompanies,
} from "@/lib/ontology/catalog";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { parsePositiveIntParam } from "@/lib/api/validation";
import { isDevAuthBypassEnabledForHost } from "@/lib/dev-auth-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const url = new URL(request.url);
  const ticker = url.searchParams.get("ticker");
  const query = url.searchParams.get("q")?.trim();
  const limit = parsePositiveIntParam(url.searchParams.get("limit"), 50, {
    max: 100,
  });

  if (shouldUseStaticE2ECatalog(url)) {
    const companies = staticE2ECompanies({ ticker, query, limit });
    return NextResponse.json({
      companies,
      count: companies.length,
    });
  }

  try {
    if (ticker) {
      const company = await getIndexedCompany(ticker);
      return NextResponse.json({
        companies: company ? [company] : [],
        count: company ? 1 : 0,
      });
    }

    const companies = await searchIndexedCompanies({ query, limit });
    return NextResponse.json({
      companies,
      count: companies.length,
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "internal_error" as const,
          message: "회사 목록을 불러오지 못했습니다.",
        },
      },
      { status: 500 },
    );
  }
}

function shouldUseStaticE2ECatalog(url: URL): boolean {
  return (
    process.env.KRW_E2E_STATIC_CATALOG === "1" &&
    isDevAuthBypassEnabledForHost(url.hostname)
  );
}

function staticE2ECompanies(input: {
  ticker: string | null;
  query: string | undefined;
  limit: number;
}) {
  const rows = [
    {
      ticker: "AMZN",
      name: "Amazon.com, Inc.",
      sector: "기술",
      description: "E2E static ontology coverage for Amazon.com, Inc.",
      latest_period: "FY2025",
      coverage: "1개 공시 인덱싱 · 10-K · 최신 FY2025",
      core_strength: "Cloud and marketplace scale",
      critical_risk: "Margin and consumer demand sensitivity",
      icon: "hub",
      document_count: 1,
      document_types: ["10-K"],
      periods: ["FY2025"],
      documents: [
        {
          period: "FY2025",
          document_type: "10-K",
          doc_type_key: "10K",
          generated_at: "2026-06-10T00:00:00.000Z",
        },
      ],
      generated_at: "2026-06-10T00:00:00.000Z",
    },
  ];

  if (input.ticker) {
    const normalized = input.ticker.trim().toUpperCase();
    return rows.filter((row) => row.ticker === normalized);
  }

  const normalizedQuery = input.query?.trim().toLowerCase();
  const filtered = normalizedQuery
    ? rows.filter((row) =>
        [row.ticker, row.name, row.description, row.sector]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : rows;
  return filtered.slice(0, input.limit);
}
