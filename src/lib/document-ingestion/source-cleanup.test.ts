import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/document-ingestion/storage", () => ({
  removeDocumentAttachment: vi.fn(),
}));

import { removeDocumentAttachment } from "@/lib/document-ingestion/storage";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  reconcileExpiredDocumentAttachmentCleanup,
  runNextDocumentSourceCleanupJob,
} from "./source-cleanup";

function cleanupClaim(overrides: Record<string, unknown> = {}) {
  return {
    id: "cleanup-1",
    attachment_id: "attachment-1",
    storage_kind: "local_fs",
    source_path: "user-1/attachment-1/original.pdf",
    claim_token: "cleanup-claim-1",
    ...overrides,
  };
}

function createCleanupAdmin(claims: Array<Record<string, unknown> | null>) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admin = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "claim_document_source_cleanup_job") {
        const claim = claims.shift();
        return { data: claim ? [claim] : [], error: null };
      }
      if (
        name === "fail_document_source_cleanup_job" ||
        name === "complete_document_source_cleanup_job"
      ) {
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    }),
  };

  return {
    admin: admin as unknown as ReturnType<typeof getSupabaseAdmin>,
    rpcCalls,
  };
}

describe("document source cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records a failed cleanup and retries the same source idempotently", async () => {
    const fake = createCleanupAdmin([cleanupClaim(), cleanupClaim()]);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);
    vi.mocked(removeDocumentAttachment)
      .mockRejectedValueOnce(new Error("filesystem unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(runNextDocumentSourceCleanupJob("worker-1")).resolves.toBe(true);
    await expect(runNextDocumentSourceCleanupJob("worker-1")).resolves.toBe(true);

    expect(removeDocumentAttachment).toHaveBeenCalledTimes(2);
    expect(removeDocumentAttachment).toHaveBeenNthCalledWith(
      1,
      "user-1/attachment-1/original.pdf",
    );
    expect(fake.rpcCalls.map((call) => call.name)).toEqual([
      "claim_document_source_cleanup_job",
      "fail_document_source_cleanup_job",
      "claim_document_source_cleanup_job",
      "complete_document_source_cleanup_job",
    ]);
  });

  it("persists an observable failure instead of attempting unsupported object storage deletion", async () => {
    const fake = createCleanupAdmin([
      cleanupClaim({ storage_kind: "object_storage" }),
    ]);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    await expect(runNextDocumentSourceCleanupJob("worker-1")).resolves.toBe(true);

    expect(removeDocumentAttachment).not.toHaveBeenCalled();
    expect(fake.rpcCalls.at(-1)).toEqual({
      name: "fail_document_source_cleanup_job",
      args: {
        p_cleanup_job_id: "cleanup-1",
        p_claim_token: "cleanup-claim-1",
        p_error_message:
          "Object-storage document cleanup is not configured for this worker (object_storage)",
      },
    });
  });

  it("asks Postgres to cancel and enqueue expired attachments before cleanup polling", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "reconcile_expired_document_attachment_cleanup") {
        return { data: 2, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      { rpc } as unknown as ReturnType<typeof getSupabaseAdmin>,
    );

    await expect(reconcileExpiredDocumentAttachmentCleanup(25)).resolves.toBe(2);
    expect(rpc).toHaveBeenCalledWith(
      "reconcile_expired_document_attachment_cleanup",
      { p_limit: 25 },
    );
  });
});
