---
name: krw-ontology-scenario-sensitivity
description: Use when the user asks for filing-grounded upside/base/downside scenarios, operating-driver sensitivity, macro or business-factor sensitivity, liquidity or dilution downside, event-path consequences, breakpoints, thesis-break conditions, or evidence-based action thresholds for a covered public company. Do not use for ordinary company research, generic risk explanation, first-pass idea discovery, current-news discovery, target prices, or personalized buy/sell advice.
---

# KRW Ontology Scenario And Sensitivity

## 1. Purpose

Turn a covered-company filing baseline into conditional scenarios that show:

```text
what must change
-> which business channel moves
-> how revenue, margin, cash flow, or liquidity responds
-> what strengthens, weakens, or breaks the investment view
```

This skill analyzes scenario mechanics. It does not invent a valuation model, market probability, target price, position size, stop-loss level, or trade instruction.

Default visible output:

```text
Korean Markdown only.
```

## 2. Shared Research Contract

Before research, read and follow:

```text
../krw-ontology-research/references/tool-policy.md
../krw-ontology-research/references/query-context-contract.md
../krw-ontology-research/references/period-and-latest-policy.md
../krw-ontology-research/references/trace-chain-policy.md
../krw-ontology-research/references/evidence-to-analyst-synthesis.md
../krw-ontology-research/references/financial-statement-interpretation.md
../krw-ontology-research/references/plain-korean-investor-language.md
../krw-ontology-research/references/forbidden-user-facing-language.md
../krw-ontology-research/references/bounded-autonomy-and-stop-rules.md
```

These rules govern:

```text
internal English investment briefs
query_context-first research
latest 10-Q as current driver
latest 10-K as annual business baseline
selected trace/chain verification
accounting-layer discipline
plain Korean investor language
no internal implementation language in visible answers
```

Do not load or apply:

```text
../krw-ontology-research/references/investment-decision-questions.md
the buy/sell/hold report template
target-price logic
personalized portfolio or position-sizing logic
```

## 3. Request Boundary

Use this skill for:

```text
상승·기준·하락 시나리오를 만들어줘.
수요가 둔화되면 현금흐름이 어떻게 달라져?
설비투자 확대에 얼마나 민감해?
어떤 조건에서 투자 가설이 깨져?
증자나 추가 차입이 필요해지는 하방 경로를 봐줘.
이 계약이 지연되거나 취소되면 어떤 영향이 생겨?
```

Do not use this skill for:

```text
ordinary company overview
simple latest-quarter summary
generic risk-factor explanation without a scenario request
current-news discovery or article selection
candidate screening across companies
final target price or fair value
definitive buy/sell/hold advice
portfolio sizing, hedging, borrow, options, or execution
```

If the user asks what a current news event means, use the news-research workflow first. This skill may analyze a user-supplied scenario, but it does not discover current events.

## 4. Internal Scenario Brief

Before calling ontology tools, rewrite the request as a concise internal English scenario brief.

Preserve:

```text
ticker and company
latest reported period
scenario variable or event
direction of change
time horizon if supplied
financial channels
named user assumptions
requested downside or thesis-break focus
```

Add evidence axes:

```text
latest management commentary and filing notes
current business and financial baseline
direct exposure and transmission mechanism
revenue, margin, cash-flow, capex, debt, and liquidity path
offsetting factors
first observable confirmers and falsifiers
```

Do not expose the internal English brief.

## 5. Scenario Modes

Classify the request before research:

```text
A. Operating-driver scenario
   demand, price, volume, mix, capacity, customer, backlog, or cost

B. External-factor sensitivity
   commodity, FX, rates, regulation, geography, supply chain, or macro demand

C. Capital and liquidity downside
   capex burden, cash burn, refinancing, debt, dilution, buybacks, or M&A

D. Event-path scenario
   contract, project, product, acquisition, litigation, regulatory, or milestone path

E. User-assumption sensitivity
   user-provided growth, margin, capex, financing, timing, or valuation inputs
```

