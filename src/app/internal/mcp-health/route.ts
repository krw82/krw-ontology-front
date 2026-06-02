import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { getReadyAgentWorker } from "@/lib/agent/worker-heartbeat";
import { getOntologyEnv } from "@/lib/env";
import { getActiveOntologyCatalogRelease } from "@/lib/ontology/catalog";

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

  const activeCatalog = await getActiveOntologyCatalogRelease();
  if (!activeCatalog?.release_id) {
    return Response.json(
      {
        mcp_connected: false,
        ontology_env: getOntologyEnv(),
        ontology_release_id: null,
        manifest_path: null,
        manifest_valid: false,
        agent_index_schema_version: null,
        index_generated_at: null,
        company_count: null,
        document_count: null,
        object_count: null,
        index_path: null,
        krw_ontology_commit: process.env.KRW_ONTOLOGY_COMMIT || "unknown",
        error: "No active ontology web catalog release found",
      },
      { status: 503 },
    );
  }

  const ready = await getReadyAgentWorker(new Date(), activeCatalog.release_id);
  if (!ready.ok) {
    return Response.json(
      {
        mcp_connected: false,
        ontology_env: getOntologyEnv(),
        ontology_release_id: null,
        manifest_path: null,
        manifest_valid: false,
        agent_index_schema_version: null,
        index_generated_at: null,
        company_count: null,
        document_count: null,
        object_count: null,
        index_path: null,
        krw_ontology_commit: process.env.KRW_ONTOLOGY_COMMIT || "unknown",
        error: ready.message,
      },
      { status: 503 },
    );
  }

  const health = ready.mcpHealth;

  return Response.json({
    mcp_connected: health.connected,
    ontology_env: health.env,
    ontology_release_id: health.releaseId,
    manifest_path: health.manifestPath,
    manifest_valid: health.manifestValid,
    agent_index_schema_version: health.agentIndexSchemaVersion,
    index_generated_at: health.indexGeneratedAt,
    company_count: health.companyCount,
    document_count: health.documentCount,
    object_count: health.objectCount,
    index_path: health.indexPath,
    krw_ontology_commit: process.env.KRW_ONTOLOGY_COMMIT || "unknown",
    worker_id: ready.worker.worker_id,
    worker_status: ready.worker.status,
    worker_last_seen_at: ready.worker.last_seen_at,
    catalog_release_id: activeCatalog.release_id,
  });
}
