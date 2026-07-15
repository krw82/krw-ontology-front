import { DOCUMENT_INGESTION_LEASE_SECONDS } from "@/lib/document-ingestion/config";
import { removeDocumentAttachment } from "@/lib/document-ingestion/storage";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { DocumentSourceCleanupJobRow } from "@/types/database";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

type DocumentSourceCleanupClaim = Pick<
  DocumentSourceCleanupJobRow,
  "id" | "attachment_id" | "storage_kind" | "source_path" | "claim_token"
> & {
  claim_token: string;
};

/**
 * Claims and executes one source cleanup task. Deletion is intentionally
 * idempotent: if the process dies after rm succeeds but before the completion
 * RPC, the next claimant safely removes the same directory again.
 */
export async function runNextDocumentSourceCleanupJob(
  workerId: string,
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const claim = await claimDocumentSourceCleanupJob(admin, workerId);
  if (!claim) return false;

  try {
    if (claim.storage_kind !== "local_fs") {
      throw new Error(
        `Object-storage document cleanup is not configured for this worker (${claim.storage_kind})`,
      );
    }

    await removeDocumentAttachment(claim.source_path);
  } catch (error) {
    await failDocumentSourceCleanupJob(
      admin,
      claim,
      error instanceof Error ? error.message : String(error),
    );
    return true;
  }

  const { data: completed, error: completionError } = await admin.rpc(
    "complete_document_source_cleanup_job",
    {
      p_cleanup_job_id: claim.id,
      p_claim_token: claim.claim_token,
    },
  );

  if (completionError || completed !== true) {
    console.warn("[document-source-cleanup] completion write failed", {
      cleanupJobId: claim.id,
      attachmentId: claim.attachment_id,
      code: completionError?.code,
      message: completionError?.message,
    });
  }

  return true;
}

export async function reconcileDocumentSourceCleanupJobs(
  workerId: string,
  maxJobs: number,
): Promise<number> {
  let processed = 0;
  for (let index = 0; index < maxJobs; index += 1) {
    const didProcess = await runNextDocumentSourceCleanupJob(workerId);
    if (!didProcess) break;
    processed += 1;
  }
  return processed;
}

export async function reconcileExpiredDocumentAttachmentCleanup(
  maxAttachments: number,
): Promise<number> {
  const { data, error } = await getSupabaseAdmin().rpc(
    "reconcile_expired_document_attachment_cleanup",
    {
      p_limit: maxAttachments,
    },
  );

  if (error) {
    console.warn("[document-source-cleanup] attachment expiry reconciliation failed", {
      code: error.code,
      message: error.message,
    });
    return 0;
  }

  return typeof data === "number" && data > 0 ? data : 0;
}

async function claimDocumentSourceCleanupJob(
  admin: SupabaseAdmin,
  workerId: string,
): Promise<DocumentSourceCleanupClaim | null> {
  const { data, error } = await admin.rpc(
    "claim_document_source_cleanup_job",
    {
      p_worker_id: workerId,
      p_lease_seconds: DOCUMENT_INGESTION_LEASE_SECONDS,
    },
  );

  if (error) {
    console.warn("[document-source-cleanup] claim failed", {
      workerId,
      code: error.code,
      message: error.message,
    });
    return null;
  }

  const claim = Array.isArray(data) ? data[0] : data;
  if (
    !claim ||
    typeof claim.id !== "string" ||
    typeof claim.attachment_id !== "string" ||
    typeof claim.source_path !== "string" ||
    typeof claim.claim_token !== "string" ||
    (claim.storage_kind !== "local_fs" && claim.storage_kind !== "object_storage")
  ) {
    return null;
  }

  return claim;
}

async function failDocumentSourceCleanupJob(
  admin: SupabaseAdmin,
  claim: DocumentSourceCleanupClaim,
  message: string,
): Promise<void> {
  const { data: failed, error } = await admin.rpc(
    "fail_document_source_cleanup_job",
    {
      p_cleanup_job_id: claim.id,
      p_claim_token: claim.claim_token,
      p_error_message: message,
    },
  );

  if (error || failed !== true) {
    console.warn("[document-source-cleanup] failure write failed", {
      cleanupJobId: claim.id,
      attachmentId: claim.attachment_id,
      code: error?.code,
      message: error?.message,
    });
    return;
  }

  console.warn("[document-source-cleanup] source removal failed; retry scheduled", {
    cleanupJobId: claim.id,
    attachmentId: claim.attachment_id,
    message,
  });
}
