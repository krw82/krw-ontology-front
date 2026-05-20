import { expect, test } from "@playwright/test";

test.describe("dev auth bypass", () => {
  test("opens protected companies page without Google login", async ({ page }) => {
    await page.goto("/companies");

    await expect(page).toHaveURL(/\/companies$/);
    await expect(
      page.getByRole("heading", { name: /회사명을 몰라도 질문 하나로 시작합니다/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Dev User 계정 메뉴" }).first(),
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
    await expect(page.getByPlaceholder("후속 질문을 입력하세요...")).toBeVisible();
  });
});

test.describe("public pages", () => {
  test("renders home, privacy, and terms", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("main").getByText("기업 질문을").first(),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByText("근거 그래프로").first(),
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
