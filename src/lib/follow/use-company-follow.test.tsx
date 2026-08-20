import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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

import { useCompanyFollow } from "./use-company-follow";

function FollowStateProbe({
  ticker,
  initialFollowing,
}: {
  ticker: string;
  initialFollowing?: boolean;
}) {
  const state = useCompanyFollow(
    ticker,
    initialFollowing === undefined ? undefined : { initialFollowing },
  );
  return createElement(
    "span",
    { "data-follow-state": `${state.loading}|${state.following}|${state.unavailable}` },
  );
}

describe("useCompanyFollow initial state", () => {
  it("trusts initialFollowing instead of starting in the loading state", () => {
    const markup = renderToStaticMarkup(
      createElement(FollowStateProbe, { ticker: "AAPL", initialFollowing: true }),
    );
    expect(markup).toContain('data-follow-state="false|true|false"');
  });

  it("starts loading with following=false without the option", () => {
    const markup = renderToStaticMarkup(
      createElement(FollowStateProbe, { ticker: "AAPL" }),
    );
    expect(markup).toContain('data-follow-state="true|false|false"');
  });

  it("initialFollowing=false also skips the loading state", () => {
    const markup = renderToStaticMarkup(
      createElement(FollowStateProbe, { ticker: "AAPL", initialFollowing: false }),
    );
    expect(markup).toContain('data-follow-state="false|false|false"');
  });
});
