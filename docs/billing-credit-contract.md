# Billing & Credit Contract

## 1. Status

- Version: `2026-06-credit-v1`
- Launch enforcement mode: `enforced`
- User-facing billing: monthly subscription
- User-facing usage reset: weekly credit refill from each user's credit anchor
- Default production plan for users without an entitlement row: `free`

This document is the implementation contract for KRW Ontology billing and
analysis credits. Product copy can simplify these terms, but code, database
RPCs, tests, and operational dashboards should follow this contract.

## 2. Core Principles

- Monthly billing, weekly credit periods, user analysis credits, and actual
  provider cost are separate concepts.
- User credits are a stable product unit. Provider cost is an internal
  accounting unit.
- Every run must be idempotent by `(user_id, request_id)`.
- Every billable run must be reserved before execution.
- Settlement must use the plan, credit policy, pricing policy, and weekly
  period snapshot captured at reservation time.
- Raw analysis credits are the user-facing enforcement unit. Legacy USD budget
  rows may remain for audit and margin reporting, but they must not block runs.

## 3. Plans

| Plan | Monthly price | Weekly display credits | Weekly raw credits |
| --- | ---: | ---: | ---: |
| Free | KRW 0 | 300 | 300,000 |
| Standard | KRW 7,900 | 2,000 | 2,000,000 |
| Pro | KRW 29,000 | 6,000 | 6,000,000 |

Internal and beta plans may exist, but they are not public pricing plans.
`internal` is unlimited for operations. `beta` is allowlist-only and must never
be the default production fallback.

## 4. Credit Policy

- Credit policy version: `credit-v1`
- Raw user credits:

```text
raw_credits_used = input_tokens + output_tokens * 2
```

- Display credits:

```text
display_credits = raw_credits / 1000
```

- Display credits are derived and must not be persisted as their own balance.
- Token weights belong to a versioned credit policy, not to individual plan
  rows.
- Cache hit status does not change user credit usage. Cache savings belong to
  internal margin.

## 5. Provider Cost Policy

- Initial provider: `deepseek`
- Initial provider model: `deepseek-v4-flash`
- Pricing policy version: `deepseek-v4-flash-2026-06`
- Pricing source: DeepSeek official model pricing page,
  `https://api-docs.deepseek.com/quick_start/pricing`
- Pricing verified at: `2026-06-20`

Actual provider cost is recorded separately from user credits:

```text
actual_provider_cost_usd =
  prompt_cache_miss_tokens * 0.14 / 1_000_000
  + prompt_cache_hit_tokens * 0.0028 / 1_000_000
  + output_tokens * 0.28 / 1_000_000
```

When cache hit/miss token counts are unavailable, all input tokens are treated
as cache miss for provider-cost estimation. That is conservative and keeps old
run data usable.

## 6. Period Policy

- Toss Payments provides the billing key and individual payment result, but
  does not operate the subscription schedule. The application owns the
  calendar-month renewal schedule and stores each payment response as the
  payment source of truth.
- `billing_period_start` is the merchant renewal due timestamp.
- `billing_period_end` is the next calendar-month anniversary, preserving the
  original time and clamping month-end dates when necessary.
- `credit_anchor_at` is fixed at the first paid activation timestamp.
- A weekly credit period is exactly `7 * 24 hours` from `credit_anchor_at`.
- Monthly billing renewal does not reset `credit_anchor_at`.
- Free users may have `credit_anchor_at = null` until their first successful
  credit reservation. Free anchor creation and first reservation must happen in
  one PostgreSQL transaction.
- Runs that cross a weekly boundary settle into the weekly bucket captured at
  reservation time.

## 7. Reservation And Settlement

The raw credit ledger must support these operations:

- `reserve_analysis_credits`
- `attach_analysis_credit_run`
- `settle_analysis_credits`
- `release_analysis_credits`
- `expire_stale_analysis_credit_reservations`

Reservation requirements:

- Lock the entitlement row with `FOR UPDATE`.
- Create a free user's credit anchor atomically if needed.
- Lock the weekly balance row with `FOR UPDATE`.
- In enforced mode, enforce
  `(credits_used_raw + credits_reserved_raw + reserve) <= limit`.
- In shadow mode, return `allowed=false` and reason
  `weekly_credit_limit_exceeded` for would-block reservations, but still create
  the reservation and ledger entries so the run can settle into shadow metrics.
- Return the same reservation for the same active `(user_id, request_id)`.
- Snapshot plan key, plan version, credit policy, pricing policy, and weekly
  period into the run credit row.

Settlement requirements:

- Use actual user-billable tokens for `settled_credits_raw`.
- If actual usage is lower than reservation, release the difference.
- If actual usage is higher than reservation, settle the actual amount as a
  bounded overage for the current run and block future runs until available
  credit is positive again.
- Do not double-settle terminal runs.

Initial reservation amounts should be based on production p90 or p95 raw credit
usage by `run_kind` and `research_mode`. If a category has little or no history,
use a conservative fallback.

## 8. Failure And Cancellation Policy

No user credits are charged for:

- server errors
- provider errors
- failed provider retry attempts
- MCP/tool failures with no user-visible result
- cancellation with no user-visible result

