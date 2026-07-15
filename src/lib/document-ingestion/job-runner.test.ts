import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/document-ingestion/markitdown-converter", () => ({
  convertDocumentToMarkdown: vi.fn(),
}));
vi.mock("@/lib/document-ingestion/storage", () => ({
  resolveDocumentStoragePath: vi.fn(),
}));

import { convertDocumentToMarkdown } from "@/lib/document-ingestion/markitdown-converter";
import { resolveDocumentStoragePath } from "@/lib/document-ingestion/storage";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  ChatAttachmentRow,
  DocumentIngestionJobRow,
} from "@/types/database";
import {
  DocumentIngestionClaimLostError,
  DocumentIngestionLeaseActiveError,
  runQueuedDocumentIngestionJob,
} from "./job-runner";

function documentJob(
  overrides: Partial<DocumentIngestionJobRow> = {},
): DocumentIngestionJobRow {
  return {
    id: "job-1",
    attachment_id: "attachment-1",
    status: "processing",
    stage: "accepted",
    progress_percent: 5,
    last_event_seq: 1,
    queue_job_id: "queue-job-1",
    worker_id: "worker-1",
    claim_token: "claim-1",
    claim_version: 1,
    attempts: 1,
    max_attempts: 3,
    queued_at: "2026-07-10T00:00:00.000Z",
    started_at: "2026-07-10T00:00:00.000Z",
    completed_at: null,
    cancelled_at: null,
    lease_expires_at: "2999-01-01T00:00:00.000Z",
    error_code: null,
    error_message: null,
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

function attachment(
  overrides: Partial<ChatAttachmentRow> = {},
): ChatAttachmentRow {
  return {
    id: "attachment-1",
    user_id: "user-1",
    session_id: "session-1",
    message_id: null,
    ticker: null,
    file_name: "report.pdf",
    mime_type: "application/pdf",
    file_size: 1024,
    storage_kind: "local_fs",
    original_path: "user-1/attachment-1/original.pdf",
    original_object_path: null,
    extracted_object_path: null,
    chunks_object_path: null,
    content_hash: null,
    extracted_md: null,
    extracted_char_count: null,
    extraction_status: "processing",
    extraction_stage: "accepted",
    progress_percent: 5,
    last_event_seq: 1,
    error_code: null,
    error_message: null,
    extraction_error: null,
    expires_at: "2026-07-11T00:00:00.000Z",
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

type RpcResponse = { data: unknown; error: { code: string; message: string } | null };

function createDocumentAdmin(params: {
  job?: DocumentIngestionJobRow;
  attachment?: ChatAttachmentRow;
  responses?: Partial<Record<string, RpcResponse>>;
}) {
  const job = params.job ?? documentJob();
  const attachmentRow = params.attachment ?? attachment();
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const admin = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      const response = params.responses?.[name];
      if (response) return response;

      if (name === "claim_document_ingestion_job_by_id_v2") {
        return {
          data: [
            {
              id: job.id,
              claim_token: job.claim_token,
              lease_expires_at: job.lease_expires_at,
              claim_state: "claimed",
            },
          ],
          error: null,
        };
      }
      if (name === "advance_document_ingestion_job") {
        return { data: true, error: null };
      }
      if (name === "renew_document_ingestion_job_lease") {
        return { data: true, error: null };
      }
      if (name === "complete_document_ingestion_job") {
        return { data: true, error: null };
      }
      if (name === "fail_document_ingestion_job") {
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    }),
    from(table: "document_ingestion_jobs" | "chat_attachments") {
      const row = table === "document_ingestion_jobs" ? job : attachmentRow;
      const query = {
        eq() {
          return query;
        },
        maybeSingle() {
          return Promise.resolve({ data: row, error: null });
        },
      };
      return {
        select() {
          return query;
        },
      };
    },
  };

  return {
    admin: admin as unknown as ReturnType<typeof getSupabaseAdmin>,
    rpcCalls,
  };
}

describe("document ingestion runner claim lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(convertDocumentToMarkdown).mockResolvedValue("# Converted");
    vi.mocked(resolveDocumentStoragePath).mockImplementation(
      (relativePath) => `/storage/${relativePath}`,
    );
  });

  it("defers a queue delivery while another worker has an active claim", async () => {
    const fake = createDocumentAdmin({
      responses: {
        claim_document_ingestion_job_by_id_v2: {
          data: [
            {
              id: "job-1",
              claim_token: null,
              lease_expires_at: "2999-01-01T00:00:00.000Z",
              claim_state: "active_lease",
            },
          ],
          error: null,
        },
      },
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const error = await runQueuedDocumentIngestionJob("job-1", "worker-2").catch(
      (caught) => caught,
    );

    expect(error).toBeInstanceOf(DocumentIngestionLeaseActiveError);
    expect(error).toMatchObject({
      leaseExpiresAt: "2999-01-01T00:00:00.000Z",
      retryAt: Date.parse("2999-01-01T00:00:00.000Z") + 1_000,
    });
    expect(convertDocumentToMarkdown).not.toHaveBeenCalled();
  });

  it("uses one claim-token-gated completion RPC instead of split attachment/job writes", async () => {
    const fake = createDocumentAdmin({});
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    await runQueuedDocumentIngestionJob("job-1", "worker-1");

    expect(fake.rpcCalls.map((call) => call.name)).toEqual([
      "claim_document_ingestion_job_by_id_v2",
      "advance_document_ingestion_job",
      "renew_document_ingestion_job_lease",
      "complete_document_ingestion_job",
    ]);
    expect(fake.rpcCalls.at(-1)).toEqual({
      name: "complete_document_ingestion_job",
      args: {
        p_job_id: "job-1",
        p_claim_token: "claim-1",
        p_extracted_md: "# Converted",
        p_source_path: "user-1/attachment-1/original.pdf",
      },
    });
  });

  it("does not let a stale claim mark a newer job as failed after completion is rejected", async () => {
    const fake = createDocumentAdmin({
      responses: {
        complete_document_ingestion_job: { data: false, error: null },
      },
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    await expect(
      runQueuedDocumentIngestionJob("job-1", "worker-1"),
    ).rejects.toBeInstanceOf(DocumentIngestionClaimLostError);

    expect(
      fake.rpcCalls.some((call) => call.name === "fail_document_ingestion_job"),
    ).toBe(false);
  });

  it("uses the atomic failure RPC when conversion fails before completion", async () => {
    const fake = createDocumentAdmin({});
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);
    vi.mocked(convertDocumentToMarkdown).mockRejectedValue(
      new Error("converter unavailable"),
    );

    await expect(
      runQueuedDocumentIngestionJob("job-1", "worker-1"),
    ).rejects.toThrow("converter unavailable");

    expect(fake.rpcCalls.at(-1)).toEqual({
      name: "fail_document_ingestion_job",
      args: {
        p_job_id: "job-1",
        p_claim_token: "claim-1",
        p_error_code: "document_ingestion_failed",
        p_error_message: "converter unavailable",
      },
    });
  });
});
