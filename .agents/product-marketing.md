# Product Marketing Context

*Last updated: 2026-06-21*

## Product Overview

**One-liner:** KRW Ontology helps Korean investors ask questions about US companies and trace each answer back to the filing evidence behind it.

**What it does:** KRW Ontology turns long US public company filings into source-checkable research answers. Users ask a company or investment question, then receive a readable answer with a trail back to the original filing context so they can inspect where the answer came from.

**Product category:** AI equity research, SEC filing analysis, evidence-backed company intelligence, public company research assistant.

**Product type:** Self-serve SaaS web application.

**Business model:** Freemium to paid subscription. The primary value metric is monthly question/analysis volume. Higher tiers should add more analyses, longer chat history, priority throughput, and workflow convenience, but the current product promise stays centered on Markdown answers, citation/evidence review, and saved chat context.

## Messaging Positioning

**Core public promise:** AI can answer quickly. KRW Ontology helps users check whether the answer is actually grounded in the company's own disclosures.

**Primary tension to lead with:** The user does not simply want more AI output. They want to avoid trusting a polished answer they cannot verify.

**Best plain-language positioning lines:**

- "AI 요약을 믿기 전에, 원문 근거까지 따라가세요."
- "10-K를 전부 읽지 않아도, 답변의 근거는 놓치지 않게."
- "미국 공시를 투자 질문 중심으로 읽고, 답변마다 출처를 남깁니다."
- "빠른 답변보다 중요한 건, 확인할 수 있는 답변입니다."
- "그럴듯한 AI 요약이 아니라, 원문으로 돌아갈 수 있는 기업 리서치."

**Internal product truth:** The system links filing text, business activities, risk factors, segments, and financial drivers. This is useful for product and technical explanation.

**External copy rule:** Do not lead social posts, landing page heroes, or ads with the raw mechanics: "공시 문장과 사업 활동, 리스크, 세그먼트, 실적 동인을 연결합니다." It is accurate but too dry for top-of-funnel marketing. Use it only after the reader already understands the problem.

**Social hook angles:**

- "AI가 그럴듯하게 말할수록 더 위험한 순간이 있습니다."
- "10-K를 다 읽을 시간은 없지만, 근거 없는 요약을 믿을 수도 없습니다."
- "미국주식 리서치에서 제일 비싼 실수는 틀린 답보다, 확인 못 한 답입니다."
- "기업 공시를 읽는 이유는 결론을 얻기 위해서가 아니라, 결론을 의심할 근거를 얻기 위해서입니다."
- "좋은 리서치 AI는 답을 빨리 주는 게 아니라, 답을 다시 검증할 수 있게 만들어야 합니다."

## Social Publishing Preferences

**Default cadence:** When the user asks to fill a day with scheduled social posts, use 20-minute spacing unless they specify a different cadence.

**Language by time window, Asia/Seoul time:**

- 00:00-07:40: English posts for international/US-market reach.
- 08:00 onward: Korean posts for the primary Korean investor audience.

**Cross-posting rule:** Treat one scheduled content idea as one content set, then adapt it for Mastodon, Threads, and Bluesky. Exclude X while API credits are unavailable.

**Threads rule:** Use one topic tag only. Default to `aithreads` unless the user asks for another topic.

## Target Audience

**Target companies:** Not company buyers in the first self-serve motion. The primary buyer is an individual user: Korean-speaking individual investors, pro investors, independent analysts, newsletter writers, and finance creators who read US public company filings.

**Decision-makers:** The user is usually the buyer. In higher tiers, the buyer may be a professional investor, small research lead, or paid community operator who pays for faster research output.

**Primary use case:** Turn a company question into a citation-backed research answer without manually scanning long filings and losing the source trail.

**Jobs to be done:**

- Understand the reason behind a company's revenue, margin, risk, or segment movement using filing evidence.
- Check whether an investment thesis is supported by original company disclosures.
- Produce a reusable research note or briefing that preserves source context.

**Use cases:**

- "AMZN 클라우드 이익률이 왜 바뀌었는지 근거와 함께 정리해줘."
- "NVDA의 데이터센터 성장 요인을 최근 공시 기준으로 분해해줘."
- "AAPL 서비스 매출 리스크가 어느 사업 활동과 연결되는지 보여줘."
- "최근 10-K 기준으로 핵심 리스크와 실적 동인을 한 번에 요약해줘."

