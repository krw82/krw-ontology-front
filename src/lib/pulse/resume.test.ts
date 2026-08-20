import { describe, expect, it } from "vitest";
import {
  buildPulseResumeItems,
  resolveResumeScan,
  RESUME_MAX_ITEMS,
  RESUME_MAX_SCAN_TICKERS,
  type ResumeCandidateEntityRow,
  type ResumeCandidateIssueRow,
  type ResumeSeenEntityRow,
  type ResumeSeenIssueRow,
  type ResumeSeenStateRow,
  type ResumeWatchlistMarkRow,
} from "@/lib/pulse/resume";

function mark(ticker: string, createdAt: string | null): ResumeWatchlistMarkRow {
  return { ticker, created_at: createdAt };
}

function seenState(issueId: string, lastSeenAt: string): ResumeSeenStateRow {
  return { issue_id: issueId, last_seen_at: lastSeenAt };
}

function seenIssue(id: string): ResumeSeenIssueRow {
  return { id, title_ko: null };
}

function seenEntity(
  issueId: string,
  ticker: string,
  entityName: string | null = null,
): ResumeSeenEntityRow {
  return { issue_id: issueId, ticker, entity_name: entityName };
}

function candidateIssue(id: string, publishedAt: string): ResumeCandidateIssueRow {
  return { id, published_at: publishedAt };
}

function candidateEntity(
  issueId: string,
  ticker: string,
  entityName: string | null = null,
): ResumeCandidateEntityRow {
  return { issue_id: issueId, ticker, entity_name: entityName };
}

describe("resolveResumeScan", () => {
  it("스캔 순서는 관심 기업 먼저, 이후 최근 본 기업", () => {
    const scan = resolveResumeScan({
      watchlistMarks: [mark("AAPL", "2026-08-18T00:00:00.000Z")],
      seenStates: [seenState("issue-nvda", "2026-08-19T00:00:00.000Z")],
      seenIssues: [seenIssue("issue-nvda")],
      seenEntities: [seenEntity("issue-nvda", "NVDA")],
    });

    expect(scan.scan_tickers).toEqual(["AAPL", "NVDA"]);
    expect(scan.watchlist_tickers).toEqual(new Set(["AAPL"]));
  });

  it("관심 기업이 최근 본 기업과 겹치면 중복 없이 하나로", () => {
    const scan = resolveResumeScan({
      watchlistMarks: [mark("aapl", "2026-08-18T00:00:00.000Z")],
      seenStates: [seenState("issue-aapl", "2026-08-19T00:00:00.000Z")],
      seenIssues: [seenIssue("issue-aapl")],
      seenEntities: [seenEntity("issue-aapl", "AAPL")],
    });

    expect(scan.scan_tickers).toEqual(["AAPL"]);
    expect(scan.watchlist_tickers).toEqual(new Set(["AAPL"]));
  });

  it("스캔 티커는 관심 기업 우선으로 최대 상한까지만", () => {
    const marks = Array.from({ length: RESUME_MAX_SCAN_TICKERS + 3 }, (_, i) =>
      mark(`T${String(i).padStart(2, "0")}`, "2026-08-18T00:00:00.000Z"),
    );
    const scan = resolveResumeScan({
      watchlistMarks: marks,
      seenStates: [seenState("issue-nvda", "2026-08-19T00:00:00.000Z")],
      seenIssues: [seenIssue("issue-nvda")],
      seenEntities: [seenEntity("issue-nvda", "NVDA")],
    });

    expect(scan.scan_tickers).toHaveLength(RESUME_MAX_SCAN_TICKERS);
    expect(scan.watchlist_tickers.has("NVDA")).toBe(false);
  });

  it("티커 정규화: 소문자·공백 처리", () => {
    const scan = resolveResumeScan({
      watchlistMarks: [mark(" msft ", "2026-08-18T00:00:00.000Z")],
      seenStates: [],
      seenIssues: [],
      seenEntities: [],
    });

    expect(scan.scan_tickers).toEqual(["MSFT"]);
  });
});

