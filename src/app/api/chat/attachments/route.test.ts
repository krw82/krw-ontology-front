import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  handleAuthError: vi.fn((error: Error) =>
    Response.json({ error: { message: error.message } }, { status: 401 }),
  ),
}));
vi.mock("@/lib/document-ingestion/storage", () => ({
  documentAttachmentRelativePath: vi.fn(() => "user-1/attachment-1/original.pdf"),
  writeDocumentAttachment: vi.fn(),
  removeDocumentAttachment: vi.fn(),
}));
vi.mock("@/lib/document-ingestion/bullmq-queue", () => ({
  DOCUMENT_INGESTION_QUEUE_NAME: "document-ingestion",
  enqueueDocumentIngestionJob: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth";
import {
  removeDocumentAttachment,
  writeDocumentAttachment,
} from "@/lib/document-ingestion/storage";
import { enqueueDocumentIngestionJob } from "@/lib/document-ingestion/bullmq-queue";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { POST } from "./route";

function attachmentRow() {
  return {
    id: "attachment-1",
    user_id: "user-1",
    session_id: null,
    message_id: null,
    ticker: null,
    file_name: "test.pdf",
    mime_type: "application/pdf",
    file_size: 7,
    storage_kind: "local_fs",
    original_path: "user-1/attachment-1/original.pdf",
    original_object_path: "user-1/attachment-1/original.pdf",
    extracted_object_path: null,
    chunks_object_path: null,
    content_hash:
      "239f59ed55e737c77147cf55ef4d883158c2c114b83a3a7e80188649c5b387e9",
    extracted_md: null,
    extracted_char_count: null,
    extraction_status: "queued",
    extraction_stage: "accepted",
    progress_percent: 0,
    last_event_seq: 0,
    error_code: null,
    error_message: null,
    extraction_error: null,
    expires_at: "2026-07-09T00:00:00.000Z",
    created_at: "2026-07-08T00:00:00.000Z",
    updated_at: "2026-07-08T00:00:00.000Z",
  };
}

function jobRow() {
  return {
    id: "job-1",
    attachment_id: "attachment-1",
    status: "queued",
    stage: "accepted",
    progress_percent: 0,
    last_event_seq: 0,
    queue_job_id: "document-ingestion:job-1",
    worker_id: null,
    attempts: 0,
    max_attempts: 3,
    queued_at: "2026-07-08T00:00:00.000Z",
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    lease_expires_at: null,
    error_code: null,
    error_message: null,
    created_at: "2026-07-08T00:00:00.000Z",
    updated_at: "2026-07-08T00:00:00.000Z",
  };
}

function createAdmin() {
  const outboxUpdates: Array<Record<string, unknown>> = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const admin = {
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({
        data: {
          attachment: attachmentRow(),
          job: jobRow(),
          queue_name: "document-ingestion",
          queue_job_id: "document-ingestion:job-1",
        },
        error: null,
      });
    }),
    from: vi.fn((table: string) => {
      if (table === "chat_attachments") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                gt: vi.fn(() => ({
                  in: vi.fn(() =>
                    Promise.resolve({ count: 0, error: null }),
                  ),
                })),
              })),
            })),
          })),
        };
      }

      if (table === "document_job_outbox") {
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            outboxUpdates.push(payload);
            return {
              eq: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ error: null })),
              })),
            };
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    outboxUpdates,
    rpcCalls,
  };

  return admin;
}

function request() {
  const formData = new FormData();
  formData.set(
    "file",
    new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7])], "test.pdf", {
      type: "application/pdf",
    }),
  );

  return new NextRequest("http://localhost/api/chat/attachments", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/chat/attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(writeDocumentAttachment).mockResolvedValue(undefined as never);
    vi.mocked(removeDocumentAttachment).mockResolvedValue(undefined as never);
    vi.mocked(enqueueDocumentIngestionJob).mockResolvedValue({
      status: "enqueued",
    });
  });

  it("creates a document ingestion job through the transactional RPC and fast-enqueues it", async () => {
    const admin = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin as never);

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(admin.rpcCalls).toHaveLength(1);
    expect(admin.rpcCalls[0]).toMatchObject({
      name: "create_document_ingestion_job",
      args: {
        p_user_id: "user-1",
        p_storage_kind: "local_fs",
        p_original_path: "user-1/attachment-1/original.pdf",
        p_original_object_path: "user-1/attachment-1/original.pdf",
        p_queue_name: "document-ingestion",
      },
    });
    expect(enqueueDocumentIngestionJob).toHaveBeenCalledWith({
      queueJobId: "document-ingestion:job-1",
      payload: expect.objectContaining({
        schemaVersion: 1,
        jobId: "job-1",
        attachmentId: "attachment-1",
        userId: "user-1",
        storageKind: "local_fs",
      }),
    });
    expect(admin.outboxUpdates).toEqual([
      expect.objectContaining({
        status: "dispatched",
        last_error: null,
      }),
    ]);
    expect(body.attachment).toMatchObject({
      id: "attachment-1",
      status: "queued",
      stage: "accepted",
      progress_percent: 0,
      job_id: "job-1",
    });
  });

  it("keeps the upload successful when fast enqueue fails so the outbox can recover", async () => {
    const admin = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin as never);
    vi.mocked(enqueueDocumentIngestionJob).mockRejectedValue(
      new Error("redis down"),
    );

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(admin.rpcCalls).toHaveLength(1);
    expect(admin.outboxUpdates).toEqual([]);
  });
});