Read only the references needed for the selected mode:

```text
references/scenario-construction.md
references/sensitivity-policy.md
references/event-liquidity-policy.md
references/action-threshold-policy.md
references/output-contract.md
```

## 6. Default Workflow

Follow this order:

```text
1. Build the internal English scenario brief.
2. Start with query_context for the named company and scenario variable.
3. Anchor the current driver on the newest available 10-Q; use the latest 10-K for annual mix, historical trend, and structural risk.
4. Identify one to three load-bearing variables. Do not model every possible input.
5. Separate reported facts, filing-derived assumptions, user assumptions, and analyst conditional inference.
6. Build base, upside, and downside cases around the same variables and comparable time context.
7. Map each case through business mechanism -> financial channel -> investor meaning.
8. Use one targeted query only for a material missing axis.
9. Use selected trace/chain only when a strong mechanism, amount, date, term, or direct-exposure claim needs support.
10. Write the Korean scenario report.
```

Do not request `response_detail="full"` in normal web chat.

## 7. Assumption Provenance

Every material scenario input must belong to one category:

```text
Reported fact:
explicit filing number, term, date, guidance, or management statement

Filing-derived assumption:
conditional interpretation supported by filing evidence

User assumption:
number, probability, time horizon, price, or condition supplied by the user

Analyst conditional inference:
directional scenario logic not explicitly stated by the company
```

Never present an analyst assumption as company guidance or filing fact.

## 8. Numeric And Probability Policy

When the user does not provide numerical assumptions, use qualitative sensitivity:

```text
strengthens / remains stable / weakens
improves / stays constrained / deteriorates
lower / similar / higher burden
earlier / unchanged / delayed conversion
```

Use numerical scenario tables only when:

```text
the user supplied the numbers
the filing or company guidance explicitly supplied the values
the arithmetic follows directly from sourced values with a visible formula
```

Do not invent:

```text
growth rates
margin thresholds
probabilities
terminal values
valuation multiples
target prices
time horizons
stop-loss levels
N-out-of-M decision rules
```

## 9. Financial Path Discipline

Keep these layers separate:

```text
operating change
-> revenue or cost effect
-> margin effect
-> operating cash-flow effect
-> capex and investing cash flow
-> financing need, debt, dilution, or capital allocation
```

Do not count R&D again as a post-FCF use of cash. Do not treat M&A-related FCF addbacks as acquisition purchase price. Do not treat all buybacks as pure shareholder return.

## 10. Action Threshold Meaning

Action thresholds are evidence conditions, not personalized trade orders.

Use:

```text
판단 강화
판단 유지
판단 약화
가정 파기
```

Prefer observable company evidence:

```text
orders convert into reported revenue
margin improves despite investment
cash conversion catches up with growth
capex burden rises without operating proof
liquidity weakens or financing dependence increases
management commentary conflicts with reported direction
```

Without user position context, use `추가 확인`, `기다림`, `재검토`, or `가정 파기` language. Do not imply add, trim, exit, hedge, or stop-loss execution.

## 11. Coverage And Stop Rules

Use covered companies only unless the user explicitly names another company and accepts the evidence limitation.

Stop when:

```text
the current baseline and one to three scenario variables are supported
each scenario has a mechanism, offset, and observable signpost
the remaining gap requires market price, consensus, portfolio, or unsupported valuation data
another tool call would add volume rather than change the scenario judgment
```

## 12. Final Answer

Follow `references/output-contract.md`.

The answer should:

```text
start with one practical scenario judgment
show the current filing baseline
use one interpretation-first scenario table
identify the binding sensitivity and downside path
state what strengthens, weakens, or breaks the view
end with exactly three immediately reusable same-company prompts under "이어서 볼 질문"
```

Keep internal tool, schema, object, pack, index, and routing language out of the answer.
