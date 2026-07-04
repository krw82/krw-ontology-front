# KRW Ontology Goals 1-6 Strategy

*Last updated: 2026-05-21*

## Summary

This document turns the marketing plan into strategy deliverables for the current product flow: home -> login/company list/chat -> answer with citations. It is documentation-only. It does not implement UI, schema, route, analytics, pricing, billing, or database changes.

Strategic defaults:

- Target: Korean-speaking individual and pro investors researching US public companies.
- GTM: self-serve paid SaaS.
- Pricing axis: monthly question/analysis volume.
- Analytics: Supabase-owned event logging, not an external vendor.
- Positioning: "기업 분석에 최적화된 공시 리서치 에이전트."

## Goal 1 - Positioning, Homepage, And CRO Direction

**Outcome:** A first-time visitor should understand in 10 seconds that KRW Ontology answers company questions with filing evidence they can inspect.

**Primary message:** 범용 GPT가 아니라, 기업 분석에 맞춰 공시 근거를 찾고 연결하고 답변마다 근거 경로를 남깁니다.

**Homepage direction:**

- Lead with the user job: "10-K를 다 읽기 전에, 먼저 투자 질문의 근거를 확인하세요."
- Make the product category explicit: "기업 분석 에이전트," "기업 공시 리서치 AI," or "SEC filing research AI."
- Keep the existing evidence graph concept, but connect it to investor outcomes: faster thesis checks, margin driver analysis, segment/risk review.
- Show sample question paths by ticker and topic, not only abstract workflow labels.
- Use one primary CTA: "무료로 첫 분석 시작" for self-serve activation.
- Use a secondary CTA only for supported-company exploration: "지원 회사 보기."

**Trust and objection handling:**

- State that the product supports research and verification, not investment recommendations.
- Put "출처 확인", "공시 문장", and "근거 경로" near the first CTA.
- Handle the GPT objection directly: general GPT is flexible, but KRW Ontology is optimized for company analysis, filing evidence, source paths, saved research sessions, and follow-up questions.
- Surface coverage limits before users spend analysis credits.

**Success metrics:**

- Homepage CTA click rate.
- Login start rate from homepage.
- First question submission rate.
- Answer completion rate.
- Citation open rate after first answer.

**Next implementation tasks:**

- Rewrite homepage copy around investor jobs and evidence verification.
- Add a clearer sample question module with supported ticker examples.
- Add a brief "not investment advice" trust note near answer/demo surfaces.
- A/B test "무료로 첫 분석 시작" against "질문으로 분석 시작."

## Goal 2 - Self-Serve Signup, Activation, And Onboarding

**Outcome:** A new user should reach the first completed evidence-backed answer with the fewest possible decisions.

**Activation definition:** User submits one question, receives a completed answer, and opens at least one citation or evidence path.

**Recommended first-run flow:**

- Entry from home CTA sends the user to login only when required.
- After login, return users to the original intended path.
- If no ticker is selected, show 3-5 high-quality starter questions.
- If a ticker is selected, prefill company-specific starter prompts.
- After answer completion, prompt the user to inspect citations before asking another question.

**Onboarding content:**

- Use short, task-oriented prompts: margin drivers, revenue growth, risk factors, segment performance, thesis check.
- Avoid long tours. Let users learn by running an actual analysis.
- Use empty states to show what a good question looks like.

**Signup friction principles:**

- Keep Google login as the only required signup path for v1.
- Do not ask for role, experience, or portfolio during signup.
- Collect preference signals from behavior first, then optional profile fields later.

**Success metrics:**

- Login completion rate.
- Time from login completed to first question submitted.
- First answer completion rate.
- First answer citation open rate.
- Day-7 return rate.

**Next implementation tasks:**

- Add starter question sets by global context and ticker context.
- Add post-answer citation inspection nudges.
- Add activation milestone tracking through Supabase events.
- Add a simple first-session checklist only if empty-state prompts are not enough.

## Goal 3 - Supabase Analytics Tracking Plan

**Outcome:** The team can measure acquisition, activation, conversion, and retention without adding an external analytics vendor.

**Recommended future table:** `analytics_events`

**Core fields:**

| Field | Type direction | Purpose |
|-------|----------------|---------|
| `id` | UUID | Event id |
| `user_id` | UUID nullable | Authenticated user id when available |
| `anonymous_id` | Text nullable | Pre-login/session identifier |
| `event_name` | Text | Canonical event name |
| `properties` | JSONB | Event-specific properties |
| `path` | Text nullable | Current app path |
| `referrer` | Text nullable | Browser referrer |
| `utm_source` | Text nullable | Campaign source |
| `utm_medium` | Text nullable | Campaign medium |
| `utm_campaign` | Text nullable | Campaign name |
| `created_at` | Timestamptz | Event time |

**Core events:**

