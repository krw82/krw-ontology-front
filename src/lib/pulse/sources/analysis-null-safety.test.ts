import { describe, expect, it } from "vitest";
import { buildAnalysisCandidates } from "@/lib/pulse/sources/analysis";

describe("buildAnalysisCandidates null safety", () => {
  it("survives session with null title", () => {
    const session = {
      id: "s1",
      title: null as unknown as string,
      default_tickers: [],
      latest_run_status: "completed" as const,
      updated_at: "2026-08-05T00:00:00.000Z",
    };
    const run = {
      id: "r1",
      session_id: "s1",
      user_message_id: "m1",
      assistant_message_id: null,
      status: "completed" as const,
      queued_at: "2026-08-05T00:00:00.000Z",
      started_at: "2026-08-05T00:00:00.000Z",
      finished_at: "2026-08-05T00:01:00.000Z",
    };
    const messages = new Map([["m1", { id: "m1", content: "테스트 질문" }]]);
    
    expect(() => buildAnalysisCandidates([session], [run], messages, new Date("2026-08-05T00:30:00.000Z"))).not.toThrow();
  });

  it("survives message with null content", () => {
    const session = {
      id: "s2",
      title: "제목",
      default_tickers: ["AAPL"],
      latest_run_status: "completed" as const,
      updated_at: "2026-08-05T00:00:00.000Z",
    };
    const run = {
      id: "r2",
      session_id: "s2",
      user_message_id: "m2",
      assistant_message_id: null,
      status: "completed" as const,
      queued_at: "2026-08-05T00:00:00.000Z",
      started_at: "2026-08-05T00:00:00.000Z",
      finished_at: "2026-08-05T00:01:00.000Z",
    };
    const messages = new Map([["m2", { id: "m2", content: null as unknown as string }]]);
    
    expect(() => buildAnalysisCandidates([session], [run], messages, new Date("2026-08-05T00:30:00.000Z"))).not.toThrow();
  });

  it("survives message missing from map", () => {
    const session = {
      id: "s3",
      title: "제목",
      default_tickers: ["AAPL"],
      latest_run_status: "completed" as const,
      updated_at: "2026-08-05T00:00:00.000Z",
    };
    const run = {
      id: "r3",
      session_id: "s3",
      user_message_id: "missing-msg",
      assistant_message_id: null,
      status: "completed" as const,
      queued_at: "2026-08-05T00:00:00.000Z",
      started_at: "2026-08-05T00:00:00.000Z",
      finished_at: "2026-08-05T00:01:00.000Z",
    };
    const messages = new Map<string, { id: string; content: string }>();
    
    expect(() => buildAnalysisCandidates([session], [run], messages, new Date("2026-08-05T00:30:00.000Z"))).not.toThrow();
  });
});
