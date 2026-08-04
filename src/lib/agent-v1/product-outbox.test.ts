import { describe, expect, it } from "vitest";
import {
  dispatchProductOutboxOnce,
  type AgentV1OutboxPort,
  type AgentV1OutboxReceipt,
} from "./product-outbox";

const RUN_ID = "10000000-0000-4000-8000-000000000001";

describe("dispatchProductOutboxOnce", () => {
  it("bounds process-wide concurrency and ACKs only after product apply", async () => {
    const port = new FakePort(Array.from({ length: 12 }, (_, index) => event(index + 1)));
    const report = await dispatchProductOutboxOnce(port, {
      workerId: "worker-1",
      claimLimit: 12,
      leaseMs: 30_000,
      concurrency: 3,
    });

    expect(port.maxActive).toBeLessThanOrEqual(3);
    expect(report).toEqual({
      claimed: 12,
      applied: 12,
      alreadyApplied: 0,
      delivered: 12,
      released: 0,
      ackFailures: 0,
    });
    for (const outboxId of port.successfulAcks) {
      expect(port.operations.indexOf(`apply:${outboxId}`)).toBeLessThan(
        port.operations.indexOf(`ack-success:${outboxId}`),
      );
    }
  });

  it("releases apply failures with a redacted hash", async () => {
    const port = new FakePort([event(1), event(2)]);
    port.failApply.add(2);
    const report = await dispatchProductOutboxOnce(port, {
      workerId: "worker-1",
      claimLimit: 2,
      leaseMs: 30_000,
      concurrency: 2,
    });

    expect(report.released).toBe(1);
    expect(port.failedAcks[0]).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(port.operations).not.toContain("ack-success:2");
  });

  it("does not negative-ACK a committed projection when success ACK is lost", async () => {
    const port = new FakePort([event(1)]);
    port.failSuccessAck.add(1);
    const report = await dispatchProductOutboxOnce(port, {
      workerId: "worker-1",
      claimLimit: 1,
      leaseMs: 30_000,
      concurrency: 1,
    });

    expect(report.ackFailures).toBe(1);
    expect(report.released).toBe(0);
    expect(port.failedAcks).toHaveLength(0);
  });
});

class FakePort implements AgentV1OutboxPort {
  active = 0;
  maxActive = 0;
  failApply = new Set<number>();
  failSuccessAck = new Set<number>();
  operations: string[] = [];
  successfulAcks: number[] = [];
  failedAcks: string[] = [];

  constructor(private readonly events: readonly AgentV1OutboxReceipt[]) {}

  async claim() {
    return this.events;
  }

  async apply(event: AgentV1OutboxReceipt) {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.operations.push(`apply:${event.outbox_id}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
    this.active -= 1;
    if (this.failApply.has(event.outbox_id)) throw new Error("contains-secret-that-must-not-leak");
    return "applied" as const;
  }

  async ack(
    _workerId: string,
    outboxId: number,
    result:
      | { readonly success: true }
      | { readonly success: false; readonly errorHash: `sha256:${string}` },
  ) {
    if (result.success) {
      this.operations.push(`ack-success:${outboxId}`);
      if (this.failSuccessAck.has(outboxId)) throw new Error("ack lost");
      this.successfulAcks.push(outboxId);
      return "delivered" as const;
    }
    this.operations.push(`ack-failure:${outboxId}`);
    this.failedAcks.push(result.errorHash);
    return "released" as const;
  }
}

function event(outboxId: number): AgentV1OutboxReceipt {
  return {
    outbox_id: outboxId,
    run_id: RUN_ID,
    event_kind: "answer.committed",
    dedupe_key: `${RUN_ID}:answer.committed:${outboxId}`,
    payload: {
      run_id: RUN_ID,
      answer_bundle_hash: `sha256:${"a".repeat(64)}`,
      rendered_message_hash: `sha256:${"b".repeat(64)}`,
    },
    delivery_attempts: 1,
    delivery_deadline: "2026-08-02T00:01:00.000Z",
  };
}
