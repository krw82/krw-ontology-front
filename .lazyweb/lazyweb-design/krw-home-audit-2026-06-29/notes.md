# KRW Ontology Product Resonance Audit

Date: 2026-06-29
Scope: public home, companies index, AAPL company page, questions page, pricing page.
Reference context: Lazyweb desktop search for AI investment/research landing pages found recurring patterns from Glean financial services, Glean deep research, Enverus investment intelligence, and finance/news research hubs: concrete workflows, visible output examples, proof/trust cues, and direct start actions.

## Captured Steps

1. Home: `references/01-home.png`
   General health: strong positioning and clean visual hierarchy, but the preview is more process-oriented than outcome-oriented.

2. Companies index: `references/02-companies.png`
   General health: useful catalog and search-first model, but the first authenticated/dev view is interrupted by a tour overlay and the list is dense before a user has felt a win.

3. AAPL company page: `references/03-company-aapl.png`
   General health: strongest current conversion surface. It names the company, gives realistic prompts, and exposes research axes.

4. Questions page: `references/04-questions.png`
   General health: useful for examples, but Apple-only framing can make the product feel narrower than the underlying catalog.

5. Pricing page: `references/05-pricing.png`
   General health: clear and simple, but usage value is still abstract.

6. Mobile home: `references/06-mobile-home.png`
   General health: headline and CTA are visible, but the outcome preview falls below the first screen.

7. Mobile AAPL company page: `references/07-mobile-company-aapl.png`
   General health: usable first screen with a clear CTA and prompts, though the answer outcome is still not visible before action.

## Strengths

- The core promise is differentiated: Korean-language, U.S. stock research grounded in company filings.
- The product has a usable first workflow: home to company selection to company-specific prompts to chat.
- Company detail pages are strong because they anchor the abstract product in a real ticker, real business axes, and starter questions.
- The interface is visually restrained and credible for financial research.

## UX Risks

1. The home page tells users the method, but not enough of the result.
   The current preview explains source to context to answer. Users still need to imagine what a finished answer looks like, how citations appear, and how this beats ChatGPT or news summaries.

2. The primary home CTA adds a decision step.
   `공시 근거로 확인하기` and `무료로 시작` route to `/companies`. That is logical, but it means the user must pick a company before feeling the product. The strongest first-use path should let a visitor run a sample or prefilled question immediately.

3. The companies page can feel like a database before it feels like a product.
   The catalog is dense and useful, but a first-time user may not know whether to search, click a row, or start discovery. The tour helps, but the modal spotlight dims the product itself and interrupts exploration.

4. The questions page may accidentally reduce perceived coverage.
   The page repeatedly says Apple/AAPL. As an example page this is fine, but as a nav-level "질문 그래프" surface it can make the product feel Apple-only.

5. Pricing does not quantify the value of one plan unit.
   The page explains monthly billing and weekly recharge, but "기본 사용량" and "넉넉한 주간 사용량" do not tell a user how much research they get or what kind of answer justifies paying.

## Accessibility Risks

- Screenshots cannot prove full keyboard or screen reader behavior.
- The companies onboarding overlay is a modal dialog and should be verified for focus trapping, escape behavior, restore focus, and screen reader announcement.
- Dense company rows rely heavily on truncation and small text. Verify 200% zoom and mobile reflow for row readability.
- Mobile home uses very large headline text; it fits in the tested viewport, but the result preview is pushed below the fold.

## Recommendations

1. Replace or supplement the home preview with a concrete answer sample.
   Show a real-looking AAPL or AMZN answer: question, short conclusion, filing quote/source, driver/risk bullets, and follow-up questions. Keep the process card as secondary.

2. Make one hero path a prefilled instant trial.
   Example: `AAPL 매출 성장 공시로 확인하기` or `AMZN 클라우드 마진 확인하기` should go directly to `/chat/new?ticker=AAPL&query=...`. Keep `회사 목록` as the browse path.

3. Add a "why this is different from generic AI" proof strip.
   Use compact claims such as covered company count, indexed filing types, latest filing periods, Korean question support, and "answer starts from source sentences."

4. Turn company selection into guided starts.
   Above the table, add 3-4 task cards: "실적 발표 후 확인", "뉴스 영향 확인", "Thesis 반대 근거 찾기", "리스크 우선순위화". Each should prefill a query against a popular ticker or the searched ticker.

5. Reframe the tour as progressive help after intent.
   Do not block the first companies page load for authenticated users. Show a smaller search hint first, then offer the full tour after the user hesitates or opens help.

6. Reposition the Apple question graph page.
   Either make it a sample page with explicit title "Apple 예시 질문 그래프" or let users switch ticker before picking a graph.

7. Make pricing concrete.
   Replace vague usage labels with examples: "Free: 첫 답변 1회 + 근거 확인", "Standard: 개인 반복 리서치", "Pro: 여러 기업 비교/와이드 리서치". If exact quotas exist, state them. If not, state example workloads.

## Evidence Limits

- This audit used local dev screenshots, not production analytics.
- It did not complete a live chat run or payment flow.
- It did not verify keyboard navigation, screen reader behavior, or authenticated production onboarding state beyond visible code and local rendering.