describe("buildPulseResumeItems", () => {
  it("관심 기업은 새 소식이 없어도 트레이에 포함", () => {
    const scan = resolveResumeScan({
      watchlistMarks: [mark("AAPL", "2026-08-18T00:00:00.000Z")],
      seenStates: [],
      seenIssues: [],
      seenEntities: [],
    });
    const result = buildPulseResumeItems({
      scan,
      candidateIssues: [],
      candidateEntities: [],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      ticker: "AAPL",
      is_watchlist: true,
      new_count: 0,
      latest_issue_id: null,
    });
  });

  it("본 이력 없는 관심 기업은 관심 설정 시각 이후 발행분만 새 소식", () => {
    const followedAt = "2026-08-18T00:00:00.000Z";
    const scan = resolveResumeScan({
      watchlistMarks: [mark("AAPL", followedAt)],
      seenStates: [],
      seenIssues: [],
      seenEntities: [],
    });
    const result = buildPulseResumeItems({
      scan,
      candidateIssues: [
        candidateIssue("issue-new", "2026-08-19T00:00:00.000Z"),
        candidateIssue("issue-old", "2026-08-17T00:00:00.000Z"),
      ],
      candidateEntities: [
        candidateEntity("issue-new", "AAPL"),
        candidateEntity("issue-old", "AAPL"),
      ],
    });

    expect(result.items[0]).toMatchObject({
      ticker: "AAPL",
      new_count: 1,
      latest_issue_id: "issue-new",
    });
  });

  it("마지막 방문이 관심 설정보다 뒤면 방문 이후만 새 소식", () => {
    const followedAt = "2026-08-15T00:00:00.000Z";
    const lastSeenAt = "2026-08-18T00:00:00.000Z";
    const scan = resolveResumeScan({
      watchlistMarks: [mark("AAPL", followedAt)],
      seenStates: [seenState("issue-seen", lastSeenAt)],
      seenIssues: [seenIssue("issue-seen")],
      seenEntities: [seenEntity("issue-seen", "AAPL")],
    });
    const result = buildPulseResumeItems({
      scan,
      candidateIssues: [
        candidateIssue("issue-after-seen", "2026-08-19T00:00:00.000Z"),
        candidateIssue("issue-between", "2026-08-16T00:00:00.000Z"),
      ],
      candidateEntities: [
        candidateEntity("issue-after-seen", "AAPL"),
        candidateEntity("issue-between", "AAPL"),
      ],
    });

    expect(result.items[0]).toMatchObject({ ticker: "AAPL", new_count: 1 });
  });

  it("관심 설정이 마지막 방문보다 뒤면 관심 설정 이후만 새 소식", () => {
    const lastSeenAt = "2026-08-15T00:00:00.000Z";
    const followedAt = "2026-08-18T00:00:00.000Z";
    const scan = resolveResumeScan({
      watchlistMarks: [mark("AAPL", followedAt)],
      seenStates: [seenState("issue-seen", lastSeenAt)],
      seenIssues: [seenIssue("issue-seen")],
      seenEntities: [seenEntity("issue-seen", "AAPL")],
    });
    const result = buildPulseResumeItems({
      scan,
      candidateIssues: [
        candidateIssue("issue-after-follow", "2026-08-19T00:00:00.000Z"),
        candidateIssue("issue-between", "2026-08-16T00:00:00.000Z"),
      ],
      candidateEntities: [
        candidateEntity("issue-after-follow", "AAPL"),
        candidateEntity("issue-between", "AAPL"),
      ],
    });

    expect(result.items[0]).toMatchObject({ ticker: "AAPL", new_count: 1 });
  });

  it("최근 본 비관심 기업은 새 소식 있을 때만 포함", () => {
    const scan = resolveResumeScan({
      watchlistMarks: [],
      seenStates: [
        seenState("issue-nvda", "2026-08-15T00:00:00.000Z"),
        seenState("issue-msft", "2026-08-15T00:00:00.000Z"),
      ],
      seenIssues: [seenIssue("issue-nvda"), seenIssue("issue-msft")],
      seenEntities: [seenEntity("issue-nvda", "NVDA"), seenEntity("issue-msft", "MSFT")],
    });
    const result = buildPulseResumeItems({
      scan,
      candidateIssues: [candidateIssue("issue-nvda-new", "2026-08-19T00:00:00.000Z")],
      candidateEntities: [candidateEntity("issue-nvda-new", "NVDA")],
    });

    expect(result.items.map((item) => item.ticker)).toEqual(["NVDA"]);
    expect(result.items[0].is_watchlist).toBe(false);
  });

  it("관심 기업 그룹이 먼저, 그룹 안에서는 새 소식 많은 순", () => {
    const followedAt = "2026-08-15T00:00:00.000Z";
    const lastSeenAt = "2026-08-15T00:00:00.000Z";
    const scan = resolveResumeScan({
      watchlistMarks: [mark("AAPL", followedAt), mark("MSFT", followedAt)],
      seenStates: [seenState("issue-nvda", lastSeenAt)],
      seenIssues: [seenIssue("issue-nvda")],
      seenEntities: [seenEntity("issue-nvda", "NVDA")],
    });
    const result = buildPulseResumeItems({
      scan,
      candidateIssues: [
        candidateIssue("n1", "2026-08-19T03:00:00.000Z"),
        candidateIssue("n2", "2026-08-19T02:00:00.000Z"),
        candidateIssue("a1", "2026-08-19T01:00:00.000Z"),
        candidateIssue("v1", "2026-08-19T00:00:00.000Z"),
        candidateIssue("v2", "2026-08-18T23:00:00.000Z"),
        candidateIssue("v3", "2026-08-18T22:00:00.000Z"),
      ],
      candidateEntities: [
        candidateEntity("n1", "MSFT"),
        candidateEntity("n2", "MSFT"),
        candidateEntity("a1", "AAPL"),
        candidateEntity("v1", "NVDA"),
        candidateEntity("v2", "NVDA"),
        candidateEntity("v3", "NVDA"),
      ],
    });

    expect(result.items.map((item) => item.ticker)).toEqual(["MSFT", "AAPL", "NVDA"]);
    expect(result.items.map((item) => item.new_count)).toEqual([2, 1, 3]);
  });

  it("관심 시각을 알 수 없는 관심 기업은 새 소식 0으로 포함", () => {
    const scan = resolveResumeScan({
      watchlistMarks: [mark("AAPL", null)],
      seenStates: [],
      seenIssues: [],
      seenEntities: [],
    });
    const result = buildPulseResumeItems({
      scan,
      candidateIssues: [candidateIssue("issue-new", "2026-08-19T00:00:00.000Z")],
      candidateEntities: [candidateEntity("issue-new", "AAPL")],
    });

    expect(result.items[0]).toMatchObject({ ticker: "AAPL", new_count: 0 });
  });

  it("회사명은 최근 본 엔티티 이름 우선, 없으면 후보 엔티티 이름", () => {
    const followedAt = "2026-08-15T00:00:00.000Z";
    const scan = resolveResumeScan({
      watchlistMarks: [mark("AAPL", followedAt), mark("MSFT", followedAt)],
      seenStates: [seenState("issue-aapl", "2026-08-16T00:00:00.000Z")],
      seenIssues: [seenIssue("issue-aapl")],
      seenEntities: [seenEntity("issue-aapl", "AAPL", "애플")],
    });
    const result = buildPulseResumeItems({
      scan,
      candidateIssues: [candidateIssue("issue-msft", "2026-08-19T00:00:00.000Z")],
      candidateEntities: [candidateEntity("issue-msft", "MSFT", "마이크로소프트")],
    });

    const byTicker = new Map(result.items.map((item) => [item.ticker, item]));
    expect(byTicker.get("AAPL")?.company_name).toBe("애플");
    expect(byTicker.get("MSFT")?.company_name).toBe("마이크로소프트");
  });

  it("포함 대상이 상한을 넘으면 상한까지만 반환하고 초과 개수를 센다", () => {
    const followedAt = "2026-08-15T00:00:00.000Z";
    const tickers = Array.from({ length: RESUME_MAX_ITEMS + 2 }, (_, i) =>
      `T${String(i).padStart(2, "0")}`,
    );
    const scan = resolveResumeScan({
      watchlistMarks: tickers.map((ticker) => mark(ticker, followedAt)),
      seenStates: [],
      seenIssues: [],
      seenEntities: [],
    });
    const result = buildPulseResumeItems({
      scan,
      candidateIssues: [],
      candidateEntities: [],
    });

    expect(result.items).toHaveLength(RESUME_MAX_ITEMS);
    expect(result.overflow_count).toBe(2);
  });
});
