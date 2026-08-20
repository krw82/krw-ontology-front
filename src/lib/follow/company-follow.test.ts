import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/coverage/repository", () => ({
  CoverageLimitError: class CoverageLimitError extends Error {},
  setCompanyCoverageLevelWithEvent: vi.fn(),
}));
vi.mock("@/lib/filing-notifications/subscription-service", () => ({
  enableFilingSubscription: vi.fn(),
  disableFilingSubscription: vi.fn(),
}));
vi.mock("@/lib/market-issues/service", () => ({
  getMarketIssueServiceClient: vi.fn(() => ({ marker: "market-issue-db" })),
}));
vi.mock("@/lib/market-issues/repository", () => ({
  setMarketIssueCompanyFollow: vi.fn(),
}));
vi.mock("@/lib/retention/milestones", () => ({
  recordRetentionMilestone: vi.fn(),
}));

import {
  CoverageLimitError,
  setCompanyCoverageLevelWithEvent,
} from "@/lib/coverage/repository";
import {
  disableFilingSubscription,
  enableFilingSubscription,
} from "@/lib/filing-notifications/subscription-service";
import { setMarketIssueCompanyFollow } from "@/lib/market-issues/repository";
import { recordRetentionMilestone } from "@/lib/retention/milestones";
import { followCompanyServer, unfollowCompanyServer } from "./company-follow";

const coverageResult = {
  mark: { ticker: "AAPL", coverage_level: "interest" },
  eventId: "e1",
  previousLevel: null,
  changed: true,
  idempotentReplay: false,
};

describe("followCompanyServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setCompanyCoverageLevelWithEvent).mockResolvedValue(
      coverageResult as never,
    );
    vi.mocked(enableFilingSubscription).mockResolvedValue({ status: "on" });
    vi.mocked(setMarketIssueCompanyFollow).mockResolvedValue(undefined as never);
  });

  it("marks coverage, enables alerts and news follow together", async () => {
    const result = await followCompanyServer({
      userId: "u1",
      userEmail: "u@t",
      ticker: "AAPL",
    });
    expect(result).toMatchObject({ ok: true, alerts: "on", newsFollow: true });
    expect(setCompanyCoverageLevelWithEvent).toHaveBeenCalledWith(
      expect.objectContaining({ coverageLevel: "interest", ticker: "AAPL" }),
    );
    expect(setMarketIssueCompanyFollow).toHaveBeenCalledWith(
      expect.objectContaining({ following: true }),
    );
    expect(recordRetentionMilestone).toHaveBeenCalledWith("u1", "first_company_followed", { ticker: "AAPL" });
    expect(recordRetentionMilestone).toHaveBeenCalledWith("u1", "first_filing_subscription", { ticker: "AAPL" });
  });

  it("degrades alerts to no_sec_id without failing the follow", async () => {
    vi.mocked(enableFilingSubscription).mockResolvedValue({ status: "unsupported" });
    const result = await followCompanyServer({
      userId: "u1",
      userEmail: "u@t",
      ticker: "XXXX",
    });
    expect(result).toMatchObject({ ok: true, alerts: "no_sec_id" });
    expect(recordRetentionMilestone).not.toHaveBeenCalledWith(
      "u1",
      "first_filing_subscription",
      expect.anything(),
    );
  });

  it("reports limit_reached without touching subscriptions", async () => {
    vi.mocked(setCompanyCoverageLevelWithEvent).mockRejectedValue(
      new CoverageLimitError(),
    );
    const result = await followCompanyServer({
      userId: "u1",
      userEmail: "u@t",
      ticker: "AAPL",
    });
    expect(result).toEqual({ ok: false, reason: "limit_reached" });
    expect(enableFilingSubscription).not.toHaveBeenCalled();
  });

  it("survives a news-follow failure", async () => {
    vi.mocked(setMarketIssueCompanyFollow).mockRejectedValue(
      new Error("db down"),
    );
    const result = await followCompanyServer({
      userId: "u1",
      userEmail: "u@t",
      ticker: "AAPL",
    });
    expect(result).toMatchObject({ ok: true, newsFollow: false });
  });

  it("does not repeat the first-follow milestone on idempotent replays", async () => {
    vi.mocked(setCompanyCoverageLevelWithEvent).mockResolvedValue({
      ...coverageResult,
      idempotentReplay: true,
    } as never);
    await followCompanyServer({ userId: "u1", userEmail: "u@t", ticker: "AAPL" });
    expect(recordRetentionMilestone).not.toHaveBeenCalledWith(
      "u1",
      "first_company_followed",
      expect.anything(),
    );
  });
});

describe("unfollowCompanyServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setCompanyCoverageLevelWithEvent).mockResolvedValue({
      ...coverageResult,
      mark: { ticker: "AAPL", coverage_level: null },
    } as never);
    vi.mocked(disableFilingSubscription).mockResolvedValue(true);
    vi.mocked(setMarketIssueCompanyFollow).mockResolvedValue(undefined as never);
  });

  it("clears coverage, disables alerts, unfollows news", async () => {
    const result = await unfollowCompanyServer({
      userId: "u1",
      userEmail: "u@t",
      ticker: "AAPL",
    });
    expect(result).toEqual({ ok: true });
    expect(setCompanyCoverageLevelWithEvent).toHaveBeenCalledWith(
      expect.objectContaining({ coverageLevel: null }),
    );
    expect(disableFilingSubscription).toHaveBeenCalledWith({
      userId: "u1",
      ticker: "AAPL",
    });
    expect(setMarketIssueCompanyFollow).toHaveBeenCalledWith(
      expect.objectContaining({ following: false }),
    );
  });

  it("still unfollows news when the subscription disable fails", async () => {
    vi.mocked(disableFilingSubscription).mockResolvedValue(false);
    const result = await unfollowCompanyServer({
      userId: "u1",
      userEmail: "u@t",
      ticker: "AAPL",
    });
    expect(result).toEqual({ ok: true });
    expect(setMarketIssueCompanyFollow).toHaveBeenCalled();
  });

  it("reports failure when the coverage clear throws", async () => {
    vi.mocked(setCompanyCoverageLevelWithEvent).mockRejectedValue(
      new Error("db down"),
    );
    const result = await unfollowCompanyServer({
      userId: "u1",
      userEmail: "u@t",
      ticker: "AAPL",
    });
    expect(result).toEqual({ ok: false });
  });
});
