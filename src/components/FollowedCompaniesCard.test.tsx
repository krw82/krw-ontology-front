import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FollowedCompanySummary } from "@/lib/follow/company-follow";

vi.mock("@/components/pwa/lifecycle", () => ({
  signalPwaInstallEngagement: vi.fn(),
}));
vi.mock("@/lib/analytics/client", () => ({
  trackClientEventSilently: vi.fn(),
}));
vi.mock("@/lib/filing-notifications/client", () => ({
  isIOSBrowser: vi.fn(() => false),
  isStandaloneDisplayMode: vi.fn(() => false),
  isWebPushSupported: vi.fn(() => true),
}));
vi.mock("@/lib/filing-notifications/push-subscription-client", () => ({
  getCurrentDevicePushSubscription: vi.fn(async () => null),
  subscribeCurrentDevice: vi.fn(async () => "granted"),
}));

import FollowedCompaniesCard from "./FollowedCompaniesCard";

function companies(
  ...entries: Array<[string, string, string | null]>
): FollowedCompanySummary[] {
  return entries.map(([ticker, name, sector]) => ({
    ticker,
    name,
    sector,
    followed_at: "2026-08-20T00:00:00Z",
  }));
}

function renderCard(props: {
  initialCompanies: FollowedCompanySummary[];
  activeLimit: number | null;
  hasNotebook?: boolean;
}): string {
  return renderToStaticMarkup(
    createElement(FollowedCompaniesCard, {
      hasNotebook: false,
      ...props,
    }),
  );
}

describe("FollowedCompaniesCard", () => {
  it("renders the follow list with count and unfollow actions", () => {
    const markup = renderCard({
      initialCompanies: companies(
        ["AAPL", "Apple", "Technology"],
        ["TSLA", "Tesla", "Automotive"],
      ),
      activeLimit: 3,
    });
    expect(markup).toContain("Apple");
    expect(markup).toContain("AAPL · Technology");
    expect(markup).toContain("Tesla");
    expect(markup).toContain("2 / 3개");
    expect(markup).toContain("해제");
    expect(markup).toContain("/companies/AAPL");
    expect(markup).not.toContain("가득 찼어요");
  });

  it("shows the limit upsell when the free plan is full", () => {
    const markup = renderCard({
      initialCompanies: companies(
        ["AAPL", "Apple", "Technology"],
        ["TSLA", "Tesla", null],
        ["MSFT", "Microsoft", null],
      ),
      activeLimit: 3,
    });
    expect(markup).toContain("3 / 3개");
    expect(markup).toContain("관심 기업이 가득 찼어요");
    expect(markup).toContain("무료 플랜은 3개까지");
    expect(markup).toContain("/pricing");
  });

  it("renders unlimited count without limit copy for paid plans", () => {
    const markup = renderCard({
      initialCompanies: companies(["AAPL", "Apple", "Technology"]),
      activeLimit: null,
    });
    expect(markup).toContain("1개");
    expect(markup).not.toContain("/ 3");
    expect(markup).not.toContain("가득 찼어요");
    expect(markup).not.toContain("무료 플랜은");
  });

  it("shows the empty state with a browse link", () => {
    const markup = renderCard({
      initialCompanies: [],
      activeLimit: 3,
    });
    expect(markup).toContain("아직 관심 기업이 없어요");
    expect(markup).toContain("회사 둘러보기");
    expect(markup).toContain("/companies");
  });

  it("links pro users to the research notebook", () => {
    const withNotebook = renderCard({
      initialCompanies: companies(["AAPL", "Apple", null]),
      activeLimit: null,
      hasNotebook: true,
    });
    expect(withNotebook).toContain("리서치 노트북에서 노트·질문까지 관리");
    expect(withNotebook).toContain("/watchlist");

    const withoutNotebook = renderCard({
      initialCompanies: companies(["AAPL", "Apple", null]),
      activeLimit: 3,
      hasNotebook: false,
    });
    expect(withoutNotebook).not.toContain("리서치 노트북에서 노트·질문까지 관리");
  });
});