## Personas

| Persona | Cares about | Challenge | Value we promise |
|---------|-------------|-----------|------------------|
| Active individual investor | Fast but defensible company understanding | Long filings are slow to read and generic AI answers are hard to trust | Ask a natural-language question and inspect the source-backed evidence path |
| Professional independent investor | Repeatable research workflow and thesis checks | Needs to process many companies without losing source quality | Higher analysis volume, longer history, and reusable chat threads |
| Finance newsletter or content creator | Clear explanations with citations | Needs timely company analysis that does not look like unsupported summary | Evidence-backed notes that can be checked before publishing |
| Paid investing community operator | Member-facing research leverage | Needs more coverage without hiring analysts | Reusable question templates and source-checkable Markdown summaries |

## Problems & Pain Points

**Core problem:** Investors want faster company research, but the important evidence is buried in long filings, scattered across segments, risks, and management discussion.

**Why alternatives fall short:**

- Manual filing review is reliable but slow and hard to repeat across many companies.
- Generic chatbots can summarize, but users often cannot inspect the exact evidence path.
- Financial data terminals are powerful, but they can be expensive and still require manual narrative synthesis.
- Search engines find documents, not necessarily the connected answer.

**What it costs them:** Missed research coverage, weaker thesis confidence, duplicated reading time, and avoidable mistakes from relying on unsupported summaries.

**Emotional tension:** The user wants speed, but does not want to feel irresponsible for trusting an answer without checking its source.

## Competitive Landscape

**Direct:** AI financial research assistants and filing chat tools - often answer quickly, but may not expose a durable evidence graph or Korean-first workflow.

**Secondary:** General LLMs such as ChatGPT, Claude, or Gemini - flexible, but the user must manage source loading, citation checks, and repeatability.

**Indirect:** Manual SEC/EDGAR review, brokerage research, paid newsletters, spreadsheets, and financial terminals - credible in parts, but slower or less accessible for individual/pro self-serve users.

## Differentiation

**Key differentiators:**

- Evidence-first answers with visible source and reasoning path.
- A source trail that lets users trace an answer back to the filing context behind it.
- Ontology-based connections between filing text, business activity, risks, and drivers as the internal system of record.
- Korean-first product surface for US company research.
- Chat workflow that can start from a ticker, company list, or plain-language question.
- Saved chat sessions that preserve context for follow-up questions.

**How we do it differently:** The product does not treat the filing as a flat text blob or produce a standalone AI summary. It turns filing context into connected research units, then uses those units to answer questions in readable Markdown with inspectable citations and source context.

**Why that's better:** Users can move faster without giving up verification. The product makes source review part of the answer instead of a separate manual step.

**Why customers choose us:** They want research speed, but the decisive feature is trust: the answer must leave a path back to source material. The public message should frame this as "I can check this" rather than "the system has an ontology."

## Objections

| Objection | Response |
|-----------|----------|
| I can ask a general chatbot for this. | General chatbots can help, but KRW Ontology is built around filing evidence paths, ontology links, saved sessions, and repeatable company research workflows. |
| I still need to verify the answer manually. | Yes. The product is designed to make verification faster, not to remove investor judgment. The evidence path is the point. |
| The indexed company universe may be limited. | Start with supported US public companies and make coverage visible before the user spends analysis credits. |
| I do not know what to ask. | Provide prompt templates by company, segment, risk, margin, growth, and thesis-check workflows. |
| I do not want another expensive finance tool. | Offer a free evaluation tier and simple monthly analysis-volume pricing before pushing higher tiers. |

**Anti-persona:** Users who want buy/sell signals, guaranteed investment recommendations, real-time trading alerts, or fully automated portfolio decisions are not a good fit.

## Switching Dynamics

**Push:** Filings are too long; search results are fragmented; generic AI answers feel ungrounded; paid research can be slow, biased, or too broad.

**Pull:** Ask one question and get a clear answer with source trail, company context, and reusable research history.

**Habit:** Users already rely on manual SEC review, brokerage summaries, newsletters, spreadsheets, and general LLM workflows.

