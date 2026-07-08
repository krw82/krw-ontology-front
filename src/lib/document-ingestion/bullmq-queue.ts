import "server-only";

import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";

export const DOCUMENT_INGESTION_QUEUE_NAME =
  process.env.DOCUMENT_INGESTION_QUEUE_NAME || "document-ingestion";

const DOCUMENT_INGESTION_JOB_NAME = "ingest-document";

export interface DocumentIngestionQueuePayload {
  schemaVersion: 1;
  jobId: string;
  attachmentId: string;
  userId: string;
  storageKind: "local_fs" | "object_storage";
  originalPath: string | null;
  originalObjectPath: string | null;
  contentHash: string | null;
}

export interface EnqueueDocumentIngestionJobInput {
  queueJobId: string;
  payload: DocumentIngestionQueuePayload;
}

export type EnqueueDocumentIngestionJobResult =
  | { status: "enqueued" }
  | { status: "skipped"; reason: "missing_redis_queue_url" };

let producerQueue: Queue | null | undefined;

export function getRedisQueueUrl(): string | null {
  return (
    process.env.REDIS_QUEUE_URL?.trim() ||
    process.env.DOCUMENT_QUEUE_REDIS_URL?.trim() ||
    null
  );
}

export function redisConnectionOptionsFromUrl(
  redisUrl: string,
  options: {
    enableOfflineQueue?: boolean;
    maxRetriesPerRequest?: number | null;
  } = {},
): ConnectionOptions {
  const parsed = new URL(redisUrl);
  const dbPath = parsed.pathname.replace(/^\//, "");
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: dbPath ? Number(dbPath) : undefined,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    enableOfflineQueue: options.enableOfflineQueue,
    maxRetriesPerRequest: options.maxRetriesPerRequest,
  } as ConnectionOptions;
}

function getDocumentIngestionQueue(): Queue | null {
  if (producerQueue !== undefined) return producerQueue;

  const redisUrl = getRedisQueueUrl();
  if (!redisUrl) {
    producerQueue = null;
    return producerQueue;
  }

  producerQueue = new Queue(DOCUMENT_INGESTION_QUEUE_NAME, {
    connection: redisConnectionOptionsFromUrl(redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    }),
  });

  producerQueue.on("error", (error) => {
    console.warn("[document-ingestion-queue] producer error", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return producerQueue;
}

export async function enqueueDocumentIngestionJob(
  input: EnqueueDocumentIngestionJobInput,
): Promise<EnqueueDocumentIngestionJobResult> {
  const queue = getDocumentIngestionQueue();
  if (!queue) return { status: "skipped", reason: "missing_redis_queue_url" };

  const options: JobsOptions = {
    jobId: input.queueJobId,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2_000,
    },
    removeOnComplete: {
      age: 24 * 60 * 60,
      count: 1_000,
    },
    removeOnFail: {
      age: 7 * 24 * 60 * 60,
      count: 5_000,
    },
  };

  await queue.add(DOCUMENT_INGESTION_JOB_NAME, input.payload, options);
  return { status: "enqueued" };
}
