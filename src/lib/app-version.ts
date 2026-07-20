export const APP_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "development";

export const SERVICE_WORKER_VERSION_DATASET_KEY =
  "krwoServiceWorkerVersion" as const;
