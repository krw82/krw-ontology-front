import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260710002000_document_ingestion_claim_tokens_cleanup.sql",
  ),
  "utf8",
);

describe("document ingestion claim-token and cleanup migration", () => {
  it("adds claim tokens and gates every ingestion lifecycle mutation by an active claim", () => {
    expect(migration).toContain("add column if not exists claim_token uuid");
    expect(migration).toContain("add column if not exists claim_version bigint");
    expect(migration).toContain(
      "create or replace function public.claim_document_ingestion_job_v2",
    );
    expect(migration).toContain(
      "create or replace function public.complete_document_ingestion_job",
    );
    expect(migration).toContain(
      "create or replace function public.fail_document_ingestion_job",
    );
    expect(migration).toContain("v_job.claim_token is distinct from p_claim_token");
    expect(migration).toContain("v_job.lease_expires_at <= now()");
  });

  it("commits completed attachment, completed job, and cleanup intent in one database transaction", () => {
    const completionStart = migration.indexOf(
      "create or replace function public.complete_document_ingestion_job",
    );
    const completionEnd = migration.indexOf(
      "create or replace function public.fail_document_ingestion_job",
    );
    const completion = migration.slice(completionStart, completionEnd);

    expect(completion).toContain("update public.chat_attachments");
    expect(completion).toContain("extraction_status = 'completed'");
    expect(completion).toContain("update public.document_ingestion_jobs");
    expect(completion).toContain("status = 'completed'");
    expect(completion).toContain(
      "perform public.enqueue_document_source_cleanup_intent",
    );
    expect(completion).toContain(
      "v_attachment.extraction_status = 'completed'",
    );
  });

  it("keeps failed, cancelled, and expired sources until expiry before durable cleanup", () => {
    expect(migration).toContain(
      "create or replace function public.enqueue_document_source_cleanup_on_terminal",
    );
    expect(migration).toContain("new.status not in ('completed', 'failed', 'cancelled')");
    expect(migration).toContain("v_next_attempt_at := v_attachment.expires_at");
    expect(migration).toContain(
      "create or replace function public.enqueue_document_source_cleanup_on_attachment_terminal",
    );
    expect(migration).toContain(
      "create or replace function public.reconcile_expired_document_attachment_cleanup",
    );
    expect(migration).toContain("document_attachment_expired");
    expect(migration).toContain("or a.extraction_status in ('failed', 'cancelled', 'expired')");
  });

  it("makes source cleanup retryable, idempotent, bounded, and terminal for unsupported storage", () => {
    expect(migration).toContain(
      "create table if not exists public.document_source_cleanup_jobs",
    );
    expect(migration).toContain("max_attempts integer not null default 12");
    expect(migration).toContain("'unsupported'");
    expect(migration).toContain("c.attempts < c.max_attempts");
    expect(migration).toContain(
      "create or replace function public.complete_document_source_cleanup_job",
    );
    expect(migration).toContain("when original_path = v_cleanup.source_path then null");
    expect(migration).toContain(
      "create or replace function public.fail_document_source_cleanup_job",
    );
    expect(migration).toContain("when v_cleanup.storage_kind = 'local_fs' then 'failed'");
    expect(migration).toContain(
      "document ingestion currently supports only local_fs storage",
    );
  });

  it("fails migration preflight instead of silently accepting duplicate active/completed jobs", () => {
    expect(migration).toContain(
      "document ingestion preflight failed: an attachment has multiple active/completed jobs",
    );
    expect(migration).toContain(
      "create unique index if not exists idx_document_ingestion_jobs_one_active_or_completed_attachment",
    );
    expect(migration).toContain(
      "where status in ('queued', 'running', 'processing', 'completed')",
    );
  });
});
