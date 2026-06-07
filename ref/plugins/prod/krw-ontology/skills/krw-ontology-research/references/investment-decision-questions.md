# Investment Decision Brief Rules

Use this reference only to convert vague buy/sell/hold-style Korean questions into an internal English investment brief before KRW ontology MCP calls.

This file is primarily an internal English brief rule.

It also defines a lightweight final answer shape, but only for the triggered buy/sell/hold-style questions in this reference.

Do not let this reference change ordinary research questions.

## Trigger Scope

Apply only when the user's main intent is a vague investment decision, timing, or holding question:

```text
지금 사?
사도 돼?
사 말아?
지금 들어가도 돼?
팔아야 해?
보유해도 돼?
장기적으로 괜찮아?
이 주식 괜찮아?
좋은 회사야?
```

Do not apply this reference when the user asks a clearer normal research question:

```text
metric/numeric series
business model or company overview
risk/thesis/scenario analysis
direct exposure check
comparison
contract/event/factual lookup
sector/global/macro discovery
```

For normal research questions, keep the normal KRW ontology classification and normal internal English brief.

## Core Action

Do not translate the Korean question literally.

Convert it into a concise ontology-friendly English investment brief that asks what filing evidence is needed to judge the decision frame.

The internal brief should:

```text
- preserve ticker, company name, period, price, valuation, portfolio, or comparison assumptions from the user
- use latest available filing evidence first
- treat the latest 10-Q as the current driver when available
- use the latest 10-K as annual business baseline when a newer 10-Q exists
- optimize for evidence retrieval, not final prose
- avoid definitive buy/sell recommendations, target prices, or ratings
```

Do not expose the internal English brief in the final Korean answer.

## Evidence Dimensions For The Brief

Bias the brief toward decision-relevant filing evidence:

```text
revenue durability
demand indicators
segment performance
margin direction
cash-flow conversion
FCF quality
capex and reinvestment burden
debt, liquidity, and balance sheet risk
share count, dilution, SBC, and buybacks
capital allocation
management commentary and filing notes
material risks that could strengthen or weaken the thesis
```

Use numbers internally to verify the judgment, but the final answer should emphasize investor interpretation unless a number materially changes the decision frame.

## Brief Templates

Use one of these patterns as the internal English brief. Adjust only for the user's ticker/company, period, and explicit assumptions.

### New Buy / Entry Timing

For:

```text
지금 사?
사도 돼?
지금 들어가도 돼?
```

Internal brief:

```text
{Company} current new-buy decision frame: latest available filing evidence on growth durability, demand indicators, segment performance, margin direction, cash-flow conversion, capex and reinvestment burden, balance sheet and liquidity risk, dilution/SBC, capital allocation, and material risks. Assess what supports buying now versus waiting. Do not produce a definitive recommendation, rating, or target price.
```

### Buy Versus Wait

For:

```text
사 말아?
```

Internal brief:

```text
{Company} buy-versus-wait decision frame: filing-supported positives, negatives, current drivers, margin and cash-flow durability, capex burden, balance sheet risk, capital allocation, dilution/SBC, and material risks. Identify which filing conditions support a new buy, waiting, or avoiding the stock. Do not produce a definitive recommendation, rating, or target price.
```

### Hold

For:

```text
보유해도 돼?
계속 들고 가도 돼?
```

Internal brief:

```text
{Company} hold decision frame: whether latest available filing evidence shows the investment thesis is intact, improving, or deteriorating. Focus on revenue durability, demand indicators, segment performance, margin direction, cash-flow conversion, capex burden, balance sheet/liquidity, dilution/SBC, capital allocation, and material risks.
```

### Sell Risk

For:

```text
팔아야 해?
손절해야 해?
```

Internal brief:

```text
{Company} sell-risk decision frame: filing evidence for thesis break, growth slowdown, demand deterioration, margin compression, cash-flow deterioration, leverage or liquidity pressure, dilution, capital allocation deterioration, or worsening material risk exposure. Do not produce a definitive sell recommendation, rating, or target price.
```

### Long-Term Quality

For:

```text
장기적으로 괜찮아?
장투해도 돼?
```

Internal brief:

```text
{Company} long-term investment quality frame: business model durability, revenue visibility, segment quality, margin structure, reinvestment runway, cash generation, capital allocation discipline, balance sheet resilience, dilution/SBC, and structural risks. Assess whether filing evidence supports long-term quality versus watch-first caution.
```

### Business Quality Versus Stock Decision

For:

```text
좋은 회사야?
이 주식 괜찮아?
```

Internal brief:

```text
{Company} business quality versus stock decision frame: latest available filing evidence on durable growth, segment economics, margin quality, cash-flow conversion, reinvestment needs, balance sheet risk, dilution/SBC, capital allocation, and risks that could make the business high quality but the stock less attractive, or vice versa.
```

## Final Answer Boundary

After using the internal brief, follow the normal KRW ontology research answer rules.

For triggered buy/sell/hold-style questions only, prefer a compact investment-decision report shape:

```text
# {Company} 투자 판단 요약

## 한 줄 결론
State the practical filing-supported view in one sentence.

## 판단 대시보드
Use a compact qualitative table with columns like 항목 / 판단 / 이유.
Prefer interpretation labels over raw numbers.

## 투자자별 해석
Separate 신규 매수자, 기존 보유자, 장기 투자자, or 단기 투자자 when useful.

## 판단이 바뀌는 조건
Explain what future filing/earnings evidence would make the view more positive or more negative.

## 최종 판단
Separate good company, good stock, and good entry timing.
```

Do not apply this report shape to ordinary research questions.

Do not force the exact headings when a shorter answer is more natural, but keep the answer scannable like a mini investment report.

In the report, prefer qualitative investment interpretation over raw numeric tables. Use numbers only when they materially change the judgment.

The final Korean answer may use clear non-prescriptive judgment labels such as:

```text
매수 후보로 볼 수 있음
공격적 매수보다는 확인 후 접근
기존 보유자는 유지 가능
신규 진입자는 관망에 가까움
장기 성장 투자자에게 더 맞음
현금흐름 중시 투자자에게는 부담이 큼
단기 반등 근거는 약함
공시상 thesis가 깨졌다는 신호는 아직 약함
```

Avoid:

```text
무조건 매수
무조건 매도
지금 사세요
팔아야 합니다
목표가는 얼마입니다
투자의견 매수/보유/매도
개인 투자 조언
```
