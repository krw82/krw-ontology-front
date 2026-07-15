import { convertDocumentToMarkdown } from "@/lib/document-ingestion/markitdown-converter";
import {
  DOCUMENT_INGESTION_CONCURRENT_LIMIT,
  DOCUMENT_INGESTION_LEASE_SECONDS,
} from "@/lib/document-ingestion/config";
import { resolveDocumentStoragePath } from "@/lib/document-ingestion/storage";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  ChatAttachmentRow,
  DocumentIngestionJobRow,
} from "@/types/database";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

type ClaimedDocumentIngestionJob = DocumentIngestionJobRow & {
  claim_token: string;
};

export class DocumentIngestionLeaseActiveError extends Error {
  readonly retryAt: number;

  constructor(readonly leaseExpiresAt: string) {
    super("Document ingestion job has an active database lease");
    this.name = "DocumentIngestionLeaseActiveError";
    this.retryAt = Date.parse(leaseExpiresAt) + 1_000;
  }
}

export class DocumentIngestionClaimLostError extends Error {
  constructor(message = "Document ingestion claim was lost before state changed") {
    super(message);
    this.name = "DocumentIngestionClaimLostError";
  }
}

export async function runDocumentIngestionJob(
  jobId: string,
  workerId: string,
  claimToken: string,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const job = await loadDocumentIngestionJob(admin, jobId, workerId, claimToken);
  if (!job) return;

  await processDocumentIngestionJob(admin, job, { rethrowOnFailure: false });
}

export async function runQueuedDocumentIngestionJob(
  jobId: string,
  workerId: string,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const job = await claimQueuedDocumentIngestionJob(admin, jobId, workerId);
  if (!job) return;

  await processDocumentIngestionJob(admin, job, { rethrowOnFailure: true });
}

async function processDocumentIngestionJob(
  admin: SupabaseAdmin,
  job: ClaimedDocumentIngestionJob,
  options: { rethrowOnFailure: boolean },
): Promise<void> {
  const attachment = await loadAttachment(admin, job.attachment_id);
  if (!attachment) {
    await handleFailure(
      admin,
      job,
      "첨부 문서를 찾지 못했습니다.",
      options,
    );
    return;
  }

  const originalPath = attachment.original_path;
  if (!originalPath) {
    await handleFailure(
      admin,
      job,
      "첨부 원본 파일 경로가 없습니다.",
      options,
    );
    return;
  }

  try {
    await markJobStage(admin, job, {
      stage: "extracting",
      progressPercent: 10,
    });

    const heartbeat = startDocumentIngestionLeaseHeartbeat(admin, job);
    let markdown: string;
    try {
      const sourcePath = resolveDocumentStoragePath(originalPath);
      markdown = await convertDocumentToMarkdown(sourcePath);
      await heartbeat.ensureActive();
    } finally {
      await heartbeat.stop();
    }

    const { data: completed, error: completionError } = await admin.rpc(
      "complete_document_ingestion_job",
      {
        p_job_id: job.id,
        p_claim_token: job.claim_token,
        p_extracted_md: markdown,
        p_source_path: originalPath,
      },
    );

    if (completionError) {
      console.warn("[document-worker] atomic completion failed", {
        jobId: job.id,
        attachmentId: attachment.id,
        code: completionError.code,
        message: completionError.message,
      });
      throw new Error("첨부 문서 완료 상태를 저장하지 못했습니다.");
    }

    if (completed !== true) {
      throw new DocumentIngestionClaimLostError();
    }
  } catch (error) {
    if (error instanceof DocumentIngestionClaimLostError) {
      if (options.rethrowOnFailure) throw error;
      console.info("[document-worker] ignored stale document claim", {
        jobId: job.id,
        attachmentId: attachment.id,
      });
      return;
    }

    const message =
      error instanceof Error ? error.message : "문서 변환에 실패했습니다.";
    await handleFailure(admin, job, message, options);
  }
}

async function handleFailure(
  admin: SupabaseAdmin,
  job: ClaimedDocumentIngestionJob,
  message: string,
  options: { rethrowOnFailure: boolean },
): Promise<void> {
  const failed = await failJob(admin, job, message);
  if (!failed) {
    const claimLost = new DocumentIngestionClaimLostError();
    if (options.rethrowOnFailure) throw claimLost;
    console.info("[document-worker] did not overwrite a newer document claim", {
      jobId: job.id,
      attachmentId: job.attachment_id,
    });
    return;
  }

  if (options.rethrowOnFailure) throw new Error(message);
}

