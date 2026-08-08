import { expect, test } from "@playwright/test";

function cspDirective(csp: string, name: string) {
  return csp
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith(`${name} `));
}

test.describe("dev auth bypass", () => {
  // API route mocks must remain authoritative in these tests. A newly
  // activated service worker can otherwise proxy fetches outside page.route,
  // making the same test depend on worker activation timing and live data.
  test.use({ serviceWorkers: "block" });

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/analytics/events", async (route) => {
      await route.fulfill({ status: 204, body: "" });
    });

    await page.route("**/api/me/entitlement", async (route) => {
      const periodStart = "2026-07-06T00:00:00.000Z";
      const periodEnd = "2026-07-13T00:00:00.000Z";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          entitlement: {
            status: "beta",
            plan: {
              key: "beta",
              label: "Beta",
              status_label: "Beta",
              description: "E2E fixture",
            },
            usage: {
              period: "weekly",
              period_label: "주간",
              period_start: periodStart,
              period_end: periodEnd,
              budget_used_usd: 0,
              budget_reserved_usd: 0,
              budget_limit_usd: 10,
              remaining_budget_usd: 10,
              daily_budget_used_usd: 0,
              daily_budget_reserved_usd: 0,
              daily_budget_limit_usd: 10,
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
              alert_level: "ok",
              can_run: true,
              unlimited: false,
              resets_at: periodEnd,
            },
            features: [],
            upgrade: {
              label: "",
              href: "/settings/billing",
              enabled: false,
              title: "",
              message: "",
            },
          },
        }),
      });
    });

    // The initial server-rendered feed uses a loopback-only E2E fixture. Keep
    // browser-triggered decision-session reads deterministic as well, so this
    // pre-migration release gate never depends on the current live schema.
    await page.route("**/api/pulse/session-close?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    });
  });

  test("renders the filterless P0 research feed without a legacy checkup card", async ({
    page,
  }) => {
    await page.goto("/pulse", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/pulse$/);
    await expect(page.getByRole("heading", { name: "피드" })).toBeVisible();
    await expect(page.locator('nav[aria-label="피드 종류"]')).toHaveCount(0);
    await expect(page.locator('[data-pulse-kind="checkup"]')).toHaveCount(0);
    await expect(page.locator('[data-pulse-kind="filing"]')).toHaveCount(1);
    await expect(
      page.getByRole("heading", {
        name: "AAPL 중요 공시에서 확인할 변화가 있습니다",
      }),
    ).toBeVisible();
  });

  test("opens protected companies page with stable account nav", async ({
    page,
  }, testInfo) => {
    await page.goto("/companies", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/(?:ko\/)?companies$/);
    await expect(page.getByRole("main")).toBeVisible();

    await expect(page.getByRole("button", { name: "로그인" })).toHaveCount(0);

    const accountButton = page
      .getByRole("button", { name: "Dev User 계정 메뉴" })
      .first();
    await expect(accountButton).toBeVisible();
    await expect(accountButton).toBeEnabled();

    const accountBox = await accountButton.boundingBox();
    expect(accountBox).not.toBeNull();
    expect(accountBox?.width).toBeGreaterThanOrEqual(44);
    expect(accountBox?.height).toBeGreaterThanOrEqual(44);

    if (testInfo.project.name === "mobile-chrome") {
      const workspaceMenuButton = page.getByRole("button", {
        name: "전체 메뉴 열기",
      });
      await expect(workspaceMenuButton).toBeVisible();
      const workspaceMenuBox = await workspaceMenuButton.boundingBox();
      expect(workspaceMenuBox).not.toBeNull();
      expect(workspaceMenuBox?.width).toBeGreaterThanOrEqual(44);
      expect(workspaceMenuBox?.height).toBeGreaterThanOrEqual(44);
    }

    await accountButton.click();
    await expect(page.getByText("dev@krw-ontology.local")).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /로그아웃/ }),
    ).toBeVisible();
  });

  test("navigates to a company without waiting for analytics", async ({
    page,
  }) => {
    await page.route("**/api/analytics/events", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.fulfill({ status: 204, body: "" });
    });

    await page.goto("/companies", { waitUntil: "domcontentloaded" });

    const companyLink = page
      .locator('a[aria-label*="리서치 페이지 열기"]')
      .first();
    await expect(companyLink).toBeVisible();

    // A cold dynamic company page can take longer than one second to finish
    // rendering. The regression we care about here is whether analytics blocks
    // the interaction, so assert that navigation enters a pending/committed
    // state before the intentionally delayed analytics request can resolve.
    const navigationStarted = Promise.race([
      page
        .waitForURL(/\/companies\/[A-Z0-9.-]+$/, { timeout: 500 })
        .then(() => "committed" as const),
      page
        .getByRole("status", { name: "페이지 불러오는 중" })
        .waitFor({ state: "visible", timeout: 500 })
        .then(() => "pending" as const),
    ]);

    await Promise.all([navigationStarted, companyLink.click()]);
    await expect(page).toHaveURL(/\/companies\/[A-Z0-9.-]+$/);
  });

  test("keeps the company search when returning from a detail page", async ({
    page,
  }) => {
    await page.goto("/companies", { waitUntil: "domcontentloaded" });

    const onboardingDismiss = page.getByRole("button", {
      name: "먼저 둘러볼게요",
    });
    await onboardingDismiss.click({ timeout: 2_000 }).catch(() => undefined);

    const searchInput = page.getByRole("textbox", { name: "회사 검색" });
    await expect(searchInput).toBeVisible();
    await searchInput.fill("AMZN");
    await expect(page).toHaveURL(/[?&]q=AMZN(?:&|$)/);

    const companyLink = page
      .locator('a[aria-label*="리서치 페이지 열기"]')
      .first();
    await expect(companyLink).toBeVisible();
    await companyLink.click();
    await expect(page).toHaveURL(/\/companies\/[A-Z0-9.-]+$/);

    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect(searchInput).toHaveValue("AMZN");
    await expect(page).toHaveURL(/[?&]q=AMZN(?:&|$)/);
  });

  test("offers distinct analysis and Guru paths on a company page", async ({
    page,
  }) => {
    await page.goto("/ko/companies/AMZN", { waitUntil: "domcontentloaded" });

    const analysisLink = page.getByRole("link", {
      name: "AMZN 분석 시작",
    });
    const guruPicker = page.getByRole("button", {
      name: "구루 관점으로 보기",
    });

    await expect(analysisLink).toBeVisible();
    await expect(guruPicker).toBeVisible();
    await expect(guruPicker).toBeEnabled();
    await guruPicker.click();
    const guruDialog = page.getByRole("dialog", {
      name: /아마존 구루 관점 선택/,
    });
    await expect(guruDialog).toBeVisible();
    await expect(guruDialog.getByRole("link")).toHaveCount(5);
    await expect(page.locator("main header > p.mt-4")).toHaveCount(0);
  });

  test("redirects login away when dev auth bypass is enabled", async ({
    page,
  }) => {
    await page.goto("/login");

    await expect(page).toHaveURL(/\/pulse$/);
  });

  test("opens chat workspace without Google login", async ({ page }) => {
    await page.goto("/chat/new?ticker=AMZN");

    await expect(page).toHaveURL(/\/chat\/new\?ticker=AMZN$/);
    await expect(page.getByLabel("채팅 메시지")).toBeVisible();
    await expect(page.getByLabel("메시지 입력")).toBeEditable();
  });

  test("opens stock discovery and carries the idea workflow into chat", async ({
    page,
  }) => {
    const examplePrompt =
      "AI 데이터센터 전력 수요 수혜 기업 중 FCF로 CapEx를 버티는 후보 3개만 찾아줘.";
    const sessionId = "11111111-1111-4111-8111-111111111113";
    const runId = "22222222-2222-4222-8222-222222222224";
    const assistantMessageId = "44444444-4444-4444-8444-444444444446";
    const createdAt = new Date().toISOString();

    await page.route("**/api/sessions", async (route) => {
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
            title: "종목 발굴 테스트",
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
            title: "종목 발굴 테스트",
            scope_type: "global",
            default_tickers: [],
            default_document_types: [],
            created_at: createdAt,
            updated_at: createdAt,
          },
          messages: [
            {
              id: "55555555-5555-4555-8555-555555555556",
              session_id: sessionId,
              role: "user",
              content: examplePrompt,
              status: "completed",
              created_at: createdAt,
            },
            {
              id: assistantMessageId,
              session_id: sessionId,
              role: "assistant",
              content: "종목 발굴 테스트 답변입니다.",
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

    await page.route("**/api/chat/run", async (route) => {
      const body = route.request().postDataJSON() as {
        content?: string;
        run_kind?: string;
        session_id?: string;
      };
      expect(body.content).toBe(examplePrompt);
      expect(body.run_kind).toBe("idea_generation");
      expect(body.session_id).toBe(sessionId);

      const event = (type: string, data: unknown) =>
        `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-chat-session-id": sessionId,
        },
        body: [
          event("run_started", {
            run_id: runId,
            message_id: assistantMessageId,
            session_id: sessionId,
            started_at: createdAt,
          }),
          event("done", {
            run_id: runId,
            message_id: assistantMessageId,
            content: "종목 발굴 테스트 답변입니다.",
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
              budget_limit_usd: 10,
              remaining_budget_usd: 10,
              daily_budget_used_usd: 0,
              daily_budget_reserved_usd: 0,
              daily_budget_limit_usd: 10,
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
        ].join(""),
      });
    });

    await page.goto("/discover", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "어떤 종목을 발굴할까요?", level: 2 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "참고할 URL이 있나요?", level: 3 }),
    ).toBeVisible();
    const skipButton = page.getByRole("button", { name: "건너뛰기" });
    await expect(skipButton).toBeEnabled();
    await skipButton.click();
    await expect(
      page.getByRole("heading", { name: "첨부할 파일이 있나요?", level: 3 }),
    ).toBeVisible();
    await expect(skipButton).toBeEnabled();
    await skipButton.click();
    await expect(
      page.getByRole("heading", {
        name: "어떤 아이디어로 종목을 발굴할까요?",
        level: 3,
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: examplePrompt }).click();
    await expect(page.getByRole("textbox")).toHaveValue(examplePrompt);

    await page.getByRole("button", { name: "종목 발굴 시작" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/chat\\?sessionId=${sessionId}.*runKind=idea_generation`),
    );
    await expect(page.getByText(examplePrompt, { exact: true })).toBeVisible();
    await expect(page.getByText("종목 발굴 테스트 답변입니다.")).toBeVisible();
  });

  test("keeps app locale in the query instead of linking to a missing locale route", async ({
    page,
  }) => {
    await page.goto("/guru?locale=en", { waitUntil: "domcontentloaded" });

    const englishLink = page.getByRole("link", { name: "EN", exact: true });
    const koreanLink = page.getByRole("link", { name: "KO", exact: true });
    await expect(englishLink).toHaveAttribute("aria-current", "page");
    await expect(koreanLink).toHaveAttribute("href", "/guru");
    await expect(koreanLink).not.toHaveAttribute("href", /\/ko\/guru/);
  });

  test("routes completed first-company research back to Pulse", async ({
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

    await page.goto("/chat/new?ticker=AMZN", {
      waitUntil: "domcontentloaded",
    });
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
    if (await sendButton.isDisabled()) {
      await composer.press("Enter");
    } else {
      await sendButton.click();
    }
    await expect(composer).toHaveValue("", { timeout: 5000 });

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
    await expect(page).toHaveURL(/\/pulse$/, {
      timeout: 20000,
    });
    expect(new Set(runRequestIds).size).toBe(1);
  });

  test("does not run the retired coverage-save mutation after first-company research", async ({
    page,
  }) => {
    const sessionId = "11111111-1111-4111-8111-111111111112";
    const runId = "22222222-2222-4222-8222-222222222223";
    const assistantMessageId = "44444444-4444-4444-8444-444444444445";
    const createdAt = new Date().toISOString();
    const answer = "AMZN의 공시 기준 종목 카드와 thesis 초안입니다.";
    let noteBody: Record<string, unknown> | null = null;

    await page.route("**/api/companies?**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("ticker") !== "AMZN") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          companies: [
            {
              ticker: "AMZN",
              name: "Amazon.com, Inc.",
              sector: "기술",
            },
          ],
          count: 1,
        }),
      });
    });

    await page.route("**/api/sessions", async (route) => {
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
            title: "AMZN 리서치",
            scope_type: "company",
            default_tickers: ["AMZN"],
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
            title: "AMZN 리서치",
            scope_type: "company",
            default_tickers: ["AMZN"],
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
      const event = (type: string, data: unknown) =>
        `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-chat-session-id": sessionId,
        },
        body: [
          event("run_started", {
            run_id: runId,
            message_id: assistantMessageId,
            session_id: sessionId,
            started_at: createdAt,
          }),
          event("done", {
            run_id: runId,
            message_id: assistantMessageId,
            content: answer,
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
        ].join(""),
      });
    });

    await page.route("**/api/watchlist/AMZN/notes", async (route) => {
      noteBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ note: { id: "note-1", ticker: "AMZN" } }),
      });
    });
    await page.goto("/chat/new?ticker=AMZN");
    await page.getByLabel("메시지 입력").fill("AMZN 종목 카드 만들어줘");
    await page.getByRole("button", { name: "메시지 보내기" }).click();
    await expect(page).toHaveURL(/\/pulse$/);
    await expect(
      page.getByRole("button", { name: "이 답변을 기업 커버리지에 저장" }),
    ).toHaveCount(0);
    expect(noteBody).toBeNull();
  });

  test("mobile research history opens a session without flashing a draft state", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chrome",
      "mobile workspace navigation is only relevant on small viewports",
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

    await page.route(`**/api/chat/${sessionId}/evidence?**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message_id: "66666666-6666-4666-8666-666666666666",
          run_ids: [],
          tool_calls: [],
          citations: [],
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

    await page.goto("/companies", { waitUntil: "domcontentloaded" });
    const workspaceMenuButton = page.getByRole("button", {
      name: "전체 메뉴 열기",
    });
    await expect(workspaceMenuButton).toHaveAttribute(
      "data-workspace-menu-ready",
      "true",
    );
    await workspaceMenuButton.click();
    await page.getByRole("dialog", { name: "메뉴" })
      .getByRole("link", { name: "최근 채팅" })
      .click();
    await expect(page).toHaveURL(/\/watchlist\?tab=history$/);
    await page.getByRole("link", { name: /모바일 전환 회귀 테스트/ }).click();

    await expect(page).toHaveURL(new RegExp(`/chat\\?sessionId=${sessionId}`));
    await expect(
      page.getByRole("status", { name: "채팅 불러오는 중" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "무엇을 확인할까요?" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "분석할 회사를 고르세요." }),
    ).toHaveCount(0);

    releaseChatResponse();

    await expect(
      page.getByText("모바일 전환 회귀 테스트 답변입니다."),
    ).toBeVisible();
    await expect(page.getByRole("dialog", { name: "메뉴" })).toHaveCount(0);
  });

  test("mobile workspace menu groups current routes including recent chats", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chrome",
      "the workspace menu is rendered as a mobile drawer",
    );

    await page.goto("/companies", { waitUntil: "domcontentloaded" });
    const workspaceMenuButton = page.getByRole("button", {
      name: "전체 메뉴 열기",
    });
    await expect(workspaceMenuButton).toHaveAttribute(
      "data-workspace-menu-ready",
      "true",
    );
    await workspaceMenuButton.click();

    const menu = page.getByRole("dialog", { name: "메뉴" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("heading", { name: "탐색" })).toBeVisible();
    await expect(
      menu.getByRole("heading", { name: "내 리서치" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("link", { name: "리서치 노트북" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("link", { name: "와이드 리서치" }),
    ).toBeVisible();
    await expect(menu.getByRole("link", { name: "13F 보유" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "최근 채팅" })).toBeVisible();
  });
});

test.describe("public pages", () => {
  test("renders home, privacy, and terms", async ({ page }) => {
    const response = await page.goto("/");
    const csp = response?.headers()["content-security-policy"];
    expect(csp).toBeTruthy();
    const scriptSrc = cspDirective(csp ?? "", "script-src");
    expect(scriptSrc).toContain("'nonce-");
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    const cspNonce = scriptSrc?.match(/'nonce-([^']+)'/)?.[1];
    expect(cspNonce).toBeTruthy();
    const jsonLdNonces = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((scripts) =>
        scripts.map((script) => (script as HTMLScriptElement).nonce),
      );
    expect(jsonLdNonces.length).toBeGreaterThan(0);
    expect(jsonLdNonces.every((nonce) => nonce === cspNonce)).toBe(true);

    await expect(
      page.getByRole("heading", {
        name: "AI 답변을 믿기 전에 회사 공시로 확인하세요",
        level: 1,
      }),
    ).toBeVisible();

    await page.goto("/privacy", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "개인정보처리방침" }),
    ).toBeVisible();

    await page.goto("/terms", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "서비스 약관" }),
    ).toBeVisible();
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

  test("does not let Web auth bypass cross the Desktop API boundary", async ({
    request,
  }) => {
    const response = await request.get("/api/desktop/ontology/health");

    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "authentication_error",
      },
    });
  });
});

