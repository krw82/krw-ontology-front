import { convertDocumentToMarkdown } from "@/lib/document-ingestion/markitdown-converter";
import {
  removeDocumentAttachment,
  resolveDocumentStoragePath,
} from "@/lib/document-ingestion/storage";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  ChatAttachmentRow,
  DocumentIngestionJobRow,
} from "@/types/database";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

export async function runDocumentIngestionJob(
  jobId: string,
  workerId: string,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const job = await loadDocumentIngestionJob(admin, jobId, workerId);
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
  job: DocumentIngestionJobRow,
  options: { rethrowOnFailure: boolean },
): Promise<void> {
  const attachment = await loadAttachment(admin, job.attachment_id);
  if (!attachment) {
    await failJob(admin, job, "첨부 문서를 찾지 못했습니다.", null);
    if (options.rethrowOnFailure) throw new Error("첨부 문서를 찾지 못했습니다.");
    return;
  }

  if (!attachment.original_path) {
    await failJob(admin, job, "첨부 원본 파일 경로가 없습니다.", attachment);
    if (options.rethrowOnFailure) {
      throw new Error("첨부 원본 파일 경로가 없습니다.");
    }
    return;
  }

  try {
    await markJobStage(admin, job, attachment, {
      status: "processing",
      stage: "extracting",
      progressPercent: 10,
    });

    const sourcePath = resolveDocumentStoragePath(attachment.original_path);
    const markdown = await convertDocumentToMarkdown(sourcePath);

    await removeDocumentAttachment(attachment.original_path);

    const completedAt = new Date().toISOString();
    const nextSeq = job.last_event_seq + 1;
    await admin
      .from("chat_attachments")
      .update({
        extracted_md: markdown,
        extracted_char_count: markdown.length,
        extraction_status: "completed",
        extraction_stage: "completed",
        progress_percent: 100,
        last_event_seq: nextSeq,
        extraction_error: null,
        error_code: null,
        error_message: null,
        original_path: null,
        updated_at: completedAt,
      })
      .eq("id", attachment.id);

    await admin
      .from("document_ingestion_jobs")
      .update({
        status: "completed",
        stage: "completed",
        progress_percent: 100,
        last_event_seq: nextSeq,
        completed_at: completedAt,
        lease_expires_at: null,
        error_code: null,
        error_message: null,
        updated_at: completedAt,
      })
      .eq("id", job.id);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "문서 변환에 실패했습니다.";
    await failJob(admin, job, message, attachment);
    if (options.rethrowOnFailure) throw new Error(message);
  }
}

async function claimQueuedDocumentIngestionJob(
  admin: SupabaseAdmin,
  jobId: string,
  workerId: string,
): Promise<DocumentIngestionJobRow | null> {
  const { data: current, error: loadError } = await admin
    .from("document_ingestion_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle<DocumentIngestionJobRow>();

  if (loadError) {
    console.warn("[document-worker] queue job load failed", {
      jobId,
      code: loadError.code,
      message: loadError.message,
    });
    return null;
  }

  if (!current) {
    console.warn("[document-worker] queue job row missing", { jobId });
    return null;
  }

  if (current.status === "completed" || current.status === "cancelled") {
    console.info("[document-worker] queue job already terminal", {
      jobId,
      status: current.status,
    });
    return null;
  }

  if (current.status === "failed" && current.attempts >= current.max_attempts) {
    console.warn("[document-worker] queue job exhausted DB attempts", {
      jobId,
      attempts: current.attempts,
      maxAttempts: current.max_attempts,
    });
    return null;
  }

  const startedAt = new Date().toISOString();
  const { data, error } = await admin
    .from("document_ingestion_jobs")
    .update({
      status: "processing",
      stage: "accepted",
      progress_percent: 5,
      worker_id: workerId,
      attempts: current.attempts + 1,
      started_at: current.started_at ?? startedAt,
      lease_expires_at: null,
      error_code: null,
      error_message: null,
      updated_at: startedAt,
    })
    .eq("id", jobId)
    .eq("status", current.status)
    .select("*")
    .maybeSingle<DocumentIngestionJobRow>();

  if (error) {
    console.warn("[document-worker] queue claim failed", {
      jobId,
      code: error.code,
      message: error.message,
    });
    return null;
  }

  if (!data) {
    console.info("[document-worker] queue job already claimed or terminal", {
      jobId,
    });
    return null;
  }

  return data;
}

async function markJobStage(
  admin: SupabaseAdmin,
  job: DocumentIngestionJobRow,
  attachment: ChatAttachmentRow,
  params: {
    status: Extract<ChatAttachmentRow["extraction_status"], "processing">;
    stage: ChatAttachmentRow["extraction_stage"];
    progressPercent: number;
  },
): Promise<void> {
  const updatedAt = new Date().toISOString();
  const nextSeq = job.last_event_seq + 1;

  await admin
    .from("chat_attachments")
    .update({
      extraction_status: params.status,
      extraction_stage: params.stage,
      progress_percent: params.progressPercent,
      last_event_seq: nextSeq,
      updated_at: updatedAt,
    })
    .eq("id", attachment.id);

  await admin
    .from("document_ingestion_jobs")
    .update({
      status: params.status,
      stage: params.stage,
      progress_percent: params.progressPercent,
      last_event_seq: nextSeq,
      updated_at: updatedAt,
    })
    .eq("id", job.id);
}

async function loadDocumentIngestionJob(
  admin: SupabaseAdmin,
  jobId: string,
  workerId: string,
): Promise<DocumentIngestionJobRow | null> {
  const { data, error } = await admin
    .from("document_ingestion_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("worker_id", workerId)
    .maybeSingle<DocumentIngestionJobRow>();

  if (error) {
    console.warn("[document-worker] job load failed", {
      jobId,
      code: error.code,
      message: error.message,
    });
    return null;
  }

  return data ?? null;
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
  job: DocumentIngestionJobRow,
  message: string,
  attachment: ChatAttachmentRow | null,
) {
  const finishedAt = new Date().toISOString();
  const nextSeq = job.last_event_seq + 1;

  if (attachment) {
    await admin
      .from("chat_attachments")
      .update({
        extraction_status: "failed",
        extraction_stage: "failed",
        last_event_seq: nextSeq,
        error_code: "document_ingestion_failed",
        error_message: message,
        extraction_error: message,
        updated_at: finishedAt,
      })
      .eq("id", attachment.id);
  }

  await admin
    .from("document_ingestion_jobs")
    .update({
      status: "failed",
      stage: "failed",
      last_event_seq: nextSeq,
      completed_at: finishedAt,
      lease_expires_at: null,
      error_code: "document_ingestion_failed",
      error_message: message,
      updated_at: finishedAt,
    })
    .eq("id", job.id);

  console.warn("[document-worker] job failed", {
    jobId: job.id,
    attachmentId: job.attachment_id,
    message,
  });
}
