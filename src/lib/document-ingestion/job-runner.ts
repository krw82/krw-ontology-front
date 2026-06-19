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

  const attachment = await loadAttachment(admin, job.attachment_id);
  if (!attachment) {
    await failJob(admin, job, "첨부 문서를 찾지 못했습니다.", null);
    return;
  }

  if (!attachment.original_path) {
    await failJob(admin, job, "첨부 원본 파일 경로가 없습니다.", attachment);
    return;
  }

  try {
    const sourcePath = resolveDocumentStoragePath(attachment.original_path);
    const markdown = await convertDocumentToMarkdown(sourcePath);

    await removeDocumentAttachment(attachment.original_path);

    const completedAt = new Date().toISOString();
    await admin
      .from("chat_attachments")
      .update({
        extracted_md: markdown,
        extracted_char_count: markdown.length,
        extraction_status: "completed",
        extraction_error: null,
        original_path: null,
        updated_at: completedAt,
      })
      .eq("id", attachment.id);

    await admin
      .from("document_ingestion_jobs")
      .update({
        status: "completed",
        completed_at: completedAt,
        lease_expires_at: null,
        error_message: null,
        updated_at: completedAt,
      })
      .eq("id", job.id);
  } catch (error) {
    await failJob(
      admin,
      job,
      error instanceof Error ? error.message : "문서 변환에 실패했습니다.",
      attachment,
    );
  }
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

  await removeDocumentAttachment(attachment?.original_path).catch(() => undefined);

  if (attachment) {
    await admin
      .from("chat_attachments")
      .update({
        extraction_status: "failed",
        extraction_error: message,
        original_path: null,
        updated_at: finishedAt,
      })
      .eq("id", attachment.id);
  }

  await admin
    .from("document_ingestion_jobs")
    .update({
      status: "failed",
      completed_at: finishedAt,
      lease_expires_at: null,
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
