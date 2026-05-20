import { NextRequest, NextResponse } from "next/server";
import {
  getIndexedCompany,
  listIndexedCompanies,
} from "@/lib/ontology/catalog";
import { getAuthUser, handleAuthError } from "@/lib/auth";

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
  const query = url.searchParams.get("q")?.trim().toLowerCase();

  if (ticker) {
    const company = await getIndexedCompany(ticker);
    return NextResponse.json({
      companies: company ? [company] : [],
      count: company ? 1 : 0,
    });
  }

  let companies = await listIndexedCompanies();

  if (query) {
    companies = companies.filter((company) =>
      [
        company.ticker,
        company.name,
        company.description,
        company.coverage,
        company.core_strength ?? "",
        company.critical_risk ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }

  return NextResponse.json({
    companies,
    count: companies.length,
  });
}
