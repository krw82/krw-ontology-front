import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { checkMcpHealth } from "@/lib/agent/mcp-client";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function GET(request: NextRequest) {
  const internalKey = request.headers.get("x-internal-key") ?? "";
  const expectedKey = process.env.INTERNAL_API_KEY ?? "";
  if (!expectedKey || !safeCompare(internalKey, expectedKey)) {
    return Response.json(
      { error: { code: "forbidden", message: "Unauthorized" } },
      { status: 403 }
    );
  }

  const health = await checkMcpHealth();

  return Response.json({
    mcp_connected: health.connected,
    ontology_release_id: health.releaseId,
    index_generated_at: health.indexGeneratedAt,
    company_count: health.companyCount,
    document_count: health.documentCount,
    krw_ontology_commit: process.env.KRW_ONTOLOGY_COMMIT || "unknown",
  });
}
