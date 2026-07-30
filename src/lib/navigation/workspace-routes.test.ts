import { describe, expect, it } from "vitest";
import {
  getWorkspaceNavigationGroups,
  getWorkspaceNavigationItems,
  getWorkspaceShellMode,
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

  it("keeps the workspace in research order across navigation surfaces", () => {
    expect(
      getWorkspaceNavigationItems("ko", "/companies").map((item) => item.id),
    ).toEqual([
      "feed",
      "news",
      "companies",
      "perspectives",
      "discover",
      "wideResearch",
      "notebook",
      "chatHistory",
      "holdings",
    ]);
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

  it("keeps notebook and institutional holdings in separate drawer groups", () => {
    const groups = getWorkspaceNavigationGroups("en", "/watchlist/AAPL");

    expect(groups.find((group) => group.id === "research")).toMatchObject({
      label: "My research",
      items: [
        expect.objectContaining({ id: "notebook", active: true }),
        expect.objectContaining({ id: "chatHistory", desktop: false }),
      ],
    });
    expect(
      groups
        .find((group) => group.id === "monitor")
        ?.items.map((item) => item.id),
    ).toEqual(["holdings"]);
  });

  it("keeps chat history in the mobile research menu without adding a desktop tab", () => {
    const research = getWorkspaceNavigationGroups("ko", "/watchlist")
      .find((group) => group.id === "research");

    expect(research?.items.find((item) => item.id === "chatHistory")).toMatchObject({
      label: "최근 채팅",
      href: "/watchlist?tab=history",
      desktop: false,
    });
  });

  it("keeps filing alerts reachable without listing them in workspace navigation", () => {
    expect(getWorkspaceNavigationItems("ko", "/filings")).not.toContainEqual(
      expect.objectContaining({ id: "filings" }),
    );
  });
});
