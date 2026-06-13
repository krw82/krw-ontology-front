import type { NextRequest } from "next/server";
import {
  authenticateDesktopRequest,
  requireDesktopEntitlement,
} from "@/lib/desktop/auth";
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
    const auth = await authenticateDesktopRequest(request);
    await requireDesktopEntitlement(auth);
    const release = await getActiveOntologyCatalogRelease();
    const usesMcp = shouldUseDesktopOntologyMcp();
    const mcp = usesMcp ? await checkKrwOntologyMcpHealth() : null;
    const releaseMatches =
      !usesMcp ||
      Boolean(
        mcp?.releaseId &&
          release?.release_id &&
          mcp.releaseId === release.release_id,
      );
    const searchOk = Boolean(release?.release_id) && (!usesMcp || Boolean(mcp?.ok)) &&
      releaseMatches;

    return Response.json({
      ok: searchOk,
      ontology_search_api_ok: searchOk,
      ontology_api_version: DESKTOP_ONTOLOGY_API_VERSION,
      active_ontology_release_id: release?.release_id ?? null,
      index_generated_at: release?.index_generated_at ?? null,
      executor: usesMcp ? "mcp" : "catalog",
      release_matches_executor: releaseMatches,
      mcp: mcp
        ? {
            ok: mcp.ok,
            release_id: mcp.releaseId,
            index_generated_at: mcp.indexGeneratedAt,
            tool_count: mcp.toolNames.length,
            error: mcp.error ?? null,
          }
        : null,
      catalog: release
        ? {
            company_count: release.company_count,
            document_count: release.document_count,
            object_count: release.object_count,
          }
        : null,
    });
  } catch (error) {
    return handleDesktopApiError(error);
  }
}
