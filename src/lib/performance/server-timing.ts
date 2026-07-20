type TimingMetric = {
  name: string;
  duration: number;
};

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function timingName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40) || "work";
}

/**
 * Emits a small Server-Timing breakdown without logging user identifiers or
 * query contents. Browser DevTools and synthetic checks can then distinguish
 * auth, database, and composition time from network transfer time.
 */
export class ServerTiming {
  private readonly startedAt = now();
  private readonly metrics: TimingMetric[] = [];

  async measure<T>(name: string, operation: () => PromiseLike<T>): Promise<T> {
    const startedAt = now();
    try {
      return await operation();
    } finally {
      this.metrics.push({
        name: timingName(name),
        duration: Math.max(0, now() - startedAt),
      });
    }
  }

  headers(base: HeadersInit = {}): Headers {
    const headers = new Headers(base);
    const metrics = [
      ...this.metrics,
      { name: "total", duration: Math.max(0, now() - this.startedAt) },
    ];
    headers.set(
      "Server-Timing",
      metrics
        .map(({ name, duration }) => `${name};dur=${duration.toFixed(1)}`)
        .join(", "),
    );
    return headers;
  }
}
