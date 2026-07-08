import { randomUUID } from "node:crypto";
import {
  enqueueDocumentIngestionJob,
  type DocumentIngestionQueuePayload,
} from "@/lib/document-ingestion/bullmq-queue";
import { readIntEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

const DISPATCHER_ID =
  process.env.DOCUMENT_OUTBOX_DISPATCHER_ID ||
  `document-outbox-dispatcher-${randomUUID()}`;

const POLL_INTERVAL_MS = readIntEnv(
  "DOCUMENT_OUTBOX_DISPATCH_INTERVAL_MS",
  15_000,
  { min: 1_000 },
);

const BATCH_SIZE = readIntEnv("DOCUMENT_OUTBOX_DISPATCH_BATCH_SIZE", 25, {
  min: 1,
});

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

async function waitForStopSignal(abortController: AbortController) {
  await new Promise<void>((resolve) => {
    let resolved = false;
    const stop = () => {
      if (resolved) return;
      resolved = true;
      abortController.abort();
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

function payloadFromJson(value: Json): DocumentIngestionQueuePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, Json | undefined>;

  if (
    payload.schemaVersion !== 1 ||
    typeof payload.jobId !== "string" ||
    typeof payload.attachmentId !== "string" ||
    typeof payload.userId !== "string" ||
    (payload.storageKind !== "local_fs" && payload.storageKind !== "object_storage")
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    jobId: payload.jobId,
    attachmentId: payload.attachmentId,
    userId: payload.userId,
    storageKind: payload.storageKind,
    originalPath:
      typeof payload.originalPath === "string" ? payload.originalPath : null,
    originalObjectPath:
      typeof payload.originalObjectPath === "string"
        ? payload.originalObjectPath
        : null,
    contentHash:
      typeof payload.contentHash === "string" ? payload.contentHash : null,
  };
}

async function dispatchPendingOutboxBatch(): Promise<number> {
  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data: rows, error } = await admin
    .from("document_job_outbox")
    .select("id, queue_name, queue_job_id, payload_json, attempts")
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", now)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.warn("[document-outbox-dispatcher] outbox scan failed", {
      code: error.code,
      message: error.message,
    });
    return 0;
  }

  let dispatched = 0;
  for (const row of rows ?? []) {
    const payload = payloadFromJson(row.payload_json);
    if (!payload) {
      await markFailed(row.id, row.attempts, "Invalid document outbox payload");
      continue;
    }

    try {
      const result = await enqueueDocumentIngestionJob({
        queueJobId: row.queue_job_id,
        payload,
      });

      if (result.status === "skipped") {
        await markFailed(
          row.id,
          row.attempts,
          `Document queue enqueue skipped: ${result.reason}`,
        );
        continue;
      }

      const dispatchedAt = new Date().toISOString();
      const { error: updateError } = await admin
        .from("document_job_outbox")
        .update({
          status: "dispatched",
          dispatched_at: dispatchedAt,
          last_error: null,
          updated_at: dispatchedAt,
        })
        .eq("id", row.id);

      if (updateError) {
        console.warn("[document-outbox-dispatcher] mark dispatched failed", {
          outboxId: row.id,
          code: updateError.code,
          message: updateError.message,
        });
        continue;
      }

      dispatched += 1;
    } catch (error) {
      await markFailed(
        row.id,
        row.attempts,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return dispatched;
}

async function markFailed(
  outboxId: string,
  attempts: number,
  message: string,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const nextAttempts = attempts + 1;
  const delayMs = Math.min(5 * 60_000, 2 ** Math.min(nextAttempts, 8) * 1_000);
  const now = Date.now();
  const { error } = await admin
    .from("document_job_outbox")
    .update({
      status: "failed",
      attempts: nextAttempts,
      next_attempt_at: new Date(now + delayMs).toISOString(),
      last_error: message.slice(0, 2_000),
      updated_at: new Date(now).toISOString(),
    })
    .eq("id", outboxId);

  if (error) {
    console.warn("[document-outbox-dispatcher] mark failed failed", {
      outboxId,
      code: error.code,
      message: error.message,
    });
  }
}

async function main() {
  const abortController = new AbortController();
  void waitForStopSignal(abortController);

  console.info("[document-outbox-dispatcher] started", {
    dispatcherId: DISPATCHER_ID,
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
  });

  while (!abortController.signal.aborted) {
    const dispatched = await dispatchPendingOutboxBatch();
    if (dispatched > 0) {
      console.info("[document-outbox-dispatcher] dispatched outbox jobs", {
        dispatcherId: DISPATCHER_ID,
        dispatched,
      });
    }
    await sleep(POLL_INTERVAL_MS, abortController.signal);
  }

  console.info("[document-outbox-dispatcher] stopped", {
    dispatcherId: DISPATCHER_ID,
  });
}

main().catch((error) => {
  console.error("[document-outbox-dispatcher] fatal", {
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  });
  process.exit(1);
});
