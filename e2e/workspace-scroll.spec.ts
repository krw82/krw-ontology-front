import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test.describe("standard workspace scroll restoration", () => {
  test("restores the previous route position and isolates locale entries", async ({
    page,
  }) => {
    await page.goto("/companies", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "전체 메뉴 열기" }))
      .toHaveAttribute("data-workspace-menu-ready", "true");
    await expect(
      page.locator(
        '[data-workspace-scroll-content][data-workspace-scroll-restoration-ready="true"]',
      ),
    ).toBeVisible();
    await page.addStyleTag({
      content:
        "html { overflow-anchor: none !important; } body { min-height: 4000px !important; }",
    });

    await page.evaluate(() => window.scrollTo(0, 820));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(820);
    await expect
      .poll(() =>
        page.evaluate(() => {
          for (let index = 0; index < sessionStorage.length; index += 1) {
            const key = sessionStorage.key(index);
            if (!key?.includes(":ko:companies:")) continue;
            const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as {
              y?: number;
            } | null;
            if (value?.y === 820) return true;
          }
          return false;
        }),
      )
      .toBe(true);

    await page.goto("/pulse", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "전체 메뉴 열기" }))
      .toHaveAttribute("data-workspace-menu-ready", "true");

    await page.goto("/companies", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "전체 메뉴 열기" }))
      .toHaveAttribute("data-workspace-menu-ready", "true");
    await page.addStyleTag({
      content:
        "html { overflow-anchor: none !important; } body { min-height: 4000px !important; }",
    });
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(820);

    await page.goto("/en/companies", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Open workspace menu" }))
      .toHaveAttribute("data-workspace-menu-ready", "true");
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(0);
  });
});
