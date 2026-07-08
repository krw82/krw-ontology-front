import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enqueueDocumentIngestionJob,
  getRedisQueueUrl,
  redisConnectionOptionsFromUrl,
} from "./bullmq-queue";

vi.mock("server-only", () => ({}));

describe("document ingestion BullMQ queue helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves queue Redis URLs with REDIS_QUEUE_URL precedence", () => {
    vi.stubEnv("DOCUMENT_QUEUE_REDIS_URL", "redis://localhost:6380/2");
    vi.stubEnv("REDIS_QUEUE_URL", "redis://localhost:6379/1");

    expect(getRedisQueueUrl()).toBe("redis://localhost:6379/1");
  });

  it("falls back to DOCUMENT_QUEUE_REDIS_URL", () => {
    vi.stubEnv("REDIS_QUEUE_URL", "");
    vi.stubEnv("DOCUMENT_QUEUE_REDIS_URL", "redis://localhost:6380/2");

    expect(getRedisQueueUrl()).toBe("redis://localhost:6380/2");
  });

  it("parses redis and rediss connection options without creating a Redis client", () => {
    expect(
      redisConnectionOptionsFromUrl("redis://user:pass@localhost:6380/2", {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      }),
    ).toMatchObject({
      host: "localhost",
      port: 6380,
      username: "user",
      password: "pass",
      db: 2,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });

    expect(redisConnectionOptionsFromUrl("rediss://cache.example.com")).toMatchObject(
      {
        host: "cache.example.com",
        port: 6379,
        tls: {},
      },
    );
  });

  it("skips enqueue when queue Redis is not configured", async () => {
    vi.stubEnv("REDIS_QUEUE_URL", "");
    vi.stubEnv("DOCUMENT_QUEUE_REDIS_URL", "");

    await expect(
      enqueueDocumentIngestionJob({
        queueJobId: "document-ingestion:job-1",
        payload: {
          schemaVersion: 1,
          jobId: "job-1",
          attachmentId: "attachment-1",
          userId: "user-1",
          storageKind: "local_fs",
          originalPath: "user-1/attachment-1/original.pdf",
          originalObjectPath: "user-1/attachment-1/original.pdf",
          contentHash: "hash",
        },
      }),
    ).resolves.toEqual({
      status: "skipped",
      reason: "missing_redis_queue_url",
    });
  });
});
