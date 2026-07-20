import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("PWA manifest", () => {
  it("starts through the stable installed-app resolver", () => {
    const value = manifest();
    expect(value.start_url).toBe("/app?source=pwa");
    expect(value.scope).toBe("/");
    expect(value.display).toBe("standalone");
  });

  it("offers direct shortcuts to the core product loops", () => {
    const urls = manifest().shortcuts?.map((shortcut) => shortcut.url);
    expect(urls).toEqual([
      "/pulse?source=pwa_shortcut",
      "/chat/new?source=pwa_shortcut",
      "/watchlist?source=pwa_shortcut",
      "/filings?source=pwa_shortcut",
    ]);
  });
});