**Anxiety:** Users worry the answer may hallucinate, miss a recent filing, misunderstand a segment, or create false confidence.

## Customer Language

**How they describe the problem:**

- "10-K를 다 읽을 시간이 없다."
- "AI 요약은 빠른데 근거를 못 믿겠다."
- "어느 문장에서 나온 말인지 바로 확인하고 싶다."
- "실적 변화가 어떤 사업 활동과 연결되는지 보고 싶다."
- "투자 아이디어를 검증할 때 원문 근거가 필요하다."

**How they describe us:**

- "공시 원문 근거가 남는 리서치 AI."
- "질문하면 답변과 근거 경로를 같이 보여주는 도구."
- "긴 10-K를 투자 질문 중심으로 읽어주는 서비스."
- "AI 요약을 원문 근거까지 확인하게 해주는 서비스."
- "미국 기업 공시를 한국어 질문으로 파고드는 도구."

**Words to use:** 원문 근거, 근거 경로, 출처, 확인 가능, 검증 가능, 기업 리서치, 10-K, 10-Q, 미국 공시, 투자 질문, thesis check, evidence-backed, citation-backed.

**Words to use only in deeper product explanations:** 사업 활동, 리스크 요인, 세그먼트, 실적 동인, 온톨로지, 구조화된 지식 그래프.

**Words to avoid:** 수익 보장, 종목 추천, 매수 신호, 예측 확정, 자동 투자, 무조건 정확, 완전 대체, hallucination-free, "공시 문장과 사업 활동, 리스크, 세그먼트, 실적 동인을 연결" as a first-line marketing hook.

**Glossary:**

| Term | Meaning |
|------|---------|
| Evidence path | 답변이 어떤 공시 문장과 연결에서 나왔는지 보여주는 근거 흐름 |
| Ontology | 공시 문장, 사업 활동, 리스크, 지표를 연결하는 구조화된 지식 그래프 |
| Markdown research answer | 채팅 화면에서 바로 읽고 후속 질문으로 이어갈 수 있는 공시 근거 기반 답변 |
| Analysis credit | 사용자가 월간 한도 안에서 실행하는 질문/분석 단위 |
| Supported company | 현재 온톨로지 인덱스에 포함되어 분석 가능한 회사 |
| Source trail | 사용자가 답변에서 원문 근거로 되돌아갈 수 있게 남기는 확인 경로 |

## Brand Voice

**Tone:** Professional, precise, calm, evidence-first.

**Style:** Direct Korean copy with finance and AI terms used only when they improve clarity. Avoid hype. Lead with what the user can verify.

**Personality:** Rigorous, practical, transparent, focused, trustworthy.

## Proof Points

**Metrics:** Not yet validated. Track activation, answer completion, citation interaction, repeat usage, free-to-paid conversion, and paid retention before making quantified claims.

**Customers:** Not yet public. Avoid logo or testimonial claims until available.

**Testimonials:**

> Placeholder only. Do not publish testimonial copy until real customer permission exists.

**Value themes:**

| Theme | Proof |
|-------|-------|
| Faster filing research | Measure time from question submitted to answer completed |
| Trust through citations | Measure citation opens and source-path interactions |
| Repeatable workflow | Measure saved sessions, returning users, and repeat questions |
| Better self-serve activation | Measure first question completion and second-session return |

**Proof gaps to close:**

- Time saved versus manual filing review.
- Citation interaction rate after answer generation.
- Percentage of users who submit a second question within seven days.
- Conversion rate from free monthly limit reached to paid upgrade.
- Public examples or anonymized case studies for specific company questions.

## Goals

**Business goal:** Build a self-serve paid SaaS for Korean-speaking investors who need evidence-backed US public company research.

**Conversion action:** Free user submits first successful question, opens at least one citation or evidence path, then upgrades when monthly analysis volume is insufficient.

**Current metrics:** Unknown. Use Supabase-owned analytics events in the next implementation phase to establish baselines.

**Near-term marketing goals:**

- Clarify homepage positioning around evidence-backed filing research.
- Instrument the funnel from homepage view to answer completion.
- Launch a free tier with transparent monthly analysis limits.
- Add SEO and AI-search content around filing analysis and company research questions.
- Produce onboarding, lifecycle email, and upgrade messaging for self-serve conversion.
