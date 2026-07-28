-- Company editorial content has one canonical home (the company page) and
-- optional Pulse distributions.  Keep the existing pulse-editorial bucket and
-- standalone entry records compatible while adding a durable series layer.

create table if not exists public.pulse_editorial_series (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  slug text not null,
  status text not null default 'draft',
  title text not null,
  summary text not null default '',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pulse_editorial_series_ticker_format check (ticker ~ '^[A-Z0-9.]{1,12}$'),
  constraint pulse_editorial_series_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint pulse_editorial_series_status check (status in ('draft', 'published', 'archived')),
  constraint pulse_editorial_series_title_length check (char_length(title) between 1 and 160),
  constraint pulse_editorial_series_summary_length check (char_length(summary) <= 2_000),
  unique (ticker, slug)
);

alter table public.pulse_editorial_entries
  add column if not exists series_id uuid references public.pulse_editorial_series(id) on delete restrict,
  add column if not exists episode_number smallint,
  add column if not exists company_visible boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pulse_editorial_entries_episode_number'
  ) then
    alter table public.pulse_editorial_entries
      add constraint pulse_editorial_entries_episode_number
      check (episode_number is null or episode_number between 1 and 999);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'pulse_editorial_entries_series_episode_required'
  ) then
    alter table public.pulse_editorial_entries
      add constraint pulse_editorial_entries_series_episode_required
      check (series_id is null or episode_number is not null);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'pulse_editorial_entries_company_visible_series'
  ) then
    alter table public.pulse_editorial_entries
      add constraint pulse_editorial_entries_company_visible_series
      check (not company_visible or series_id is not null);
  end if;
end;
$$;

create unique index if not exists idx_pulse_editorial_entries_series_episode
  on public.pulse_editorial_entries (series_id, episode_number)
  where series_id is not null;

create index if not exists idx_pulse_editorial_entries_company_visible
  on public.pulse_editorial_entries (series_id, episode_number, publish_at desc)
  where status = 'published' and company_visible = true;

create table if not exists public.pulse_editorial_distributions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.pulse_editorial_entries(id) on delete cascade,
  channel text not null default 'pulse',
  status text not null default 'draft',
  placement text not null default 'standard',
  priority smallint not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pulse_editorial_distributions_channel check (channel in ('pulse')),
  constraint pulse_editorial_distributions_status check (status in ('draft', 'active', 'paused', 'archived')),
  constraint pulse_editorial_distributions_placement check (placement in ('early', 'standard')),
  constraint pulse_editorial_distributions_priority check (priority between -100 and 100),
  constraint pulse_editorial_distributions_active_start check (status <> 'active' or starts_at is not null),
  constraint pulse_editorial_distributions_window check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create index if not exists idx_pulse_editorial_distributions_active_window
  on public.pulse_editorial_distributions (starts_at, ends_at, priority desc, created_at desc)
  where status = 'active' and channel = 'pulse';

-- Continue accepting legacy storage paths, but make new assets immutable by
-- addressable series/episode/asset IDs rather than mutable ticker or title.
alter table public.pulse_editorial_assets
  drop constraint if exists pulse_editorial_assets_path_format;

alter table public.pulse_editorial_assets
  add constraint pulse_editorial_assets_path_format
  check (
    storage_path ~ '^editorial/[0-9a-f-]{36}/[0-9]{2}-[a-z0-9][a-z0-9._-]{0,120}$'
    or storage_path ~ '^series/[0-9a-f-]{36}/episodes/[0-9a-f-]{36}/slides/[0-9]{2}-[0-9a-f-]{36}\.(?:jpg|jpeg|png|webp)$'
  );

drop trigger if exists trg_pulse_editorial_series_updated_at on public.pulse_editorial_series;
create trigger trg_pulse_editorial_series_updated_at
  before update on public.pulse_editorial_series
  for each row execute function public.set_updated_at();

drop trigger if exists trg_pulse_editorial_distributions_updated_at on public.pulse_editorial_distributions;
create trigger trg_pulse_editorial_distributions_updated_at
  before update on public.pulse_editorial_distributions
  for each row execute function public.set_updated_at();

drop trigger if exists trg_pulse_global_feed_revision_editorial_series on public.pulse_editorial_series;
create trigger trg_pulse_global_feed_revision_editorial_series
  after insert or update or delete on public.pulse_editorial_series
  for each row execute function public.pulse_global_feed_revision_from_shared_row();

drop trigger if exists trg_pulse_global_feed_revision_editorial_distributions on public.pulse_editorial_distributions;
create trigger trg_pulse_global_feed_revision_editorial_distributions
  after insert or update or delete on public.pulse_editorial_distributions
  for each row execute function public.pulse_global_feed_revision_from_shared_row();

alter table public.pulse_editorial_series enable row level security;
alter table public.pulse_editorial_distributions enable row level security;

revoke all on table public.pulse_editorial_series from public, anon, authenticated;
revoke all on table public.pulse_editorial_distributions from public, anon, authenticated;
grant select, insert, update, delete on table public.pulse_editorial_series to service_role;
grant select, insert, update, delete on table public.pulse_editorial_distributions to service_role;

notify pgrst, 'reload schema';