| Event | Fires when | Key properties |
|-------|------------|----------------|
| `page_viewed` | Public or product page loads | `page_path`, `page_type`, `is_public`, `utm_*` |
| `cta_clicked` | User clicks primary or secondary CTA | `cta_id`, `cta_label`, `destination` |
| `signup_started` | User starts Google login or signup | `next_path`, `surface` |
| `login_completed` | Auth callback succeeds | `next_path`, `is_new_user` if available |
| `question_prefilled` | Landing page pre-fills a starter question | `source`, `ticker`, `question_length` |
| `question_submitted` | User sends a research question | `scope_type`, `ticker`, `question_length`, `source_surface` |
| `answer_completed` | Research run completes successfully | `scope_type`, `ticker`, `duration_ms`, `citation_count` |
| `citation_opened` | User opens citation/evidence details | `message_id`, `citation_id`, `ticker` |
| `usage_limit_reached` | User hits free or plan limit | `plan`, `limit_type`, `period` |
| `upgrade_clicked` | User clicks upgrade/paywall CTA | `plan_from`, `plan_to`, `surface` |
| `subscription_started` | Paid subscription starts | `plan`, `billing_interval`, `price_id` |

**Decision metrics:**

- Activation: `answer_completed` with at least one `citation_opened`.
- Conversion intent: `limit_reached` followed by `upgrade_clicked`.
- Paid conversion: `subscription_started`.
- Retention: user has `question_submitted` in two or more weekly periods.
- Quality signal: completed answers with citation count greater than zero.

**Implementation guardrails for later:**

- Keep event names stable and snake_case.
- Store UTM data on the first anonymous session and carry it into authenticated events when possible.
- Do not store raw full question content in analytics events by default; store length, ticker, and category. Product tables can continue storing chat content under existing auth rules.
- Use server-side inserts for payment and limit events; client-side inserts are acceptable for page and CTA events if protected by RLS.

**Success metrics:**

- All core funnel events present for a test user.
- No external analytics dependencies.
- Funnel query can calculate home view -> login -> question -> answer -> citation open -> upgrade.

**Next implementation tasks:**

- Add a migration for `analytics_events` with RLS.
- Add a small analytics helper with typed event names.
- Track home, CTA, login, question, answer, citation, limit, upgrade, and subscription events.
- Add internal SQL snippets for funnel and cohort reporting.

## Goal 4 - SEO, AI Search, Schema, And Content Architecture

**Outcome:** KRW Ontology should become discoverable for investors searching for evidence-backed company filing analysis.

**Priority search themes:**

- 기업 공시 AI 분석
- 10-K 분석 AI
- SEC filing analysis AI
- evidence-backed equity research
- citation-backed company research
- company risk factor analysis
- segment margin analysis

**Recommended site architecture:**

- `/` - product homepage.
- `/companies` - supported company discovery.
- `/pricing` - self-serve plan comparison.
- `/use-cases/filing-analysis` - 10-K and 10-Q analysis use case.
- `/use-cases/thesis-check` - investment thesis evidence check use case.
- `/use-cases/risk-factor-analysis` - risk factor research use case.
- `/questions/[topic]` - reusable research question templates.
- `/companies/[ticker]` - supported company landing pages when coverage is stable.
- `/blog` - search and shareable content.

**AI-search and extractability principles:**

- Write direct definitions and answer-style sections that LLMs can cite.
- Include visible evidence and limitations; do not make unsupported accuracy claims.
- Publish examples with concrete company questions and source-backed answer structures.
- Keep headings literal: "What is evidence-backed company research?", "How to analyze a 10-K with AI", "How KRW Ontology uses citations."

**Schema strategy for later implementation:**

- Home: `Organization`, `SoftwareApplication`, and `WebSite`.
- Pricing: `Product` or `SoftwareApplication` with visible plan information.
- Use-case pages: `Article` or `WebPage` plus `FAQPage` when FAQs are visible.
- Company pages: `BreadcrumbList` and `WebPage`; avoid unsupported financial claims in schema.

**Success metrics:**

- Indexed pages for homepage, pricing, use cases, and supported company pages.
- Organic clicks to use-case and question-template pages.
- AI-search mentions or citations for target query families.
- Signup or first-analysis starts from organic landing pages.

**Next implementation tasks:**

- Add `robots.ts` and `sitemap.ts`.
- Expand `metadata` with stronger Korean/English descriptions and Open Graph defaults.
- Add JSON-LD only where visible page content supports it.
- Build three use-case pages before scaling programmatic pages.
- Create a question-template content model before adding `/questions/[topic]`.

## Goal 5 - Lead Magnets, Lifecycle Emails, Social, And Demo Content

**Outcome:** Turn educational demand into self-serve signups and repeated product use.

**Lead magnet ideas:**

- "10-K 근거 검증 체크리스트" - ungated page plus optional email download.
- "기업 공시 질문 템플릿 30개" - prompt library for margin, growth, risk, segment, and thesis checks.
- "미국 기업 실적 동인 분석 워크시트" - lightweight spreadsheet or Markdown template.
- "AI 답변을 공시 원문으로 검증하는 방법" - educational guide.

**Lifecycle email sequence after signup:**

