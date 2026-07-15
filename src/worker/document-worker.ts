import { randomUUID } from "node:crypto";
import { DelayedError, Worker } from "bullmq";
import {
  DOCUMENT_INGESTION_QUEUE_NAME,
  getRedisQueueUrl,
  redisConnectionOptionsFromUrl,
  type DocumentIngestionQueuePayload,
} from "@/lib/document-ingestion/bullmq-queue";
import {
  DOCUMENT_ATTACHMENT_EXPIRY_RECONCILE_BATCH_SIZE,
  DOCUMENT_INGESTION_CONCURRENT_LIMIT,
  DOCUMENT_SOURCE_CLEANUP_BATCH_SIZE,
  DOCUMENT_WORKER_IDLE_LOG_INTERVAL_MS,
  DOCUMENT_WORKER_RECONCILE_INTERVAL_MS,
} from "@/lib/document-ingestion/config";
import { claimNextDocumentIngestionJob } from "@/lib/document-ingestion/job-queue";
import {
  DocumentIngestionClaimLostError,
  DocumentIngestionLeaseActiveError,
  runDocumentIngestionJob,
  runQueuedDocumentIngestionJob,
} from "@/lib/document-ingestion/job-runner";
import {
  reconcileDocumentSourceCleanupJobs,
  reconcileExpiredDocumentAttachmentCleanup,
} from "@/lib/document-ingestion/source-cleanup";

const WORKER_ID =
  process.env.DOCUMENT_WORKER_ID || `document-worker-${randomUUID()}`;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    function stop() {
      clearTimeout(timeout);
      resolve();
    }
    function finish() {
      signal.removeEventListener("abort", stop);
      resolve();
    }
    const timeout = setTimeout(finish, ms);
    signal.addEventListener("abort", stop, { once: true });
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

