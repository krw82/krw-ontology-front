import { randomUUID } from "node:crypto";
import {
  DOCUMENT_INGESTION_CONCURRENT_LIMIT,
  DOCUMENT_WORKER_IDLE_LOG_INTERVAL_MS,
  DOCUMENT_WORKER_RECONCILE_INTERVAL_MS,
} from "@/lib/document-ingestion/config";
import { claimNextDocumentIngestionJob } from "@/lib/document-ingestion/job-queue";
import { runDocumentIngestionJob } from "@/lib/document-ingestion/job-runner";

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

async function main() {
  process.env.DOCUMENT_WORKER_ID = WORKER_ID;
  const abortController = new AbortController();
  const activeJobs = new Set<Promise<void>>();
  let lastIdleLogAt = 0;

  console.info("[document-worker] started", {
    workerId: WORKER_ID,
    concurrency: DOCUMENT_INGESTION_CONCURRENT_LIMIT,
  });

  void waitForStopSignal(abortController);

  while (!abortController.signal.aborted) {
    while (
      activeJobs.size < DOCUMENT_INGESTION_CONCURRENT_LIMIT &&
      !abortController.signal.aborted
    ) {
      const jobId = await claimNextDocumentIngestionJob(WORKER_ID);
      if (!jobId) break;

      const jobPromise = runDocumentIngestionJob(jobId, WORKER_ID).catch(
        (error) => {
          console.warn("[document-worker] job crashed", {
            jobId,
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

  await Promise.allSettled(activeJobs);
  console.info("[document-worker] stopped", { workerId: WORKER_ID });
}

main().catch((error) => {
  console.error("[document-worker] fatal", {
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  });
  process.exit(1);
});
