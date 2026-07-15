import { describe, expect, it } from "vitest";
import {
  getWorkspaceNavigationGroups,
  getWorkspaceNavigationItems,
} from "@/lib/navigation/workspace-routes";

describe("workspace navigation routes", () => {
  it("marks a nested company page as the active workspace", () => {
    const items = getWorkspaceNavigationItems("ko", "/ko/companies/AAPL");
    const companies = items.find((item) => item.id === "companies");

    expect(companies).toMatchObject({
      active: true,
      href: "/ko/companies",
      label: "회사",
    });
    expect(items.filter((item) => item.active)).toEqual([companies]);
  });

  it("shares mobile-only wide research with the explore group but not desktop navigation", () => {
    const groups = getWorkspaceNavigationGroups("ko", "/pulse");
    const explore = groups.find((group) => group.id === "explore");
    const wideResearch = explore?.items.find((item) => item.id === "wideResearch");

    expect(wideResearch).toMatchObject({
      label: "와이드 리서치",
      desktop: false,
      onboardingTarget: "wide-research-nav",
    });
  });

  it("keeps notebook and monitoring destinations in their own mobile menu sections", () => {
    const groups = getWorkspaceNavigationGroups("en", "/watchlist/AAPL");

    expect(groups.find((group) => group.id === "research")).toMatchObject({
      label: "My research",
      items: [expect.objectContaining({ id: "notebook", active: true })],
    });
    expect(groups.find((group) => group.id === "monitor")?.items.map((item) => item.id)).toEqual([
      "filings",
      "holdings",
    ]);
  });
});
