# Official Web Source Worker

## Purpose

This worker expands the market feed from X-only ingestion into official web-source ingestion without moving product data out of Supabase.

```text
Supabase Cron
  -> pg_net signed POST
  -> existing Cloud Run / Next service
  -> /api/internal/market-sources/drain
  -> PGMQ poll queue
  -> discovery URL
  -> detail URL
  -> market_source_items
  -> issue correlation
  -> existing Claim / enrichment worker
```

Cloud Run is only the compute boundary. Supabase remains the system of record for source configuration, cursors, candidates, source text, issues, enrichment jobs, and dead letters.

## What the migration adds

`20260731200000_market_issue_web_sources.sql` adds:

- Generic `market_issue_sources` fields such as `source_key`, `adapter_type`, `discovery_url`, and polling configuration.
- Fetch state with ETag and Last-Modified support.
- Candidate URL, fetch-run, dead-letter, and source-entity tables.
- Separate PGMQ queues for `poll`, `detail`, and `correlate` work in `dev`, `staging`, and `prod`.
- A per-minute `pg_cron` dispatcher for production. It only wakes the worker after `worker_webhook_url` and `worker_webhook_secret_name` are configured.

Existing X rows remain `source_type = 'x'` and use the existing X ingestion worker. The X worker now filters to only X sources, so a new web source cannot accidentally be sent to the X API.

## Source configuration

Use `MARKET_ISSUE_WEB_SOURCES` to bootstrap source configuration at worker startup. It is a JSON array. Existing DB rows are intentionally not overwritten by this seed, so an admin can pause a source or adjust its polling configuration without a Cloud Run restart reverting that decision.

```json
[
  {
    "sourceKey": "example-investor-relations",
    "displayName": "Example Corp Investor Relations",
    "sourceType": "web",
    "sourceClass": "company_official",
    "sourceTags": ["IR"],
    "adapterType": "rss",
    "channelType": "ir",
    "discoveryUrl": "https://investors.example.com/rss.xml",
    "canonicalHost": "investors.example.com",
    "pollIntervalSeconds": 900,
    "priority": 90,
    "maxItemsPerPoll": 20,
    "adapterConfig": {
      "include_path_regex": "/news|/press-release|/earnings",
      "analyze_images": true,
      "allowed_hosts": ["investors.example.com", "images.example.com"]
    }
  }
]
```

Supported adapters are:

- `rss`
- `atom`
- `json_feed`
- `json_api`
- `sitemap`
- `html_list`
- `sec_catalog` (existing `sec_filing_events` rows; 8-K/6-K by default)

For an official page without RSS, start with `html_list` and narrow it with `include_path_regex` and `exclude_path_regex`. Do not use a broad corporate home page as a discovery URL.

`sec_catalog` bridges the existing filing pipeline into the same market-issue system. Configure it as `sourceType: "sec"`, `sourceClass: "regulator"`, `canonicalHost: "www.sec.gov"`, and a placeholder `discoveryUrl` on that host. It reads ready 8-K/6-K event rows from Supabase, then fetches the official SEC primary document URL. Set `adapterConfig.only_feed_eligible` to `false` only when the general market feed should include all ready filings; Form 4 requires `include_form4: true` or explicit `form_types`. Set `adapterConfig.user_agent` to a descriptive contact User-Agent for SEC requests.

```json
{
  "sourceKey": "sec-filing-catalog",
  "displayName": "SEC Filing Catalog",
  "sourceType": "sec",
  "sourceClass": "regulator",
  "sourceTags": ["SEC", "FILING"],
  "adapterType": "sec_catalog",
  "channelType": "filing",
  "discoveryUrl": "https://www.sec.gov/edgar/browse/",
  "canonicalHost": "www.sec.gov",
  "pollIntervalSeconds": 300,
  "priority": 100,
  "adapterConfig": {
    "form_types": ["8-K", "8-K/A", "6-K", "6-K/A"],
    "only_feed_eligible": true,
    "user_agent": "KRW Ontology research@example.com"
  }
}
```

