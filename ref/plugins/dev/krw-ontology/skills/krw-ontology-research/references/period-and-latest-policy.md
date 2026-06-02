# Period And Latest Policy

## User-facing labels

Use CY-style ontology labels in final answers.

```text
Good: CY2026Q1, CY2025
Bad: FY2026, FY 2026
```

If the issuer fiscal calendar matters, add only a short parenthetical note.

## Default period anchor

Unless the user explicitly asks for a historical period, long-term evolution, or a specific filing period, start from the most recent available filing evidence.

A newer 10-Q beats an older 10-K for current drivers, financial impact, cost structure, cash flow, risk, and management commentary.

The latest 10-K is primary only when no newer 10-Q is available, or when the question specifically asks for annual baseline, full-year business mix, full-year financials, risk-factor baseline, or long-horizon business structure.

If the available documents are `CY2025 10-K` and `CY2026Q1 10-Q`, use `CY2026Q1 10-Q` for current drivers and recent financial impact, and use `CY2025 10-K` as annual mix/business baseline context.

## Recent/latest wording

If the user says:

```text
최근
최신
최근 매출 동인
최근 분기
latest
recent
most recent
```

the default period anchor becomes even more important: start with the most recent available filing by filing/period recency.

Example: if the available documents are `CY2025 10-K` and `CY2026Q1 10-Q`, lead with `CY2026Q1 10-Q` for current drivers and use `CY2025 10-K` as annual mix/business baseline context.

Example: if `CY2026Q1 10-Q` and `CY2026Q2 10-Q` are both available, lead with `CY2026Q2 10-Q`.

## Business model plus recent drivers

Answer order:

```text
1. most recent filing drivers/current changes
2. annual mix/business baseline when it is not already the most recent filing
3. interpretation and caveats
```

Do not open with annual-only framing when the user explicitly asks for recent drivers.
