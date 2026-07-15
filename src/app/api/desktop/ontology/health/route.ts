import type { NextRequest } from "next/server";
import { authenticateDesktopRequest } from "@/lib/desktop/auth";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import { DESKTOP_ONTOLOGY_API_VERSION } from "@/lib/desktop/ontology-contracts";
import {
  checkKrwOntologyMcpHealth,
  shouldUseDesktopOntologyMcp,
} from "@/lib/desktop/ontology-mcp-client";
import { getActiveOntologyCatalogRelease } from "@/lib/ontology/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await authenticateDesktopRequest(request);
    const release = await getActiveOntologyCatalogRelease();
    const usesMcp = shouldUseDesktopOntologyMcp();
    const mcp = usesMcp ? await checkKrwOntologyMcpHealth() : null;
    const releaseMatches =
      usesMcp &&
      Boolean(
        mcp?.releaseId &&
          release?.release_id &&
          mcp.releaseId === release.release_id,
      );
    const searchOk = usesMcp && Boolean(mcp?.ok) && releaseMatches;
    const companyCount = release?.company_count ?? null;
    const documentCount = release?.document_count ?? null;
    const objectCount = release?.object_count ?? null;

    return Response.json({
      ok: searchOk,
      ontology_search_api_ok: searchOk,
      ontology_api_version: DESKTOP_ONTOLOGY_API_VERSION,
      active_ontology_release_id: release?.release_id ?? null,
      index_generated_at: release?.index_generated_at ?? null,
      executor: usesMcp ? "mcp" : "unconfigured",
      release_matches_executor: releaseMatches,
      service: {
        status: searchOk ? "ready" : "not_ready",
        api_version: DESKTOP_ONTOLOGY_API_VERSION,
        active_release_id: usesMcp
          ? (mcp?.releaseId ?? release?.release_id ?? null)
          : (release?.release_id ?? null),
        company_count: companyCount,
        document_count: documentCount,
        object_count: objectCount,
      },
      mcp: mcp
        ? {
            ok: mcp.ok,
            release_id: mcp.releaseId,
            index_generated_at: mcp.indexGeneratedAt,
            tool_count: mcp.toolNames.length,
            mcp_contract_version: mcp.mcpContractVersion ?? null,
            tool_schema_sha256: mcp.toolSchemaSha256 ?? null,
            error: mcp.error ?? null,
          }
        : null,
      catalog: release
        ? {
            company_count: companyCount,
            document_count: documentCount,
            object_count: objectCount,
          }
        : null,
    });
  } catch (error) {
    return handleDesktopApiError(error);
  }
}
