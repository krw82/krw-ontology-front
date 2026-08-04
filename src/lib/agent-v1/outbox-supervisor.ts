import {
  dispatchProductOutboxOnce,
  type AgentV1OutboxPort,
  type DispatchProductOutboxOptions,
  type DispatchProductOutboxReport,
} from "./product-outbox";

export interface ProductOutboxSupervisorOptions extends DispatchProductOutboxOptions {
  readonly idlePollMs: number;
  readonly failureBackoffMs: number;
  readonly signal: AbortSignal;
  readonly onReport?: (report: DispatchProductOutboxReport) => void;
  readonly onFailure?: (failure: { readonly class: string }) => void;
}

/** A single process-wide loop; concurrency exists only inside each bounded pass. */
export async function superviseProductOutbox(
  port: AgentV1OutboxPort,
  options: ProductOutboxSupervisorOptions,
): Promise<void> {
  while (!options.signal.aborted) {
    let delayMs = options.idlePollMs;
    try {
      const report = await dispatchProductOutboxOnce(port, options);
      options.onReport?.(report);
      delayMs = report.claimed === 0 ? options.idlePollMs : 0;
      if (report.released > 0 || report.ackFailures > 0) {
        delayMs = Math.max(delayMs, options.failureBackoffMs);
      }
    } catch (error) {
      options.onFailure?.({
        class:
          error instanceof Error && error.name.length <= 128
            ? error.name || "UnknownOutboxFailure"
            : "UnknownOutboxFailure",
      });
      delayMs = options.failureBackoffMs;
    }
    if (delayMs > 0) await abortableDelay(delayMs, options.signal);
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
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
