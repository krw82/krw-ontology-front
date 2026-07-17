-- Deterministic SEC Form 4 normalization, phase D.
-- Only reported open-market P/S transactions receive a calculated value.
-- Grants, exercises, and other codes are retained as facts but intentionally
-- have no inferred dollar value.

create table if not exists public.sec_form4_reporting_owners (
  filing_event_id uuid not null references public.sec_filing_events(id) on delete cascade,
  reporting_owner_index integer not null,
  owner_cik text,
  owner_name text not null,
  is_director boolean not null default false,
  is_officer boolean not null default false,
  is_ten_percent_owner boolean not null default false,
  is_other boolean not null default false,
  officer_title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (filing_event_id, reporting_owner_index),
  constraint sec_form4_reporting_owners_index_check
    check (reporting_owner_index >= 0),
  constraint sec_form4_reporting_owners_cik_check
    check (owner_cik is null or owner_cik ~ '^[0-9]{1,10}$'),
  constraint sec_form4_reporting_owners_name_length
    check (char_length(trim(owner_name)) between 1 and 500),
  constraint sec_form4_reporting_owners_title_length
    check (officer_title is null or char_length(officer_title) <= 500)
);

create table if not exists public.sec_form4_transactions (
  id uuid primary key default gen_random_uuid(),
  filing_event_id uuid not null references public.sec_filing_events(id) on delete cascade,
  reporting_owner_index integer not null,
  transaction_index integer not null,
  security_kind text not null,
  security_title text not null,
  transaction_date date,
  transaction_code text,
  equity_swap_involved boolean,
  transaction_shares numeric(28, 8),
  transaction_price_per_share numeric(28, 8),
  acquired_disposed_code text,
  shares_owned_following numeric(28, 8),
  direct_indirect_code text,
  nature_of_ownership text,
  reported_transaction_value numeric(28, 2),
  reported_value_basis text not null default 'not_reported',
  footnotes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sec_form4_transactions_owner_fk
    foreign key (filing_event_id, reporting_owner_index)
    references public.sec_form4_reporting_owners(filing_event_id, reporting_owner_index)
    on delete cascade,
  constraint sec_form4_transactions_unique_index
    unique (filing_event_id, reporting_owner_index, security_kind, transaction_index),
  constraint sec_form4_transactions_index_check
    check (transaction_index >= 0),
  constraint sec_form4_transactions_security_kind_check
    check (security_kind in ('non_derivative', 'derivative')),
  constraint sec_form4_transactions_security_title_length
    check (char_length(trim(security_title)) between 1 and 1000),
  constraint sec_form4_transactions_code_check
    check (transaction_code is null or transaction_code ~ '^[A-Z][A-Z0-9]{0,7}$'),
  constraint sec_form4_transactions_acquired_disposed_check
    check (acquired_disposed_code is null or acquired_disposed_code in ('A', 'D')),
  constraint sec_form4_transactions_direct_indirect_check
    check (direct_indirect_code is null or direct_indirect_code in ('D', 'I')),
  constraint sec_form4_transactions_reported_value_basis_check
    check (reported_value_basis in ('p_or_s', 'not_reported')),
  constraint sec_form4_transactions_reported_value_check
    check (
      (reported_value_basis = 'p_or_s'
        and transaction_code in ('P', 'S')
        and reported_transaction_value is not null
        and reported_transaction_value >= 0)
      or
      (reported_value_basis = 'not_reported' and reported_transaction_value is null)
    ),
  constraint sec_form4_transactions_footnotes_array_check
    check (jsonb_typeof(footnotes) = 'array')
);

create index if not exists idx_sec_form4_transactions_event_date
  on public.sec_form4_transactions (filing_event_id, transaction_date desc, id);

