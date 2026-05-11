import { NextRequest, NextResponse } from "next/server";
import {
  getIndexedCompany,
  listIndexedCompanies,
} from "@/lib/ontology/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
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
