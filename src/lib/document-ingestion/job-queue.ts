import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  DOCUMENT_INGESTION_CONCURRENT_LIMIT,
  DOCUMENT_INGESTION_LEASE_SECONDS,
} from "@/lib/document-ingestion/config";

export async function claimNextDocumentIngestionJob(
  workerId: string,
): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin().rpc(
    "claim_document_ingestion_job",
    {
      p_worker_id: workerId,
      p_lease_seconds: DOCUMENT_INGESTION_LEASE_SECONDS,
      p_global_limit: DOCUMENT_INGESTION_CONCURRENT_LIMIT,
    },
  );

  if (error) {
    console.warn("[document-worker] claim failed", {
      code: error.code,
      message: error.message,
    });
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return typeof row?.id === "string" ? row.id : null;
}