async function runDocumentSourceCleanupLoop(
  abortController: AbortController,
): Promise<void> {
  while (!abortController.signal.aborted) {
    try {
      const expired = await reconcileExpiredDocumentAttachmentCleanup(
        DOCUMENT_ATTACHMENT_EXPIRY_RECONCILE_BATCH_SIZE,
      );
      const cleaned = await reconcileDocumentSourceCleanupJobs(
        WORKER_ID,
        DOCUMENT_SOURCE_CLEANUP_BATCH_SIZE,
      );
      const processed = expired + cleaned;
      if (processed > 0) {
        console.info("[document-worker] reconciled source cleanup jobs", {
          workerId: WORKER_ID,
          processed,
          expired,
          cleaned,
        });
      }

      await sleep(
        processed > 0 ? 0 : DOCUMENT_WORKER_RECONCILE_INTERVAL_MS,
        abortController.signal,
      );
    } catch (error) {
      console.warn("[document-worker] source cleanup reconciliation failed", {
        workerId: WORKER_ID,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(DOCUMENT_WORKER_RECONCILE_INTERVAL_MS, abortController.signal);
    }
  }
}

async function runBullMqDocumentWorker() {
  const redisUrl = getRedisQueueUrl();
  if (!redisUrl) {
    throw new Error(
      "DOCUMENT_INGESTION_BACKEND=bullmq requires REDIS_QUEUE_URL or DOCUMENT_QUEUE_REDIS_URL",
    );
  }

  const worker = new Worker<DocumentIngestionQueuePayload>(
    DOCUMENT_INGESTION_QUEUE_NAME,
    async (job, token) => {
      if (!job.data?.jobId) {
        throw new Error("Document ingestion queue job is missing jobId");
      }
      try {
        await runQueuedDocumentIngestionJob(job.data.jobId, WORKER_ID);
      } catch (error) {
        if (
          error instanceof DocumentIngestionLeaseActiveError ||
          error instanceof DocumentIngestionClaimLostError
        ) {
          await job.moveToDelayed(
            error instanceof DocumentIngestionLeaseActiveError
              ? error.retryAt
              : Date.now() + 1_000,
            token,
          );
          throw new DelayedError();
        }
        throw error;
      }
    },
    {
      connection: redisConnectionOptionsFromUrl(redisUrl, {
        maxRetriesPerRequest: null,
      }),
      concurrency: DOCUMENT_INGESTION_CONCURRENT_LIMIT,
    },
  );

  worker.on("completed", (job) => {
    console.info("[document-worker] BullMQ job completed", {
      workerId: WORKER_ID,
      queueJobId: job.id,
      jobId: job.data.jobId,
    });
  });
  worker.on("failed", (job, error) => {
    console.warn("[document-worker] BullMQ job failed", {
      workerId: WORKER_ID,
      queueJobId: job?.id,
      jobId: job?.data.jobId,
      error: error.message,
    });
  });
  worker.on("error", (error) => {
    console.warn("[document-worker] BullMQ worker error", {
      workerId: WORKER_ID,
      error: error.message,
    });
  });

  console.info("[document-worker] started BullMQ backend", {
    workerId: WORKER_ID,
    queueName: DOCUMENT_INGESTION_QUEUE_NAME,
    concurrency: DOCUMENT_INGESTION_CONCURRENT_LIMIT,
  });

  const abortController = new AbortController();
  const cleanupLoop = runDocumentSourceCleanupLoop(abortController);
  await waitForStopSignal(abortController);

  await cleanupLoop;
  await worker.close();
  console.info("[document-worker] stopped BullMQ backend", {
    workerId: WORKER_ID,
  });
}

async function runLegacyDbDocumentWorker() {
  process.env.DOCUMENT_WORKER_ID = WORKER_ID;
  const abortController = new AbortController();
  const activeJobs = new Set<Promise<void>>();
  let lastIdleLogAt = 0;

  console.info("[document-worker] started legacy DB backend", {
    workerId: WORKER_ID,
    concurrency: DOCUMENT_INGESTION_CONCURRENT_LIMIT,
  });

  void waitForStopSignal(abortController);
  const cleanupLoop = runDocumentSourceCleanupLoop(abortController);

  while (!abortController.signal.aborted) {
    while (
      activeJobs.size < DOCUMENT_INGESTION_CONCURRENT_LIMIT &&
      !abortController.signal.aborted
    ) {
      const claim = await claimNextDocumentIngestionJob(WORKER_ID);
      if (!claim) break;

      const jobPromise = runDocumentIngestionJob(
        claim.jobId,
        WORKER_ID,
        claim.claimToken,
      ).catch(
        (error) => {
          console.warn("[document-worker] job crashed", {
            jobId: claim.jobId,
            error:
              error instanceof Error ? error.stack ?? error.message : String(error),
          });
        },
      );
      activeJobs.add(jobPromise);
      jobPromise.finally(() => activeJobs.delete(jobPromise));
    }

    if (activeJobs.size === 0) {
      const now = Date.now();
      if (now - lastIdleLogAt > DOCUMENT_WORKER_IDLE_LOG_INTERVAL_MS) {
        console.info("[document-worker] idle", { workerId: WORKER_ID });
        lastIdleLogAt = now;
      }
      await sleep(DOCUMENT_WORKER_RECONCILE_INTERVAL_MS, abortController.signal);
      continue;
    }

    await Promise.race([
      ...activeJobs,
      sleep(DOCUMENT_WORKER_RECONCILE_INTERVAL_MS, abortController.signal),
    ]);
  }

  await Promise.allSettled([...activeJobs, cleanupLoop]);
  console.info("[document-worker] stopped legacy DB backend", {
    workerId: WORKER_ID,
  });
}

async function main() {
  const backend = process.env.DOCUMENT_INGESTION_BACKEND || "legacy_db";
  if (backend === "bullmq") {
    await runBullMqDocumentWorker();
    return;
  }

  await runLegacyDbDocumentWorker();
}

main().catch((error) => {
  console.error("[document-worker] fatal", {
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  });
  process.exit(1);
});