create table if not exists public.sec_form4_event_summaries (
  filing_event_id uuid primary key references public.sec_filing_events(id) on delete cascade,
  reporting_owner_count integer not null default 0,
  transaction_count integer not null default 0,
  reported_purchase_count integer not null default 0,
  reported_sale_count integer not null default 0,
  reported_purchase_shares numeric(28, 8),
  reported_sale_shares numeric(28, 8),
  reported_purchase_value numeric(28, 2),
  reported_sale_value numeric(28, 2),
  net_reported_shares numeric(28, 8),
  tenb5_one_status text not null default 'unknown',
  has_reported_open_market_trade boolean not null default false,
  source_xml_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sec_form4_event_summaries_counts_check
    check (
      reporting_owner_count >= 0
      and transaction_count >= 0
      and reported_purchase_count >= 0
      and reported_sale_count >= 0
    ),
  constraint sec_form4_event_summaries_10b5_one_check
    check (tenb5_one_status in ('yes', 'no', 'unknown')),
  constraint sec_form4_event_summaries_source_xml_version_length
    check (source_xml_version is null or char_length(source_xml_version) <= 80)
);

drop trigger if exists trg_sec_form4_reporting_owners_updated_at on public.sec_form4_reporting_owners;
create trigger trg_sec_form4_reporting_owners_updated_at
  before update on public.sec_form4_reporting_owners
  for each row execute function public.set_updated_at();

drop trigger if exists trg_sec_form4_transactions_updated_at on public.sec_form4_transactions;
create trigger trg_sec_form4_transactions_updated_at
  before update on public.sec_form4_transactions
  for each row execute function public.set_updated_at();

drop trigger if exists trg_sec_form4_event_summaries_updated_at on public.sec_form4_event_summaries;
create trigger trg_sec_form4_event_summaries_updated_at
  before update on public.sec_form4_event_summaries
  for each row execute function public.set_updated_at();

