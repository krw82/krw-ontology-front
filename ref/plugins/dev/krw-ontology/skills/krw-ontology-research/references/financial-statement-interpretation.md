# Financial Statement Interpretation Rules

Use this reference for FCF, OCF, capex, R&D, M&A, buyback, cash-flow bridge, and capital-allocation questions.

Normal web-chat answers must not expose this reference name or internal checklist language. Apply the rules silently, then write analyst prose.

## Core rule

Do not mix income-statement expenses, FCF calculation items, investing cash-flow items, and financing cash-flow items as if they were the same kind of "cash use."

Keep these layers separate:

```text
P&L operating expenses:
- R&D
- sales and marketing
- G&A
- restructuring or acquisition-related expense when reported as operating expense

Operating cash flow / FCF calculation:
- cash from operating activities
- capex / purchases of property and equipment
- company-defined non-GAAP FCF adjustments

Investing cash flows:
- business combinations, net of cash acquired
- acquisitions, net of cash acquired
- purchases of businesses
- purchases/sales of investments
- strategic investments when classified as investing activity

Financing cash flows:
- share repurchases
- dividends
- debt issuance
- debt repayment
- equity issuance
```

## R&D and FCF

Do not treat R&D as a post-FCF use of cash after FCF has already been calculated.

R&D is normally an operating expense. It is reflected before operating cash flow, subject to normal working-capital and non-cash adjustments.

Correct framing:

```text
The company spends heavily on R&D and still generates high OCF/FCF.
After that, cash is allocated to capex, acquisitions, investments, buybacks, debt, or dividends.
```

Avoid this framing:

```text
FCF uses = buybacks + M&A + R&D + capex
```

If discussing reinvestment broadly, separate the layers:

```text
Operating reinvestment: R&D and go-to-market spending.
FCF calculation: capex.
Capital allocation beyond operating reinvestment: M&A, investments, buybacks, debt, dividends.
```

## M&A cash spending

For actual M&A cash outflow, use cash-flow statement acquisition lines such as:

```text
business combinations, net of cash acquired
acquisitions, net of cash acquired
purchases of businesses
cash paid for acquisitions
```

Do not use FCF reconciliation addbacks as acquisition purchase price.

Common trap:

```text
business combination and other related costs
acquisition-related costs
transaction and integration costs
```

These are usually expenses, adjustments, compensation/integration costs, or non-GAAP reconciliation items. They are not automatically the actual M&A cash purchase price.

Before saying M&A increased or decreased, verify the cash-flow statement line for acquisitions and compare multiple periods, not only the latest quarter.

## FCF definitions

Always distinguish simple FCF from company-defined non-GAAP FCF when the values differ.

```text
simple FCF = operating cash flow - capex
company-defined FCF = company non-GAAP definition, often with disclosed adjustments
```

When using company-defined FCF:

```text
state that it is the company's disclosed FCF
check addbacks and adjustments
avoid mixing it with a simple OCF-minus-capex number without labeling the difference
```

When using simple FCF:

```text
state that it is a simple OCF minus capex calculation
do not imply it is the company's official non-GAAP FCF if the company reports a different value
```

## Share repurchases

Share repurchases can be capital return, dilution management, or both.

Before interpreting buybacks as aggressive shareholder return, check whether the company explains the purpose as:

```text
offsetting stock-based compensation dilution
managing dilution impact
accelerated share repurchase
opportunistic capital return
regular capital return program
```

Correct framing:

```text
Buybacks increased materially, but part or all of the program may be aimed at managing dilution from stock-based compensation.
```

Avoid this framing when the filing says dilution management:

```text
All buybacks are pure shareholder return.
```

## Inflection timing

Do not declare the latest quarter as the start of a capital-allocation shift without checking prior annual periods.

For pattern-change claims, compare:

```text
two or more historical annual periods
the most recent annual period
the latest quarter or year-to-date period
```

Correct framing:

```text
The shift began in the latest annual period and became more visible in the latest quarter.
```

Avoid this framing when the annual-period change already happened:

```text
The latest quarter was the first clear inflection point.
```

## AI / platform attribution

For AI, platform, automation, cloud, data, security, or product-strategy questions, do not attribute revenue growth, cost growth, margin movement, capex, M&A, or FCF changes directly to that strategy unless the filing explicitly supports the connection.

Separate these layers:

```text
Disclosed fact:
- subscription revenue grew
- cost of subscription revenue grew
- R&D expense grew
- capex increased
- business combinations increased
- management highlights AI/platform strategy

Supported interpretation:
- AI/platform strategy may support the growth narrative
- AI/platform expansion may require continued product, infrastructure, cloud, data, security, or talent investment when the filing names those cost drivers
- AI/platform strategy can raise the question of gross margin or FCF durability when costs are rising faster than revenue

Unsupported overstatement:
- AI caused subscription revenue growth
- AI inference cost caused cost-of-revenue growth
- AI is the primary driver of margin compression
- AI caused capex or M&A to increase
```

If AI/platform is strategically important but not separately quantified, use wording like:

```text
AI/platform expansion strengthens the growth narrative, but the filing does not isolate how much of subscription revenue growth came from AI.
The cost pressure is visible, but the filing does not quantify AI inference cost separately.
```

Before finalizing an AI/platform financial-impact answer, silently check:

```text
Is the latest available filing the primary evidence anchor?
Is this a renewal rate, retention rate, RPO/cRPO, or subscription revenue mix?
Is AI/platform contribution separately quantified?
Did the filing disclose specific cost drivers?
Did I use the newest material M&A, buyback authorization, and cash-flow period available in the filings?
Did I distinguish company-defined FCF from simple OCF minus capex?
```

## Final pre-answer checklist

Before finalizing FCF or capital-allocation analysis, silently check:

```text
Did I separate P&L expense, OCF/FCF calculation, investing cash flow, and financing cash flow?
Did I avoid adding R&D again after FCF?
Did I use acquisition cash-flow lines for M&A spending, not FCF addback costs?
Did I label company-defined FCF versus simple OCF minus capex?
Did I check whether buybacks are dilution management, capital return, or both?
Did I compare the latest quarter against prior annual periods before calling an inflection?
Did I avoid attributing revenue, cost, margin, capex, M&A, or FCF changes to AI/platform strategy unless the filing supports that attribution?
```
