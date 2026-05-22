import { expect, test } from "@playwright/test";

test.describe("dev auth bypass", () => {
  test("opens protected companies page with stable account nav", async ({
    page,
  }, testInfo) => {
    await page.goto("/companies");

    await expect(page).toHaveURL(/\/companies$/);
    await expect(
      page.getByRole("heading", { name: "분석할 회사를 고르세요." }),
    ).toBeVisible();

    await expect(page.getByRole("button", { name: "로그인" })).toHaveCount(0);

    const accountButton = page
      .getByRole("button", { name: "Dev User 계정 메뉴" })
      .first();
    await expect(accountButton).toBeVisible();
    await page.waitForLoadState("networkidle");

    const accountBox = await accountButton.boundingBox();
    expect(accountBox).not.toBeNull();
    const maxAccountSize =
      testInfo.project.name === "mobile-chrome" ? 38 : 42;
    expect(accountBox?.width).toBeLessThanOrEqual(maxAccountSize);
    expect(accountBox?.height).toBeLessThanOrEqual(maxAccountSize);

    await accountButton.click();
    await expect(page.getByText("dev@krw-ontology.local")).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /로그아웃/ }),
    ).toBeVisible();
  });

  test("redirects login away when dev auth bypass is enabled", async ({ page }) => {
    await page.goto("/login");

    await expect(page).toHaveURL(/\/companies$/);
  });

  test("opens chat workspace without Google login", async ({ page }) => {
    await page.goto("/chat");

    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByLabel("채팅 메시지")).toBeVisible();
    await expect(page.getByPlaceholder("기업에 대해 질문하세요...")).toBeVisible();
  });
});

test.describe("public pages", () => {
  test("renders home, privacy, and terms", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("main").getByText("근거가 보이는").first(),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByText("기업 분석 AI").first(),
    ).toBeVisible();

    await page.goto("/privacy");
    await expect(
      page.getByRole("heading", { name: "개인정보처리방침" }),
    ).toBeVisible();

    await page.goto("/terms");
    await expect(page.getByRole("heading", { name: "서비스 약관" })).toBeVisible();
  });
});

test.describe("protected API under dev auth bypass", () => {
  test("returns indexed company data", async ({ request }) => {
    const response = await request.get("/api/companies?ticker=AMZN");

    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      companies?: Array<{ ticker?: string }>;
      count?: number;
    };
    expect(body.count).toBe(1);
    expect(body.companies?.[0]?.ticker).toBe("AMZN");
  });
});
