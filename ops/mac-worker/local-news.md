# Mac-local Finnhub news worker

This worker is the only component that calls Finnhub and Z.ai. It runs on the
Mac, uses the existing Supabase service-role connection, and does not run in
the GCP compose stack.

On every cycle it asks Supabase for every company in the active ontology
catalog for the worker environment. That service-only query returns only the
catalog ticker list; it never reads user IDs, watchlists, interest reasons, or
other per-user coverage data. Finnhub collection is therefore global for the
product and covers the full active company universe.

```text
Mac: Finnhub -> Z.ai two-pass source grounding and impact-path verification -> Supabase public issue
  \-> encrypted local vault (provider, link, article ID, source timestamps, hash)
Supabase service-only: original headline + summary (no provider metadata)
GCP web: Supabase public issue -> /news
```

## Privacy boundary

The worker does **not** insert into `market_issue_sources`,
`market_source_items`, or `market_issue_items`. The Z.ai verified Korean title,
summary, and neutral impact path go to `market_issues`. The original headline
and summary are also
stored in `market_local_news_private_materials`, which is service-role-only and
is never returned by the news API. The following stay only in the encrypted
Mac-local vault and are absent from both Supabase tables:

- provider name
- original URL and article ID
- provider publication and collection times
- source-content hash
- quotation evidence used for AI validation

The remaining `market_issues` timestamps describe the app's publication or
review event, not the provider's source timestamp. The worker does not update
the shared ingestion-status timestamps either. The public issue uses an opaque
random event key and stores no source summary or source count.

## Setup

Add the following to `.env.mac-worker.production` on the Mac. Keep these
values out of GCP runtime environment files.

```sh
LOCAL_NEWS_ENABLED=true
LOCAL_NEWS_VAULT_KEY=$(openssl rand -hex 32)
LOCAL_NEWS_PUBLISH_MODE=publish
# Enables personal fanout only for Z.ai-verified, directly linked interest-company issues.
LOCAL_NEWS_NOTIFICATION_CREATION_ENABLED=1
FINNHUB_API_KEY=...
LOCAL_NEWS_ZAI_API_KEY=...
```

Finnhub calls have a 15-second timeout by default. Override it only with
`LOCAL_NEWS_FINNHUB_TIMEOUT_MS` when the provider needs a different limit.

The production Finnhub key currently advertises 60 requests per minute. The
worker therefore fetches a rotating batch of 45 catalog tickers per cycle and
spaces requests 1.25 seconds apart (48 RPM). With the default 15-minute cycle,
the 355-company active catalog completes one full rotation in roughly two
hours. The public candidate set is restricted to source articles published in
the most recent three hours, with at most four per company.

```sh
LOCAL_NEWS_COVERAGE_BATCH_SIZE=45
LOCAL_NEWS_FINNHUB_REQUEST_INTERVAL_MS=1250
LOCAL_NEWS_LOOKBACK_HOURS=3
LOCAL_NEWS_MAX_ARTICLES_PER_TICKER=4
```

Although Finnhub receives calendar dates, the worker applies this three-hour
window again against the provider publication timestamp before Z.ai runs. A
429 response waits until Finnhub's reset time and retries once. Cycle logs
separate fetch, rate-limit, timeout, curation, publishing, and vault failures.

`LOCAL_NEWS_ZAI_API_KEY` takes priority over `MARKET_ISSUE_ZAI_API_KEY` and the
generic `ZAI_API_KEY`. A Z.ai key is required: articles are never published
from a one-pass model response.

Start with a one-shot run. This performs Finnhub and two Z.ai source-grounded
passes, writes the Korean public projection plus service-only original
headline/summary, and does not expose provider fields or source links in
`/news`.

```sh
npm run local-news:mac:start -- --env-file .env.mac-worker.production --once
```

Set `LOCAL_NEWS_PUBLISH_MODE=review` for a non-public validation run. Changing
it to `publish` and running again promotes the same verified item without a
second Finnhub or Z.ai call.

For continuous local operation:

```sh
npm run local-news:mac:start -- --env-file .env.mac-worker.production
```

Run the preflight by itself when checking the local runtime without provider or
model calls:

```sh
npm run local-news:mac:preflight -- --env-file .env.mac-worker.production
```

The worker is deliberately not included in the GCP web build or its compose
services. Run it via a Mac process supervisor after the one-shot is verified.

## Personal alert boundary

The global Finnhub collection remains independent of individual users. When
`LOCAL_NEWS_NOTIFICATION_CREATION_ENABLED=1`, a published issue is copied to a
user's update inbox only when all of the following are true:

1. Z.ai's second verification pass marked the issue `ai_verified`.
2. `market_issue_entities` has an exact, direct ticker match for a company the
   user explicitly tracks.
3. The issue was published after that user started tracking the company.
4. The user left verified market-news updates enabled.

Raw provider metadata remains in the encrypted local vault. High-risk issues
can use the existing browser-push queue according to the user's delivery mode;
all other verified issues stay in the update inbox or daily digest.

## Z.ai-only publishing boundary

Every published local-news item must pass all of these gates before it reaches
the public feed:

1. The model emits Korean title/summary, a two-to-five-step neutral impact
   path, and exact source quotes for claims.
2. Application code checks every quote is a literal substring of the Finnhub
   headline or summary, and rejects unsupported numeric/unit expressions.
3. A second model pass approves the proposed public text and impact path
   against the source. Directional price predictions are rejected.

The only facts written to `confirmed_facts` are validated model claims. On a
content rejection, the local vault records the reason to avoid repeated paid
calls; an API or database failure remains pending and retries on the next cycle.
Entries from the retired pipeline have no Z.ai curation marker, so the worker
rechecks them once from the encrypted local vault even after they leave
Finnhub's normal lookback window, and republishes only items that pass the
same gates.
