import { describe, expect, it } from "vitest";
import {
  getWorkspaceNavigationGroups,
  getWorkspaceNavigationItems,
  getWorkspaceShellMode,
  getWorkspaceTabItems,
} from "./workspace-routes";

describe("workspace route model", () => {
  it.each([
    ["/pulse", "standard"],
    ["/pulse/settings", "standard"],
    ["/ko/companies", "standard"],
    ["/en/companies/AAPL", "standard"],
    ["/watchlist/AAPL", "standard"],
    ["/filings/event-1", "standard"],
    ["/institutional-holdings", "standard"],
    ["/settings/billing", "standard"],
    ["/chat/new", "immersive"],
    ["/discover", "immersive"],
    ["/guru", "self-managed"],
    ["/ko/pricing", "public"],
    ["/login", "public"],
  ] as const)("classifies %s as %s", (pathname, expected) => {
    expect(getWorkspaceShellMode(pathname)).toBe(expected);
  });

  it("builds exactly four Korean primary tabs with one active item", () => {
    const tabs = getWorkspaceTabItems("ko", "/ko/companies/AAPL");

    expect(tabs.map(({ id, label, href }) => ({ id, label, href }))).toEqual([
      { id: "feed", label: "피드", href: "/pulse" },
      { id: "explore", label: "탐색", href: "/ko/companies" },
      { id: "coverage", label: "커버리지", href: "/watchlist" },
      { id: "filings", label: "공시", href: "/filings" },
    ]);
    expect(tabs.filter((tab) => tab.active).map((tab) => tab.id)).toEqual([
      "explore",
    ]);
  });

  it("uses locale paths for public company tabs and locale queries for app tabs", () => {
    const tabs = getWorkspaceTabItems("en", "/pulse");

    expect(tabs.map(({ id, href }) => ({ id, href }))).toEqual([
      { id: "feed", href: "/pulse?locale=en" },
      { id: "explore", href: "/en/companies" },
      { id: "coverage", href: "/watchlist?locale=en" },
      { id: "filings", href: "/filings?locale=en" },
    ]);
    expect(tabs.filter((tab) => tab.active).map((tab) => tab.id)).toEqual([
      "feed",
    ]);
  });

  it("maps secondary explore routes to the explore tab without changing their shell mode", () => {
    expect(
      getWorkspaceTabItems("ko", "/discover").find((tab) => tab.active)?.id,
    ).toBe("explore");
    expect(
      getWorkspaceTabItems("ko", "/guru").find((tab) => tab.active)?.id,
    ).toBe("explore");
    expect(getWorkspaceShellMode("/discover")).toBe("immersive");
    expect(getWorkspaceShellMode("/guru")).toBe("self-managed");
  });

  it("keeps the drawer route model locale-aware", () => {
    const items = getWorkspaceNavigationItems("en", "/en/companies/AAPL");
    const companies = items.find((item) => item.id === "companies");
    const notebook = items.find((item) => item.id === "notebook");

    expect(companies).toMatchObject({
      href: "/en/companies",
      active: true,
    });
    expect(notebook).toMatchObject({
      href: "/watchlist?locale=en",
      active: false,
    });
  });

  it("keeps wide research in the mobile drawer without adding it to desktop navigation", () => {
    const groups = getWorkspaceNavigationGroups("ko", "/pulse");
    const explore = groups.find((group) => group.id === "explore");

    expect(explore?.items.find((item) => item.id === "wideResearch")).toMatchObject(
      {
        label: "와이드 리서치",
        desktop: false,
        onboardingTarget: "wide-research-nav",
      },
    );
  });

  it("keeps notebook and monitoring destinations in separate drawer groups", () => {
    const groups = getWorkspaceNavigationGroups("en", "/watchlist/AAPL");

    expect(groups.find((group) => group.id === "research")).toMatchObject({
      label: "My research",
      items: [expect.objectContaining({ id: "notebook", active: true })],
    });
    expect(
      groups
        .find((group) => group.id === "monitor")
        ?.items.map((item) => item.id),
    ).toEqual(["filings", "holdings"]);
  });
});
