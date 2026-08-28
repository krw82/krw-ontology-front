import { describe, expect, it } from "vitest";
import {
  buildPulseResumeItems,
  resolveResumeScan,
  RESUME_MAX_ITEMS,
  RESUME_MAX_NEW_ITEMS,
  RESUME_MAX_SCAN_TICKERS,
  type ResumeCandidateEntityRow,
  type ResumeCandidateIssueRow,
  type ResumeSeenEntityRow,
  type ResumeSeenIssueRow,
  type ResumeSeenStateRow,
  type ResumeUserStateRow,
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

function candidateIssue(
  id: string,
  publishedAt: string,
  titleKo: string | null = null,
): ResumeCandidateIssueRow {
  return { id, title_ko: titleKo, published_at: publishedAt };
}

function candidateEntity(
  issueId: string,
  ticker: string,
  entityName: string | null = null,
): ResumeCandidateEntityRow {
  return { issue_id: issueId, ticker, entity_name: entityName };
}

function userState(
  issueId: string,
  openedAt: string | null,
  isHidden = false,
): ResumeUserStateRow {
  return { issue_id: issueId, opened_at: openedAt, is_hidden: isHidden };
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

  it("관심 기업의 새 소식 하한은 관심 시각만 사용한다(방문 시각 영향 없음)", () => {
    const scan = resolveResumeScan({
      watchlistMarks: [mark("AAPL", "2026-08-15T00:00:00.000Z")],
      seenStates: [seenState("issue-aapl", "2026-08-18T00:00:00.000Z")],
      seenIssues: [seenIssue("issue-aapl")],
      seenEntities: [seenEntity("issue-aapl", "AAPL")],
    });

    expect(scan.cutoff_by_ticker.get("AAPL")?.toISOString()).toBe(
      "2026-08-15T00:00:00.000Z",
    );
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
      userStates: [],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      ticker: "AAPL",
      is_watchlist: true,
      new_count: 0,
      new_items: [],
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
        candidateIssue("issue-new", "2026-08-19T00:00:00.000Z", "새 기사"),
        candidateIssue("issue-old", "2026-08-17T00:00:00.000Z", "옛 기사"),
      ],
      candidateEntities: [
        candidateEntity("issue-new", "AAPL"),
        candidateEntity("issue-old", "AAPL"),
      ],
      userStates: [],
    });

    expect(result.items[0]).toMatchObject({ ticker: "AAPL", new_count: 1 });
    expect(result.items[0].new_items).toEqual([
      { issue_id: "issue-new", title_ko: "새 기사", published_at: "2026-08-19T00:00:00.000Z" },
    ]);
  });

  it("관심 기업은 열지 않는 한 마지막 방문 이전 발행분도 새 소식으로 남는다", () => {
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
      userStates: [userState("issue-seen", lastSeenAt)],
    });

    expect(result.items[0]).toMatchObject({ ticker: "AAPL", new_count: 2 });
    expect(result.items[0].new_items.map((item) => item.issue_id)).toEqual([
      "issue-after-seen",
      "issue-between",
    ]);
  });

  it("열어본 기사는 새 소식에서 제외된다", () => {
    const followedAt = "2026-08-15T00:00:00.000Z";
    const scan = resolveResumeScan({
      watchlistMarks: [mark("AAPL", followedAt)],
      seenStates: [],
      seenIssues: [],
      seenEntities: [],
    });
    const result = buildPulseResumeItems({
      scan,
      candidateIssues: [
        candidateIssue("issue-read", "2026-08-16T00:00:00.000Z"),
        candidateIssue("issue-fresh", "2026-08-17T00:00:00.000Z"),
      ],
      candidateEntities: [
        candidateEntity("issue-read", "AAPL"),
        candidateEntity("issue-fresh", "AAPL"),
      ],
      userStates: [userState("issue-read", "2026-08-16T12:00:00.000Z")],
    });

    expect(result.items[0]).toMatchObject({ ticker: "AAPL", new_count: 1 });
    expect(result.items[0].new_items.map((item) => item.issue_id)).toEqual([
      "issue-fresh",
    ]);
  });

  it("숨긴 기사는 새 소식에서 제외된다", () => {
    const followedAt = "2026-08-15T00:00:00.000Z";
    const scan = resolveResumeScan({
      watchlistMarks: [mark("AAPL", followedAt)],
      seenStates: [],
      seenIssues: [],
      seenEntities: [],
    });
    const result = buildPulseResumeItems({
      scan,
      candidateIssues: [
        candidateIssue("issue-hidden", "2026-08-16T00:00:00.000Z"),
        candidateIssue("issue-fresh", "2026-08-17T00:00:00.000Z"),
      ],
      candidateEntities: [
        candidateEntity("issue-hidden", "AAPL"),
        candidateEntity("issue-fresh", "AAPL"),
      ],
      userStates: [userState("issue-hidden", null, true)],
    });

    expect(result.items[0]).toMatchObject({ ticker: "AAPL", new_count: 1 });
    expect(result.items[0].new_items.map((item) => item.issue_id)).toEqual([
      "issue-fresh",
    ]);
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
      userStates: [userState("issue-seen", lastSeenAt)],
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
      userStates: [],
    });

    expect(result.items.map((item) => item.ticker)).toEqual(["NVDA"]);
    expect(result.items[0].is_watchlist).toBe(false);
  });

  it("최근 본 비관심 기업도 열어본 기사는 제외된다", () => {
    const scan = resolveResumeScan({
      watchlistMarks: [],
      seenStates: [seenState("issue-nvda", "2026-08-15T00:00:00.000Z")],
      seenIssues: [seenIssue("issue-nvda")],
      seenEntities: [seenEntity("issue-nvda", "NVDA")],
    });
    const result = buildPulseResumeItems({
      scan,
      candidateIssues: [
        candidateIssue("v-old", "2026-08-14T00:00:00.000Z"),
        candidateIssue("v-opened", "2026-08-16T00:00:00.000Z"),
        candidateIssue("v-new", "2026-08-17T00:00:00.000Z"),
      ],
      candidateEntities: [
        candidateEntity("v-old", "NVDA"),
        candidateEntity("v-opened", "NVDA"),
        candidateEntity("v-new", "NVDA"),
      ],
      userStates: [userState("v-opened", "2026-08-16T12:00:00.000Z")],
    });

    expect(result.items[0]).toMatchObject({ ticker: "NVDA", new_count: 1 });
    expect(result.items[0].new_items.map((item) => item.issue_id)).toEqual(["v-new"]);
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
      userStates: [],
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
      userStates: [],
    });

    expect(result.items[0]).toMatchObject({ ticker: "AAPL", new_count: 0, new_items: [] });
  });

  it("new_items는 최신순으로 상한까지만, new_count는 전체 개수를 센다", () => {
    const followedAt = "2026-08-10T00:00:00.000Z";
    const total = RESUME_MAX_NEW_ITEMS + 3;
    const scan = resolveResumeScan({
      watchlistMarks: [mark("AAPL", followedAt)],
      seenStates: [],
      seenIssues: [],
      seenEntities: [],
    });
    const result = buildPulseResumeItems({
      scan,
      candidateIssues: Array.from({ length: total }, (_, i) =>
        candidateIssue(
          `issue-${String(i).padStart(2, "0")}`,
          new Date(Date.parse("2026-08-11T00:00:00.000Z") + i * 3_600_000).toISOString(),
        ),
      ),
      candidateEntities: Array.from({ length: total }, (_, i) =>
        candidateEntity(`issue-${String(i).padStart(2, "0")}`, "AAPL"),
      ),
      userStates: [],
    });

    expect(result.items[0].new_count).toBe(total);
    expect(result.items[0].new_items).toHaveLength(RESUME_MAX_NEW_ITEMS);
    expect(result.items[0].new_items[0].issue_id).toBe(
      `issue-${String(total - 1).padStart(2, "0")}`,
    );
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
      userStates: [],
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
      userStates: [],
    });

    expect(result.items).toHaveLength(RESUME_MAX_ITEMS);
    expect(result.overflow_count).toBe(2);
  });
});
