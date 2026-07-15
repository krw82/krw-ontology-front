import { describe, expect, it } from "vitest";
import { buildCheckupCandidate } from "@/lib/pulse/sources/checkup";

describe("Pulse daily checkup", () => {
  const counts = { urgentFilings: 1, unreadFilings: 3, openQuestions: 2, staleNotes: 1 };

  it("does not appear before 08:30 in the user's timezone", () => {
    expect(buildCheckupCandidate(counts, "Asia/Seoul", new Date("2026-07-14T23:29:00.000Z"))).toBeNull();
  });

  it("appears at 08:30 and uses only deterministic counts", () => {
    const item = buildCheckupCandidate(counts, "Asia/Seoul", new Date("2026-07-14T23:30:00.000Z"));
    expect(item).toMatchObject({
      item_key: "checkup:2026-07-15",
      kind: "checkup",
      priority: "high",
      metadata: { urgent_filings: 1, unread_filings: 3, open_questions: 2, stale_notes: 1 },
    });
    expect(item?.body).toBe("안 읽은 공시 3건 · 열린 질문 2개 · 다시 볼 메모 1개");
  });

  it("stays hidden when there is nothing to review", () => {
    expect(buildCheckupCandidate(
      { urgentFilings: 0, unreadFilings: 0, openQuestions: 0, staleNotes: 0 },
      "Asia/Seoul",
      new Date("2026-07-15T03:00:00.000Z"),
    )).toBeNull();
  });

  it("uses the timezone's post-DST local clock", () => {
    expect(buildCheckupCandidate(counts, "America/New_York", new Date("2026-03-08T12:29:00.000Z"))).toBeNull();
    expect(buildCheckupCandidate(counts, "America/New_York", new Date("2026-03-08T12:30:00.000Z"))?.item_key).toBe("checkup:2026-03-08");
  });
});
