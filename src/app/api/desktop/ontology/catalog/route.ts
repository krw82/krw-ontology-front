import type { NextRequest } from "next/server";
import {
  authenticateDesktopRequest,
  requireDesktopFeatureAccess,
} from "@/lib/desktop/auth";
import { parsePositiveIntParam } from "@/lib/api/validation";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import { searchIndexedCompanies } from "@/lib/ontology/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateDesktopRequest(request);
    await requireDesktopFeatureAccess(auth, "evidence_research");
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() || undefined;
    const limit = parsePositiveIntParam(url.searchParams.get("limit"), 10, {
      max: 20,
    });
    const companies = await searchIndexedCompanies({ query, limit });

    return Response.json({
      ok: true,
      companies,
      count: companies.length,
    });
  } catch (error) {
    return handleDesktopApiError(error);
  }
}
