import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260708001000_document_ingestion_bullmq_outbox.sql",
  ),
  "utf8",
);

describe("document ingestion BullMQ outbox migration", () => {
  it("adds durable snapshot fields and an enqueue outbox", () => {
    expect(migration).toContain("add column if not exists extraction_stage");
    expect(migration).toContain("add column if not exists progress_percent");
    expect(migration).toContain("add column if not exists last_event_seq");
    expect(migration).toContain(
      "create table if not exists public.document_job_outbox",
    );
    expect(migration).toContain("payload_json jsonb not null");
    expect(migration).toContain("status in ('pending', 'dispatched', 'failed')");
  });

  it("creates attachment, job, and outbox records in one RPC transaction", () => {
    expect(migration).toContain(
      "create or replace function public.create_document_ingestion_job",
    );
    expect(migration).toContain("insert into public.chat_attachments");
    expect(migration).toContain("insert into public.document_ingestion_jobs");
    expect(migration).toContain("insert into public.document_job_outbox");
    expect(migration).toContain("'document-ingestion:' || v_job.id::text");
  });

  it("keeps live messaging out of the durable enqueue path", () => {
    expect(migration.toLowerCase()).not.toContain("realtime");
    expect(migration).not.toContain("pg_notify");
  });
});
