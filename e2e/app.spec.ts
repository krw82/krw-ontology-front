import { expect, test } from "@playwright/test";

function cspDirective(csp: string, name: string) {
  return csp
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith(`${name} `));
}

test.describe("dev auth bypass", () => {
  test.beforeEach(async ({ page }) => {
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
  });

  test("renders the filterless P0 research feed without a legacy checkup card", async ({
    page,
  }) => {
    await page.goto("/pulse", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/pulse$/);
    await expect(page.getByRole("heading", { name: "피드" })).toBeVisible();
    await expect(page.locator('nav[aria-label="피드 종류"]')).toHaveCount(0);
    await expect(page.locator('[data-pulse-kind="checkup"]')).toHaveCount(0);
    await expect(page.getByRole("main")).toContainText(
      "확인한 활동은 여기까지입니다",
    );
  });

  test("opens protected companies page with stable account nav", async ({
    page,
  }, testInfo) => {
    await page.goto("/companies", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/companies$/);
    await expect(
      page.getByRole("heading", { name: "분석할 회사를 고르세요." }),
    ).toBeVisible();

    await expect(page.getByRole("button", { name: "로그인" })).toHaveCount(0);

    const accountButton = page
      .getByRole("button", { name: "Dev User 계정 메뉴" })
      .first();
    await expect(accountButton).toBeVisible();
    await expect(accountButton).toBeEnabled();

    const accountBox = await accountButton.boundingBox();
    expect(accountBox).not.toBeNull();
    const maxAccountSize = testInfo.project.name === "mobile-chrome" ? 38 : 42;
    expect(accountBox?.width).toBeLessThanOrEqual(maxAccountSize);
    expect(accountBox?.height).toBeLessThanOrEqual(maxAccountSize);

    await accountButton.click();
    await expect(page.getByText("dev@krw-ontology.local")).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /로그아웃/ }),
    ).toBeVisible();
  });

  test("offers distinct analysis and Guru paths on a company page", async ({
    page,
  }) => {
    await page.goto("/ko/companies/AMZN", { waitUntil: "domcontentloaded" });

    const analysisLink = page.getByRole("link", {
      name: "AMZN 분석 시작",
    });
    const guruLink = page.getByRole("link", {
      name: "구루 관점으로 보기",
    });

    await expect(analysisLink).toBeVisible();
    await expect(guruLink).toBeVisible();
    await expect(guruLink).toHaveAttribute("href", "/guru?ticker=AMZN");
    await expect(page.locator("main header > p.mt-4")).toHaveCount(0);
  });

  test("redirects login away when dev auth bypass is enabled", async ({
    page,
  }) => {
    await page.goto("/login");

    await expect(page).toHaveURL(/\/companies$/);
  });

  test("opens chat workspace without Google login", async ({ page }) => {
    await page.goto("/chat");

    await expect(page).toHaveURL(/\/chat\/new$/);
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
    await expect(page).toHaveURL(new RegExp(`/chat\\?sessionId=${sessionId}`), {
      timeout: 20000,
    });
    await expect(page.getByText("테스트 질문")).toBeVisible();
    await expect(page.getByText("테스트 답변입니다.")).toBeVisible();
    expect(new Set(runRequestIds).size).toBe(1);
  });

  test("saves a completed ticker answer into personal research assets", async ({
    page,
  }) => {
    const sessionId = "11111111-1111-4111-8111-111111111112";
    const runId = "22222222-2222-4222-8222-222222222223";
    const assistantMessageId = "44444444-4444-4444-8444-444444444445";
    const createdAt = new Date().toISOString();
    const answer = "AMZN의 공시 기준 종목 카드와 thesis 초안입니다.";
    let noteBody: Record<string, unknown> | null = null;
    let cardBody: Record<string, unknown> | null = null;
    let thesisBody: Record<string, unknown> | null = null;

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
    await page.route("**/api/watchlist/AMZN/card", async (route) => {
      cardBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ card: { id: "card-1", ticker: "AMZN" } }),
      });
    });
    await page.route("**/api/watchlist/AMZN/theses", async (route) => {
      thesisBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ thesis: { id: "thesis-1", ticker: "AMZN" } }),
      });
    });

    await page.goto("/chat/new?ticker=AMZN");
    await page.getByLabel("메시지 입력").fill("AMZN 종목 카드 만들어줘");
    await page.getByRole("button", { name: "메시지 보내기" }).click();
    await expect(page.getByText(answer)).toBeVisible();

    await page.getByRole("button", { name: "리서치 노트로 저장" }).click();
    await page.getByRole("button", { name: "종목 카드로 저장" }).click();
    await page.getByRole("button", { name: "Thesis로 저장" }).click();

    await expect.poll(() => noteBody).not.toBeNull();
    await expect.poll(() => cardBody).not.toBeNull();
    await expect.poll(() => thesisBody).not.toBeNull();
    expect(noteBody).toMatchObject({
      title: "AMZN 채팅 요약",
      body: answer,
      note_type: "chat_summary",
      tags: ["chat"],
      source_chat_session_id: sessionId,
      source_message_id: assistantMessageId,
    });
    expect(cardBody).toMatchObject({
      title: "AMZN 종목 카드",
      content_md: answer,
      source_chat_session_id: sessionId,
      source_message_id: assistantMessageId,
    });
    expect(thesisBody).toMatchObject({
      title: "AMZN 채팅 기반 Thesis",
      thesis_text: answer,
      status: "needs_review",
      tags: ["chat"],
      source_chat_session_id: sessionId,
      source_message_id: assistantMessageId,
    });
  });

  test("mobile chat history opens a session without flashing the previous page or empty state", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chrome",
      "mobile bottom-sheet behavior is only relevant on small viewports",
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

    await page.goto("/chat?ticker=AAPL", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/chat\/new\?ticker=AAPL$/);
    const historyButton = page.getByRole("button", { name: "채팅 기록 열기" });
    await expect(historyButton).toBeEnabled();
    await historyButton.click();

    const historyDialog = page.getByRole("dialog", { name: "채팅 기록" });
    await expect(historyDialog).toBeVisible();
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    await expect
      .poll(async () => {
        const box = await historyDialog.boundingBox();
        return box
          ? Math.abs(box.y + box.height - (viewport?.height ?? 0))
          : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(2);
    const historyBox = await historyDialog.boundingBox();
    expect(historyBox).not.toBeNull();
    expect(historyBox?.x).toBeLessThanOrEqual(1);
    expect(historyBox?.width).toBeGreaterThanOrEqual(
      (viewport?.width ?? 0) - 2,
    );
    expect(historyBox?.height).toBeLessThan(
      viewport?.height ?? Number.POSITIVE_INFINITY,
    );

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
    await expect(page.getByRole("dialog", { name: "채팅 기록" })).toHaveCount(
      0,
    );
  });

  test("mobile workspace menu groups global routes separately from chat history", async ({
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
    await expect(menu.getByRole("link", { name: "공시 알림" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "13F 보유" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "채팅 기록" })).toHaveCount(0);
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
