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

    await expect(page).toHaveURL(/\/chat\/new$/);
    await expect(page.getByLabel("채팅 메시지")).toBeVisible();
    await expect(page.getByLabel("메시지 입력")).toBeEditable();
  });

  test("starts a new chat by creating a session before running the agent", async ({
    page,
  }) => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const runId = "22222222-2222-4222-8222-222222222222";
    const assistantMessageId = "44444444-4444-4444-8444-444444444444";
    const createdAt = new Date().toISOString();
    let createSessionRequestCount = 0;
    let runRequestCount = 0;
    const runRequestIds: string[] = [];

    await page.route("**/api/sessions", async (route) => {
      createSessionRequestCount += 1;
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          session: {
            id: sessionId,
            title: "새 채팅",
            scope_type: "global",
            default_tickers: [],
            default_document_types: [],
            created_at: createdAt,
            updated_at: createdAt,
          },
        }),
      });
    });

    await page.route(`**/api/chat/${sessionId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: {
            id: sessionId,
            title: "새 채팅",
            scope_type: "global",
            default_tickers: [],
            default_document_types: [],
            created_at: createdAt,
            updated_at: createdAt,
          },
          messages: [],
          runs: [],
          tool_calls: [],
          citations: [],
          rich_answers: [],
          research_artifacts: [],
        }),
      });
    });

    await page.route("**/api/chat/run", async (route) => {
      runRequestCount += 1;
      const body = route.request().postDataJSON() as {
        session_id?: string;
        content?: string;
        request_id?: string;
      };

      expect(body.session_id).toBe(sessionId);
      expect(body.content).toBe("테스트 질문");
      expect(body.request_id).toBeTruthy();
      if (runRequestIds.length > 0) {
        expect(body.request_id).toBe(runRequestIds[0]);
      }
      runRequestIds.push(body.request_id as string);
      expect(runRequestCount).toBeLessThanOrEqual(2);

      const event = (type: string, data: unknown) =>
        `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
      const stream = [
        event("run_started", {
          run_id: runId,
          message_id: assistantMessageId,
          session_id: sessionId,
          started_at: createdAt,
        }),
        event("done", {
          run_id: runId,
          message_id: assistantMessageId,
          content: "테스트 답변입니다.",
          release: {
            ontology_release_id: "test",
            index_generated_at: createdAt,
            company_count: 1,
            document_count: 1,
            krw_ontology_commit: "test",
            web_commit: "test",
          },
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            estimated_cost_usd: 0,
            latency_ms: 10,
          },
          execution_budget: {
            budget_used_usd: 0,
            budget_reserved_usd: 0,
            budget_limit_usd: 1,
            remaining_budget_usd: 1,
            daily_budget_used_usd: 0,
            daily_budget_reserved_usd: 0,
            daily_budget_limit_usd: 1,
            per_run_reserve_usd: 0,
            analysis_credits_used: 0,
            analysis_credits_reserved: 0,
            analysis_credits_limit: 10,
            remaining_analysis_credits: 10,
            daily_analysis_credits_used: 0,
            daily_analysis_credits_reserved: 0,
            daily_analysis_credits_limit: 10,
            per_run_analysis_credits: 1,
            run_count: 0,
            percent_used: 0,
            can_run: true,
          },
        }),
      ].join("");

      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-chat-session-id": sessionId,
        },
        body: stream,
      });
    });

    await page.goto("/chat/new");
    await page.evaluate(() => {
      try {
        sessionStorage.clear();
      } catch {
        // no-op: storage may be unavailable in edge contexts
      }
    });
    const composer = page.getByLabel("메시지 입력");
    const sendButton = page.getByRole("button", { name: "메시지 보내기" });
    await expect(composer).toBeEditable();
    await expect(composer).toHaveValue("");
    await composer.fill("테스트 질문");
    await expect(composer).toHaveValue("테스트 질문");
    const sendRequestBaseline = runRequestCount;
    await expect(sendButton).toBeEnabled({ timeout: 5000 });
    await sendButton.click();

    if (createSessionRequestCount === 0) {
      await expect
        .poll(() => createSessionRequestCount, { timeout: 5000 })
        .toBeGreaterThanOrEqual(1);
    }

    if (createSessionRequestCount === 0) {
      await composer.focus();
      await composer.press("Enter");
      await expect
        .poll(() => createSessionRequestCount, { timeout: 5000 })
        .toBeGreaterThanOrEqual(1);
    }

    await expect
      .poll(() => runRequestCount, { timeout: 10000 })
      .toBeGreaterThanOrEqual(sendRequestBaseline + 1);
    await expect(page).toHaveURL(new RegExp(`/chat\\?sessionId=${sessionId}`), {
      timeout: 20000,
    });
    await expect(page.getByText("테스트 질문")).toBeVisible();
    await expect(page.getByText("테스트 답변입니다.")).toBeVisible();
    expect(new Set(runRequestIds).size).toBe(1);
  });

  test("mobile chat history opens a session without flashing the previous page or empty state", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chrome",
      "mobile drawer behavior is only relevant on small viewports",
    );

    const sessionId = "33333333-3333-4333-8333-333333333333";
    const createdAt = new Date().toISOString();
    let releaseChatResponse!: () => void;
    const chatResponseGate = new Promise<void>((resolve) => {
      releaseChatResponse = resolve;
    });

    await page.route("**/api/sessions?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sessions: [
            {
              id: sessionId,
              title: "모바일 전환 회귀 테스트",
              scope_type: "company",
              default_tickers: ["AAPL"],
              last_message_preview: "기존 답변 미리보기",
              last_message_at: createdAt,
              latest_run_status: "completed",
              created_at: createdAt,
              updated_at: createdAt,
            },
          ],
          total: 1,
          page: 1,
          limit: 30,
        }),
      });
    });

    await page.route(`**/api/chat/${sessionId}`, async (route) => {
      await chatResponseGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: {
            id: sessionId,
            user_id: "dev-user",
            title: "모바일 전환 회귀 테스트",
            scope_type: "company",
            default_tickers: ["AAPL"],
            default_document_types: [],
            created_at: createdAt,
            updated_at: createdAt,
          },
          messages: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              session_id: sessionId,
              role: "user",
              content: "AAPL 매출 구조를 정리해줘.",
              status: "completed",
              created_at: createdAt,
            },
            {
              id: "66666666-6666-4666-8666-666666666666",
              session_id: sessionId,
              role: "assistant",
              content: "모바일 전환 회귀 테스트 답변입니다.",
              status: "completed",
              created_at: createdAt,
            },
          ],
          runs: [],
          tool_calls: [],
          citations: [],
          rich_answers: [],
          research_artifacts: [],
        }),
      });
    });

    await page.route("**/api/companies?**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("ticker") !== "AAPL") {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          companies: [
            {
              ticker: "AAPL",
              name: "Apple Inc.",
              sector: "기술",
            },
          ],
          count: 1,
        }),
      });
    });

    await page.goto("/companies/AXP");
    await expect(page).toHaveURL(/\/companies\/AXP$/);
    await page.getByRole("button", { name: "채팅 기록 열기" }).click();

    await expect(
      page.getByRole("dialog", { name: "채팅 기록" }),
    ).toBeVisible();

    await page
      .getByRole("link", { name: /모바일 전환 회귀 테스트/ })
      .click();

    await expect(page).toHaveURL(new RegExp(`/chat\\?sessionId=${sessionId}`));
    await expect(
      page.getByRole("status", { name: "채팅 불러오는 중" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "무엇을 확인할까요?" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: /AXP에서 무엇을 확인할까요/ }),
    ).toHaveCount(0);

    releaseChatResponse();

    await expect(
      page.getByText("모바일 전환 회귀 테스트 답변입니다."),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "채팅 기록" }),
    ).toHaveCount(0);
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
