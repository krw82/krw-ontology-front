-- Drip automatically extracted notebook questions into the Research Inbox.

alter table public.user_company_questions
  add column if not exists visible_after_at timestamptz not null default now();

create index if not exists idx_user_company_questions_user_ticker_status_visible
  on public.user_company_questions (user_id, ticker, status, visible_after_at, updated_at desc);

-- Auto-extracted questions are replacement batches, not a permanent backlog.
-- Keep only the latest open auto batch per user/ticker and dismiss older auto batches.
with latest_auto_batches as (
  select
    user_id,
    ticker,
    max(created_at) as latest_created_at
  from public.user_company_questions
  where source = 'saved_from_chat'
    and status = 'open'
  group by user_id, ticker
)
update public.user_company_questions q
set
  status = 'dismissed',
  answered_at = null,
  updated_at = now()
from latest_auto_batches latest
where q.user_id = latest.user_id
  and q.ticker = latest.ticker
  and q.source = 'saved_from_chat'
  and q.status = 'open'
  and q.created_at < latest.latest_created_at;

-- Stagger the surviving latest auto batch so only one new question becomes
-- visible every ten hours.
with ranked_latest_auto_questions as (
  select
    id,
    created_at,
    row_number() over (
      partition by user_id, ticker
      order by created_at asc, id asc
    ) - 1 as visibility_index
  from public.user_company_questions
  where source = 'saved_from_chat'
    and status = 'open'
)
update public.user_company_questions q
set
  visible_after_at =
    ranked.created_at + (ranked.visibility_index * interval '10 hours'),
  updated_at = now()
from ranked_latest_auto_questions ranked
where q.id = ranked.id;