async function claimQueuedDocumentIngestionJob(
  admin: SupabaseAdmin,
  jobId: string,
  workerId: string,
): Promise<ClaimedDocumentIngestionJob | null> {
  const { data, error } = await admin.rpc(
    "claim_document_ingestion_job_by_id_v2",
    {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_lease_seconds: DOCUMENT_INGESTION_LEASE_SECONDS,
      p_global_limit: DOCUMENT_INGESTION_CONCURRENT_LIMIT,
    },
  );

  if (error) {
    console.warn("[document-worker] queue claim failed", {
      jobId,
      code: error.code,
      message: error.message,
    });
    throw new Error("문서 작업을 점유하지 못했습니다.");
  }

  const claim = Array.isArray(data) ? data[0] : data;
  if (!claim) {
    console.info("[document-worker] queue job already terminal or exhausted", {
      jobId,
    });
    return null;
  }

  if (claim.claim_state !== "claimed" || !claim.claim_token) {
    const retryAt = claim.lease_expires_at ?? new Date(Date.now() + 1_000).toISOString();
    console.info("[document-worker] queue claim deferred", {
      jobId,
      claimState: claim.claim_state,
      leaseExpiresAt: retryAt,
    });
    throw new DocumentIngestionLeaseActiveError(retryAt);
  }

  const job = await loadDocumentIngestionJob(
    admin,
    jobId,
    workerId,
    claim.claim_token,
  );
  if (!job) {
    throw new DocumentIngestionClaimLostError(
      "Document ingestion claim disappeared immediately after acquisition",
    );
  }

  return job;
}

async function markJobStage(
  admin: SupabaseAdmin,
  job: ClaimedDocumentIngestionJob,
  params: {
    stage: Extract<
      ChatAttachmentRow["extraction_stage"],
      "accepted" | "extracting" | "chunking" | "embedding" | "indexing"
    >;
    progressPercent: number;
  },
): Promise<void> {
  const { data, error } = await admin.rpc("advance_document_ingestion_job", {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_stage: params.stage,
    p_progress_percent: params.progressPercent,
  });

  if (error) {
    console.warn("[document-worker] stage update failed", {
      jobId: job.id,
      attachmentId: job.attachment_id,
      code: error.code,
      message: error.message,
    });
    throw new Error("문서 작업 진행 상태를 저장하지 못했습니다.");
  }

  if (data !== true) throw new DocumentIngestionClaimLostError();
}

function startDocumentIngestionLeaseHeartbeat(
  admin: SupabaseAdmin,
  job: ClaimedDocumentIngestionJob,
) {
  const intervalMs = Math.max(
    10_000,
    Math.floor((DOCUMENT_INGESTION_LEASE_SECONDS * 1_000) / 3),
  );
  let claimLost = false;
  let renewal: Promise<boolean> | null = null;

  const renew = async (): Promise<boolean> => {
    if (claimLost) return false;
    if (renewal) return renewal;

    renewal = (async () => {
      try {
        const { data, error } = await admin.rpc(
          "renew_document_ingestion_job_lease",
          {
            p_job_id: job.id,
            p_claim_token: job.claim_token,
            p_lease_seconds: DOCUMENT_INGESTION_LEASE_SECONDS,
          },
        );

        if (!error && data === true) return true;

        claimLost = true;
        console.warn("[document-worker] document lease renewal failed", {
          jobId: job.id,
          attachmentId: job.attachment_id,
          code: error?.code,
          message: error?.message,
        });
        return false;
      } catch (error) {
        claimLost = true;
        console.warn("[document-worker] document lease renewal crashed", {
          jobId: job.id,
          attachmentId: job.attachment_id,
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    })().finally(() => {
      renewal = null;
    });

    return renewal;
  };

  const timer = setInterval(() => {
    void renew();
  }, intervalMs);
  timer.unref?.();

  return {
    async ensureActive(): Promise<void> {
      if (!(await renew())) throw new DocumentIngestionClaimLostError();
    },
    async stop(): Promise<void> {
      clearInterval(timer);
      await renewal;
    },
  };
}

async function loadDocumentIngestionJob(
  admin: SupabaseAdmin,
  jobId: string,
  workerId: string,
  claimToken: string,
): Promise<ClaimedDocumentIngestionJob | null> {
  const { data, error } = await admin
    .from("document_ingestion_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("worker_id", workerId)
    .eq("claim_token", claimToken)
    .eq("status", "processing")
    .maybeSingle<DocumentIngestionJobRow>();

  if (error) {
    console.warn("[document-worker] job load failed", {
      jobId,
      code: error.code,
      message: error.message,
    });
    return null;
  }

  if (!data?.claim_token) return null;
  return data as ClaimedDocumentIngestionJob;
}

async function loadAttachment(
  admin: SupabaseAdmin,
  attachmentId: string,
): Promise<ChatAttachmentRow | null> {
  const { data, error } = await admin
    .from("chat_attachments")
    .select("*")
    .eq("id", attachmentId)
    .maybeSingle<ChatAttachmentRow>();

  if (error) {
    console.warn("[document-worker] attachment load failed", {
      attachmentId,
      code: error.code,
      message: error.message,
    });
    return null;
  }

  return data ?? null;
}

async function failJob(
  admin: SupabaseAdmin,
  job: ClaimedDocumentIngestionJob,
  message: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("fail_document_ingestion_job", {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_error_code: "document_ingestion_failed",
    p_error_message: message,
  });

  if (error) {
    console.warn("[document-worker] atomic failure update failed", {
      jobId: job.id,
      attachmentId: job.attachment_id,
      code: error.code,
      message: error.message,
    });
    return false;
  }

  if (data !== true) return false;

  console.warn("[document-worker] job failed", {
    jobId: job.id,
    attachmentId: job.attachment_id,
    message,
  });
  return true;
}