test.describe("Billing Flow V2", () => {
  test.use({ serviceWorkers: "block" });

  test("shows the billed amount before it invokes Toss authorization", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    let quotePayload: Record<string, unknown> | null = null;
    let confirmPayload: Record<string, unknown> | null = null;

    await page.addInitScript(() => {
      const testWindow = window as unknown as {
        TossPayments?: () => {
          payment: () => {
            requestBillingAuth: () => void;
          };
        };
        __billingV2TossCalls?: number;
      };
      testWindow.__billingV2TossCalls = 0;
      testWindow.TossPayments = () => ({
        payment: () => ({
          requestBillingAuth: () => {
            testWindow.__billingV2TossCalls =
              (testWindow.__billingV2TossCalls ?? 0) + 1;
          },
        }),
      });
    });

    await page.route("**/api/billing/toss/quote", async (route) => {
      quotePayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          operationId: "billing-v2-e2e-operation",
          kind: "subscribe",
          fromPlanKey: null,
          targetPlanKey: "standard",
          chargedTodayKrw: 7900,
          nextChargeKrw: 7900,
          effectiveAt: "2026-07-30T00:00:00.000Z",
          nextBillingAt: "2026-08-30T00:00:00.000Z",
          expiresAt: "2026-07-30T00:10:00.000Z",
        }),
      });
    });
    await page.route("**/api/billing/toss/confirm", async (route) => {
      confirmPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          operationId: "billing-v2-e2e-operation",
          status: "awaiting_auth",
          checkout: {
            clientKey: "test_ck_billing_v2_e2e",
            customerKey: "billing-v2-e2e-customer",
            method: "CARD",
            successUrl: "https://example.test/success",
            failUrl: "https://example.test/fail",
          },
        }),
      });
    });

    await page.goto("/dev/components/billing-v2-e2e", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("Billing V2 E2E")).toBeVisible();
    await expect(page.getByText("결제창 준비 중")).toHaveCount(0);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );

    await page.getByRole("button", { name: "금액 확인 후 구독" }).click();
    const confirmationDialog = page.getByRole("dialog", { name: "결제 금액 확인" });
    await expect(confirmationDialog).toBeVisible();
    await expect(
      confirmationDialog.getByRole("heading", {
        name: "결제 내용을 확인해 주세요.",
      }),
    ).toBeVisible();
    await expect(confirmationDialog.getByText("오늘 청구")).toBeVisible();
    await expect(
      confirmationDialog.getByText("7,900원", { exact: true }),
    ).toBeVisible();
    expect(quotePayload).toMatchObject({
      kind: "subscribe",
      targetPlanKey: "standard",
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const testWindow = window as unknown as {
            __billingV2TossCalls?: number;
          };
          return testWindow.__billingV2TossCalls ?? 0;
        }),
      )
      .toBe(0);

    await confirmationDialog
      .getByRole("button", { name: "7,900원 확인" })
      .click();
    expect(confirmPayload).toMatchObject({
      operationId: "billing-v2-e2e-operation",
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const testWindow = window as unknown as {
            __billingV2TossCalls?: number;
          };
          return testWindow.__billingV2TossCalls ?? 0;
        }),
      )
      .toBe(1);
  });
});