User credits are charged for:

- `completed`
- `partial_completed`, only when explicitly marked by application code

Actual provider cost is recorded even when user credits are not charged.

Normal agent loop calls that contribute to the final answer are user-billable.
Provider attempts that fail before producing user-visible result are internal
cost only.

## 9. Plan Changes

Upgrade:

- Applies immediately in the app.
- Keeps the same weekly anchor.
- Charges only the prorated remaining-period difference between the current
  monthly price and the target monthly price.
- New remaining credits are `new weekly limit - current week used/reserved`.

Downgrade:

- Is scheduled at the payment provider for the next monthly renewal.
- Applies in the app from the first weekly boundary after the downgraded paid
  period begins.

Cancellation:

- Paid entitlement remains active until `billing_period_end`.
- After `billing_period_end`, new runs are blocked.
- Remaining weekly credits do not roll over.

Past-due handling must distinguish these statuses:

- `active`
- `past_due`
- `grace`
- `cancelled`
- `expired`

- A failed monthly renewal enters a three-day `grace` period.
- Renewal retries use the same persisted order until Toss confirms that no
  payment exists. This prevents duplicate charges after network uncertainty.
- When grace expires without a successful payment, the paid subscription
  becomes `expired` and access returns to Free.

## 10. Toss Renewal Operations

- A dedicated billing worker runs renewal and stale-reservation reconciliation.
- Due subscriptions are claimed with a PostgreSQL `FOR UPDATE SKIP LOCKED`
  lease before a Toss request is sent.
- At most one `pending | paid` payment may exist for the same subscription,
  payment kind, and billing period.
- Network-uncertain payments remain `pending` and are queried by `orderId`
  before any retry.
- Known provider declines become failed attempts and may create a new attempt
  with a new order and idempotency key.
- Cancellation is effective at `billing_period_end`; the billing key is then
  deleted from Toss on a best-effort basis.

## 11. Enforcement Rollout

Phase 1: additive database migration.

Phase 2: dual-write old USD budget ledger and new raw credit ledger. The new
ledger is validated in shadow mode only before paid launch. Would-block credit
reservations must still be recorded and settled for shadow metrics.

Phase 3: run shadow metrics for two to four weeks:

- raw credit p50/p75/p90/p95 by run kind
- reservation overage rate
- credit 50/80/100 percent usage rate
- cache hit rate
- actual provider cost
- failure and retry actual cost

Phase 4: UI shows weekly credits and soft warnings. Legacy USD budget checks are
kept as audit ledgers only and must not gate runs.

Phase 5: switch enforcement to raw credit reservation.

Phase 6: keep old ledger read-only for audit or remove it after stability is
proven.

## 12. Required Runtime Metrics

Operator reporting starts from:

- `analysis_credit_run_costs`: run-level tokens, user credits, cache tokens,
  provider cost, and pricing snapshot.
- `analysis_credit_weekly_usage_summary`: weekly credit usage, run count, and
  average provider cost per run.

- `run_kind` and `research_mode` raw credit distribution
- reservation overage rate
- weekly credit usage percent by plan
- cache hit rate
- actual provider cost in USD and KRW
- free-to-paid conversion
- Standard-to-Pro conversion
- failed and retry provider cost
- stale reservation expiry count

## 13. Required Tests

- concurrent reservations cannot exceed weekly limit
- same request id cannot double-reserve or double-settle
- free anchor creation is atomic
- run crossing weekly boundary settles into starting bucket
- stale reservations expire
- actual usage below reservation releases remaining credits
- actual usage above reservation settles bounded overage
- `failed` releases reservation
- `partial_completed` charges only when explicitly marked
- upgrade increases available weekly limit immediately
- downgrade does not corrupt current weekly bucket
- provider retry cost is recorded but not user charged
- cache hit and miss actual cost calculation is reproducible by pricing version
- old plan keys backfill correctly
- `internal` remains unlimited
- concurrent renewal workers cannot claim the same subscription
- network-uncertain renewal queries the existing Toss order before charging
- upgrade charges the prorated difference and raises the current weekly limit
- downgrade charges the new price at renewal and applies at the next weekly
  boundary
- grace expires to Free without retaining a paid credit anchor

## 14. Production Readiness Gate

Paid production launch requires all of these to pass:

- `ANALYSIS_CREDIT_ENFORCEMENT_MODE=enforced` in the production VM env.
- `TOSS_PAYMENTS_CLIENT_KEY` starts with `live_ck_`.
- `TOSS_PAYMENTS_SECRET_KEY` starts with `live_sk_`.
- `/api/healthz` is healthy.
- unauthenticated `POST /api/billing/toss/quote` returns `401`.
- the removed `POST /api/billing/toss/checkout` route returns `404`; V2 never
  falls back to the former direct checkout contract.
- `/ko/pricing` renders the public Standard and Pro prices and weekly credits.
- GCP `web` and `billing-worker` compose services are running.

Run the gate with:

```sh
npm run billing:prod:readiness
```

`ALLOW_MISSING_TOSS_PAYMENTS=1` may be used only for an emergency non-launch
deploy. `--allow-test-toss-keys` is only for staging-like verification and does
not satisfy paid production readiness.
