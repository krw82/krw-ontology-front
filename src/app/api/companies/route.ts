import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import {
  getIndexedCompany,
  searchIndexedCompanies,
} from "@/lib/ontology/catalog";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { parsePositiveIntParam } from "@/lib/api/validation";

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