- Day 0: First analysis prompt - send one high-quality starter question.
- Day 1: How to inspect citations and evidence paths.
- Day 3: Margin/growth/risk question templates.
- Day 5: How to turn an answer into a reusable research note.
- Day 7: Plan limit and upgrade framing based on monthly research volume.

**Social content pillars:**

- Filing research workflows: how to ask better company questions.
- Evidence-first AI: why citation-backed answers matter.
- Company analysis examples: anonymized or public examples for supported tickers.
- Product build notes: ontology, citations, readable Markdown answers, and chat workflow.

**Demo content:**

- 60-90 second product walkthrough: question -> answer -> citation -> follow-up question.
- Short clips for one use case each: margin driver, risk factor, segment analysis.
- Static images for directories and social: evidence path, citation view, mobile Markdown answer.

**Success metrics:**

- Lead magnet conversion rate.
- Email open and click rates.
- Signup starts from lead magnet pages.
- First analysis completion from email traffic.
- Social post clicks to use-case or starter-question pages.

**Next implementation tasks:**

- Create one ungated lead magnet page before adding popups.
- Add email capture only where the page gives standalone value.
- Draft the five-email lifecycle sequence.
- Produce one demo video script and one screenshot list for launch assets.

## Goal 6 - Pricing, Paywall, Launch, And Retention

**Outcome:** Create a simple self-serve paid motion where users upgrade because monthly analysis volume becomes valuable.

**Value metric:** Monthly analysis volume. One analysis equals one submitted research question that attempts to run the agent workflow.

**Recommended v1 plans:**

| Plan | Target user | Monthly analyses | Positioning |
|------|-------------|------------------|-------------|
| Free | Evaluating investor | 10 analyses/month | Try evidence-backed filing research |
| Pro | Active individual/pro investor | 100 analyses/month | Research multiple companies every month |
| Power | Heavy researcher or finance creator | 300 analyses/month | High-volume research with advanced convenience |

**Feature packaging direction:**

- Free: limited monthly analyses, supported company access, standard chat history.
- Pro: higher monthly analyses, longer history, and reusable chat threads.
- Power: highest monthly analyses, priority analysis queue if available later, advanced templates, and early access to new coverage.

**Upgrade triggers:**

- User reaches 80% of monthly free limit.
- User reaches the monthly free limit.
- User completes multiple answers with citation opens in a short period.
- User reaches monthly analysis limits, opens pricing, or asks for extended history/high-volume workflows when those features exist.

**Paywall principles:**

- Show value already received: completed analyses, citations opened, companies researched.
- Explain the limit plainly: "이번 달 무료 분석 10회를 모두 사용했습니다."
- Offer the next plan based on usage volume, not vague premium language.
- Always preserve access to existing research history after limit is reached.

**Cancellation and churn prevention:**

- Ask one cancellation reason: price, not using enough, coverage missing, answer quality, workflow friction, other.
- Offer a lower-volume or pause option only after paid plans exist.
- Use win-back emails around new coverage, improved citation workflow, or unused analysis reminders.
- Watch churn by plan, monthly analysis usage, citation open rate, and coverage errors.

**Launch motion:**

- Soft launch with Free and Pro waitlist/payment readiness before paid scale.
- Publish one homepage, one pricing page, three use-case pages, one lead magnet, and one demo video.
- Submit to AI/product directories only after destination pages and screenshots are ready.
- Use small paid retargeting only after the Supabase funnel proves activation and upgrade intent.

**Success metrics:**

- Free-to-Pro upgrade rate.
- Limit reached -> upgrade clicked rate.
- Upgrade clicked -> subscription started rate.
- Paid user monthly analyses used.
- Paid retention by second billing cycle.
- Cancellation reason distribution.

**Next implementation tasks:**

- Build pricing page copy and plan comparison.
- Implement plan entitlement checks around monthly analysis volume.
- Add limit-reached and upgrade-click analytics events.
- Add subscription provider integration only after pricing copy and entitlement rules are approved.
- Draft cancellation survey and lifecycle emails before launching paid plans.

## Cross-Goal Implementation Order

1. Add Supabase analytics foundation and funnel events.
2. Update homepage and first-run activation copy.
3. Add pricing page and plan-limit messaging.
4. Add SEO basics: metadata, robots, sitemap, and JSON-LD.
5. Publish use-case pages and one lead magnet.
6. Add lifecycle emails and launch assets.
7. Implement subscription entitlements and paywall surfaces.
8. Run first CRO and pricing experiments after baseline data exists.

## Acceptance Checklist

- Goals 1-6 each name an outcome, actions, success metrics, and next implementation tasks.
- Supabase analytics uses `analytics_events` with the required fields.
- Core events include `home_viewed`, `cta_clicked`, `login_started`, `login_completed`, `question_submitted`, `answer_completed`, `citation_opened`, `limit_reached`, `upgrade_clicked`, and `subscription_started`.
- Pricing strategy includes Free, Pro, and Power tiers based on monthly analysis volume.
- Upgrade triggers and cancellation/churn prevention are documented.
- The strategy remains consistent with the current app flow: home -> login/company list/chat -> answer with citations.