Every source requires `canonicalHost`. The worker accepts only HTTPS URLs on that host or on explicitly declared `adapterConfig.allowed_hosts`; it rejects loopback, private-network, `.local`, and `.internal` targets. The same host allowlist is applied to optional article-image downloads and redirects.

Authenticated admins can also create or update web sources through `/api/admin/news/sources`. Use `sourceType: "web"` or `"sec"` plus `sourceKey`, `adapterType`, `discoveryUrl`, and `canonicalHost`. Legacy requests without `sourceType` remain X-source requests.

## Cloud Run / Supabase wiring

Deploy the current Next service to Cloud Run as usual. No separate database, queue, or GCS bucket is required for this worker.

Set these runtime variables on the Cloud Run service:

```text
SUPABASE_URL=<project URL>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
MARKET_ISSUE_ENV=prod
MARKET_ISSUE_WORKER_WEBHOOK_SECRET=<shared random secret>
MARKET_ISSUE_WEB_SOURCES=<JSON source array>
```

Create the same shared secret in Supabase Vault, then configure the production settings row:

```sql
update public.market_issue_settings
set worker_webhook_url = 'https://<cloud-run-host>/api/internal/market-sources/drain',
    worker_webhook_secret_name = '<vault-secret-name>'
where env = 'prod';
```

The dispatcher signs `timestamp.environment.max_jobs` with HMAC-SHA256. The route rejects missing signatures, invalid environments, mismatched bodies, and signatures older than five minutes.

Use the route only after the migration has been applied. Before webhook configuration, the cron dispatcher can queue due work but cannot invoke Cloud Run.

## Processing and retries

1. The poll queue fetches only a source's discovery endpoint and uses ETag and Last-Modified when available.
2. Newly discovered URLs become `market_source_candidates` rows and detail jobs.
3. The detail queue stores normalized original text in `market_source_items`.
4. The correlation queue joins exact canonical URL or normalized-text duplicates to an existing issue; otherwise it creates a review-only issue.
5. Every issue is enqueued into the existing Claim and research-packet enrichment workflow.

Messages remain invisible for five minutes after claiming. A failing message is retried by PGMQ; after four reads the worker archives it and records the payload and failure in `market_worker_dead_letters`.

Low-signal material such as event promotion, hiring, anniversaries, or awards is retained as source material but is marked `low` and forced to manual review. It is never treated as an automatic publication path.

## Operations visibility

Authenticated market-news admins can inspect a source with:

```text
GET /api/admin/news/sources/<source-id>
```

The response includes the fetch cursor/state, the 25 most recent discovery/detail runs, recent candidates, and queued/processing/failed candidate counts. This endpoint is intentionally service-role-backed and returns `Cache-Control: private, no-store`.

## Image handling

The web worker never writes image bytes or temporary image files. When `adapterConfig.analyze_images` is true, it stores up to four allowlisted remote image references in `market_source_media`; the existing media extractor downloads each image only into process memory, sends it to the vision model, and clears the buffer immediately after extraction.

This intentionally avoids a new storage bill and prevents a failed image extraction from blocking the official text path.

## Local worker option

The internal route is the normal Cloud Run execution path. `src/worker/market-web-source-worker.ts` is available for a long-running local or VM process when manual backfills are needed. It reads the same environment variables and writes only to Supabase.

## First production rollout

1. Apply the migration to staging.
2. Configure two RSS/IR sources with a 15-minute interval.
3. Set the staging webhook URL and Vault secret.
4. Inspect `market_source_fetch_runs`, `market_source_candidates`, and `market_worker_dead_letters` for one day.
5. Promote the same source config to production only after extracted original text and issue correlation look correct.

Do not turn on browser-rendered sources in the first rollout. Add a Playwright-specific adapter only for individual sources that demonstrably require JavaScript after normal HTTP extraction has failed.