-- The enrichment worker has already normalized and validated SEC metadata.
-- This function still checks the job lease and commits document rows, Form 4
-- facts, event readiness, and fanout enqueue as one transaction.
create or replace function public.complete_sec_filing_enrichment(
  p_job_id uuid,
  p_claim_token uuid,
  p_sec_items text[],
  p_event_tags text[],
  p_primary_event_tag text,
  p_classification_source text,
  p_alert_priority text,
  p_documents jsonb,
  p_form4_owners jsonb,
  p_form4_transactions jsonb,
  p_form4_summary jsonb,
  p_parser_version integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.sec_filing_processing_jobs%rowtype;
  v_event public.sec_filing_events%rowtype;
  v_form4 boolean;
  v_lane smallint;
  v_priority_rank smallint;
begin
  select job.* into v_job
  from public.sec_filing_processing_jobs job
  where job.id = p_job_id
    and job.stage = 'enrich'
    and job.status = 'claimed'
    and job.claim_token = p_claim_token
    and job.lease_expires_at > now()
  for update;
  if not found then
    return false;
  end if;

  select event.* into v_event
  from public.sec_filing_events event
  where event.id = v_job.filing_event_id
  for update;
  if not found then
    raise exception 'filing event for job % does not exist', p_job_id;
  end if;

  if p_classification_source not in ('sec_items', 'metadata', 'unclassified') then
    raise exception 'invalid filing classification source';
  end if;
  if p_alert_priority not in ('urgent', 'normal', 'digest') then
    raise exception 'invalid filing alert priority';
  end if;
  if coalesce(p_parser_version, 0) < 1 then
    raise exception 'invalid parser version';
  end if;
  if jsonb_typeof(coalesce(p_documents, '[]'::jsonb)) <> 'array' then
    raise exception 'p_documents must be an array';
  end if;

  insert into public.sec_filing_documents (
    filing_event_id,
    sequence,
    document_name,
    document_type,
    description,
    document_url,
    size_bytes,
    is_primary,
    recommendation_score
  )
  select
    v_event.id,
    row.sequence,
    row.document_name,
    nullif(row.document_type, ''),
    nullif(row.description, ''),
    row.document_url,
    row.size_bytes,
    coalesce(row.is_primary, false),
    greatest(0, least(coalesce(row.recommendation_score, 0), 100))
  from jsonb_to_recordset(coalesce(p_documents, '[]'::jsonb)) as row(
    sequence integer,
    document_name text,
    document_type text,
    description text,
    document_url text,
    size_bytes bigint,
    is_primary boolean,
    recommendation_score integer
  )
  where row.document_name is not null
    and char_length(trim(row.document_name)) between 1 and 512
    and row.document_url ~ '^https://www\\.sec\\.gov/'
  on conflict (filing_event_id, document_name) do update
  set sequence = excluded.sequence,
      document_type = excluded.document_type,
      description = excluded.description,
      document_url = excluded.document_url,
      size_bytes = excluded.size_bytes,
      is_primary = excluded.is_primary,
      recommendation_score = excluded.recommendation_score,
      updated_at = now();

  v_form4 := v_event.form_type in ('4', '4/A');
  if v_form4 then
    if jsonb_typeof(coalesce(p_form4_owners, '[]'::jsonb)) <> 'array'
      or jsonb_typeof(coalesce(p_form4_transactions, '[]'::jsonb)) <> 'array'
      or jsonb_typeof(coalesce(p_form4_summary, '{}'::jsonb)) <> 'object' then
      raise exception 'Form 4 enrichment requires owners, transactions, and summary';
    end if;

    delete from public.sec_form4_reporting_owners
    where filing_event_id = v_event.id;

    insert into public.sec_form4_reporting_owners (
      filing_event_id,
      reporting_owner_index,
      owner_cik,
      owner_name,
      is_director,
      is_officer,
      is_ten_percent_owner,
      is_other,
      officer_title
    )
    select
      v_event.id,
      owner.reporting_owner_index,
      nullif(owner.owner_cik, ''),
      owner.owner_name,
      coalesce(owner.is_director, false),
      coalesce(owner.is_officer, false),
      coalesce(owner.is_ten_percent_owner, false),
      coalesce(owner.is_other, false),
      nullif(owner.officer_title, '')
    from jsonb_to_recordset(coalesce(p_form4_owners, '[]'::jsonb)) as owner(
      reporting_owner_index integer,
      owner_cik text,
      owner_name text,
      is_director boolean,
      is_officer boolean,
      is_ten_percent_owner boolean,
      is_other boolean,
      officer_title text
    )
    where owner.reporting_owner_index >= 0
      and owner.owner_name is not null
      and char_length(trim(owner.owner_name)) between 1 and 500;

    insert into public.sec_form4_transactions (
      filing_event_id,
      reporting_owner_index,
      transaction_index,
      security_kind,
      security_title,
      transaction_date,
      transaction_code,
      equity_swap_involved,
      transaction_shares,
      transaction_price_per_share,
      acquired_disposed_code,
      shares_owned_following,
      direct_indirect_code,
      nature_of_ownership,
      reported_transaction_value,
      reported_value_basis,
      footnotes
    )
    select
      v_event.id,
      tx.reporting_owner_index,
      tx.transaction_index,
      tx.security_kind,
      tx.security_title,
      tx.transaction_date,
      nullif(tx.transaction_code, ''),
      tx.equity_swap_involved,
      tx.transaction_shares,
      tx.transaction_price_per_share,
      nullif(tx.acquired_disposed_code, ''),
      tx.shares_owned_following,
      nullif(tx.direct_indirect_code, ''),
      nullif(tx.nature_of_ownership, ''),
      case
        when tx.transaction_code in ('P', 'S')
          and tx.transaction_shares is not null
          and tx.transaction_price_per_share is not null
          and tx.transaction_shares >= 0
          and tx.transaction_price_per_share >= 0
          then round(tx.transaction_shares * tx.transaction_price_per_share, 2)
        else null
      end,
      case
        when tx.transaction_code in ('P', 'S')
          and tx.transaction_shares is not null
          and tx.transaction_price_per_share is not null
          and tx.transaction_shares >= 0
          and tx.transaction_price_per_share >= 0
          then 'p_or_s'
        else 'not_reported'
      end,
      coalesce(tx.footnotes, '[]'::jsonb)
    from jsonb_to_recordset(coalesce(p_form4_transactions, '[]'::jsonb)) as tx(
      reporting_owner_index integer,
      transaction_index integer,
      security_kind text,
      security_title text,
      transaction_date date,
      transaction_code text,
      equity_swap_involved boolean,
      transaction_shares numeric,
      transaction_price_per_share numeric,
      acquired_disposed_code text,
      shares_owned_following numeric,
      direct_indirect_code text,
      nature_of_ownership text,
      footnotes jsonb
    )
    where tx.reporting_owner_index >= 0
      and tx.transaction_index >= 0
      and tx.security_kind in ('non_derivative', 'derivative')
      and tx.security_title is not null
      and char_length(trim(tx.security_title)) between 1 and 1000
      and jsonb_typeof(coalesce(tx.footnotes, '[]'::jsonb)) = 'array';

    insert into public.sec_form4_event_summaries as summary (
      filing_event_id,
      reporting_owner_count,
      transaction_count,
      reported_purchase_count,
      reported_sale_count,
      reported_purchase_shares,
      reported_sale_shares,
      reported_purchase_value,
      reported_sale_value,
      net_reported_shares,
      tenb5_one_status,
      has_reported_open_market_trade,
      source_xml_version
    )
    select
      v_event.id,
      (select count(*)::integer from public.sec_form4_reporting_owners owner where owner.filing_event_id = v_event.id),
      count(tx.id)::integer,
      (count(tx.id) filter (where tx.transaction_code = 'P' and tx.reported_value_basis = 'p_or_s'))::integer,
      (count(tx.id) filter (where tx.transaction_code = 'S' and tx.reported_value_basis = 'p_or_s'))::integer,
      sum(tx.transaction_shares) filter (where tx.transaction_code = 'P' and tx.reported_value_basis = 'p_or_s'),
      sum(tx.transaction_shares) filter (where tx.transaction_code = 'S' and tx.reported_value_basis = 'p_or_s'),
      sum(tx.reported_transaction_value) filter (where tx.transaction_code = 'P' and tx.reported_value_basis = 'p_or_s'),
      sum(tx.reported_transaction_value) filter (where tx.transaction_code = 'S' and tx.reported_value_basis = 'p_or_s'),
      sum(case
        when tx.transaction_code = 'P' and tx.reported_value_basis = 'p_or_s' then tx.transaction_shares
        when tx.transaction_code = 'S' and tx.reported_value_basis = 'p_or_s' then -tx.transaction_shares
        else null
      end),
      case
        when p_form4_summary->>'tenb5_one_status' in ('yes', 'no', 'unknown')
          then p_form4_summary->>'tenb5_one_status'
        else 'unknown'
      end,
      count(tx.id) filter (where tx.reported_value_basis = 'p_or_s') > 0,
      nullif(p_form4_summary->>'source_xml_version', '')
    from public.sec_form4_transactions tx
    where tx.filing_event_id = v_event.id
    on conflict (filing_event_id) do update
    set reporting_owner_count = excluded.reporting_owner_count,
        transaction_count = excluded.transaction_count,
        reported_purchase_count = excluded.reported_purchase_count,
        reported_sale_count = excluded.reported_sale_count,
        reported_purchase_shares = excluded.reported_purchase_shares,
        reported_sale_shares = excluded.reported_sale_shares,
        reported_purchase_value = excluded.reported_purchase_value,
        reported_sale_value = excluded.reported_sale_value,
        net_reported_shares = excluded.net_reported_shares,
        tenb5_one_status = excluded.tenb5_one_status,
        has_reported_open_market_trade = excluded.has_reported_open_market_trade,
        source_xml_version = excluded.source_xml_version,
        updated_at = now();
  elsif coalesce(p_form4_owners, '[]'::jsonb) <> '[]'::jsonb
    or coalesce(p_form4_transactions, '[]'::jsonb) <> '[]'::jsonb then
    raise exception 'non-Form 4 filing cannot contain Form 4 facts';
  end if;

  v_lane := case
    when p_alert_priority = 'urgent' then 0
    when p_alert_priority = 'normal' then 1
    when v_form4 then 2
    else 3
  end;
  v_priority_rank := case
    when p_alert_priority = 'urgent' then 0
    when p_alert_priority = 'normal' then 1
    when v_form4 then 2
    else 3
  end;

  update public.sec_filing_events event
  set sec_items = coalesce(p_sec_items, '{}'::text[]),
      event_tags = coalesce(p_event_tags, '{}'::text[]),
      primary_event_tag = nullif(trim(coalesce(p_primary_event_tag, '')), ''),
      classification_source = p_classification_source,
      classification_version = greatest(event.classification_version, p_parser_version),
      alert_priority = p_alert_priority,
      enrichment_status = 'ready',
      processing_status = 'ready',
      processing_error = null,
      feed_eligible = true,
      feed_available_at = coalesce(event.feed_available_at, now()),
      feed_expires_at = coalesce(event.feed_expires_at, now() + interval '90 days'),
      feed_lane = v_lane,
      feed_priority_rank = v_priority_rank,
      occurred_at = coalesce(event.accepted_at, event.filing_date::timestamptz, event.first_seen_at),
      parser_version = greatest(event.parser_version, p_parser_version),
      updated_at = now()
  where event.id = v_event.id;

  insert into public.sec_filing_processing_jobs as job (
    env,
    filing_event_id,
    stage,
    status,
    priority,
    next_attempt_at
  )
  values (
    v_job.env,
    v_event.id,
    'notification_fanout',
    'queued',
    case when p_alert_priority = 'urgent' then 95 when p_alert_priority = 'normal' then 75 else 50 end,
    now()
  )
  on conflict (env, filing_event_id, stage) do nothing;

  update public.sec_filing_processing_jobs job
  set status = 'completed',
      completed_at = now(),
      worker_id = null,
      claim_token = null,
      lease_expires_at = null,
      last_error = null,
      updated_at = now()
  where job.id = v_job.id
    and job.claim_token = p_claim_token;

  return found;
end;
$$;

create or replace function public.fail_sec_filing_processing_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_error text,
  p_retry_after_seconds integer default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.sec_filing_processing_jobs%rowtype;
  v_error text := left(trim(coalesce(p_error, 'SEC filing processing failed')), 2000);
  v_retry_seconds integer := greatest(30, least(coalesce(p_retry_after_seconds, 120), 3600));
begin
  select job.* into v_job
  from public.sec_filing_processing_jobs job
  where job.id = p_job_id
    and job.status = 'claimed'
    and job.claim_token = p_claim_token
  for update;
  if not found then
    return false;
  end if;

  update public.sec_filing_processing_jobs job
  set status = case when job.attempts >= job.max_attempts then 'failed' else 'retry' end,
      next_attempt_at = now() + make_interval(secs => greatest(
        v_retry_seconds,
        least(3600, 30 * power(2, least(job.attempts, 6))::integer)
      )),
      worker_id = null,
      claim_token = null,
      lease_expires_at = null,
      last_error = v_error,
      updated_at = now()
  where job.id = v_job.id;

  update public.sec_filing_events event
  set processing_status = case
        when v_job.stage = 'enrich' and v_job.attempts >= v_job.max_attempts then 'failed'
        else event.processing_status
      end,
      processing_error = case
        when v_job.stage = 'enrich' and v_job.attempts >= v_job.max_attempts then v_error
        else event.processing_error
      end,
      enrichment_status = case
        when v_job.stage = 'enrich' and v_job.attempts >= v_job.max_attempts then 'failed'
        else event.enrichment_status
      end,
      updated_at = now()
  where event.id = v_job.filing_event_id;

  return true;
end;
$$;

alter table public.sec_form4_reporting_owners enable row level security;
alter table public.sec_form4_transactions enable row level security;
alter table public.sec_form4_event_summaries enable row level security;

revoke all on table public.sec_form4_reporting_owners from public, anon, authenticated;
revoke all on table public.sec_form4_transactions from public, anon, authenticated;
revoke all on table public.sec_form4_event_summaries from public, anon, authenticated;

grant select, insert, update, delete on table public.sec_form4_reporting_owners to service_role;
grant select, insert, update, delete on table public.sec_form4_transactions to service_role;
grant select, insert, update, delete on table public.sec_form4_event_summaries to service_role;

revoke all on function public.complete_sec_filing_enrichment(uuid, uuid, text[], text[], text, text, text, jsonb, jsonb, jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public.fail_sec_filing_processing_job(uuid, uuid, text, integer) from public, anon, authenticated;

grant execute on function public.complete_sec_filing_enrichment(uuid, uuid, text[], text[], text, text, text, jsonb, jsonb, jsonb, jsonb, integer) to service_role;
grant execute on function public.fail_sec_filing_processing_job(uuid, uuid, text, integer) to service_role;
