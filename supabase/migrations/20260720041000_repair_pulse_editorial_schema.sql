-- The production migration ledger can contain the original editorial
-- migration even when a historical interrupted deployment never created the
-- underlying tables. Reapply the complete, idempotent schema here rather than
-- allowing Pulse V3 or the editorial API to depend on a false ledger entry.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pulse-editorial',
  'pulse-editorial',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.pulse_editorial_entries (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  status text not null default 'draft',
  format text not null default 'single_image',
  title text not null,
  body text not null default '',
  ticker text,
  action_label text,
  action_href text,
  publish_at timestamptz,
  expires_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pulse_editorial_entries_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint pulse_editorial_entries_status check (status in ('draft', 'published', 'archived')),
  constraint pulse_editorial_entries_format check (format in ('single_image', 'carousel', 'text')),
  constraint pulse_editorial_entries_title_length check (char_length(title) between 1 and 160),
  constraint pulse_editorial_entries_body_length check (char_length(body) <= 2000),
  constraint pulse_editorial_entries_ticker_format check (ticker is null or ticker ~ '^[A-Z0-9.]{1,12}$'),
  constraint pulse_editorial_entries_action_label_length check (action_label is null or char_length(action_label) between 1 and 80),
  constraint pulse_editorial_entries_action_href_length check (action_href is null or char_length(action_href) between 1 and 2000),
  constraint pulse_editorial_entries_publish_window check (expires_at is null or publish_at is null or expires_at > publish_at)
);

create table if not exists public.pulse_editorial_assets (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.pulse_editorial_entries(id) on delete cascade,
  position smallint not null,
  storage_path text not null unique,
  alt_text text not null,
  mime_type text not null,
  byte_size integer not null,
  width integer,
  height integer,
  created_at timestamptz not null default now(),
  constraint pulse_editorial_assets_position check (position between 0 and 31),
  constraint pulse_editorial_assets_path_format check (storage_path ~ '^editorial/[0-9a-f-]{36}/[0-9]{2}-[a-z0-9][a-z0-9._-]{0,120}$'),
  constraint pulse_editorial_assets_alt_length check (char_length(alt_text) between 1 and 240),
  constraint pulse_editorial_assets_mime check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint pulse_editorial_assets_byte_size check (byte_size > 0 and byte_size <= 8388608),
  constraint pulse_editorial_assets_dimensions check ((width is null and height is null) or (width > 0 and height > 0)),
  unique (entry_id, position)
);

create index if not exists idx_pulse_editorial_entries_published
  on public.pulse_editorial_entries (publish_at desc, created_at desc)
  where status = 'published';

create index if not exists idx_pulse_editorial_assets_entry_position
  on public.pulse_editorial_assets (entry_id, position);

drop trigger if exists trg_pulse_editorial_entries_updated_at on public.pulse_editorial_entries;
create trigger trg_pulse_editorial_entries_updated_at
  before update on public.pulse_editorial_entries
  for each row execute function public.set_updated_at();

drop trigger if exists trg_pulse_global_feed_revision_editorial_entries on public.pulse_editorial_entries;
create trigger trg_pulse_global_feed_revision_editorial_entries
  after insert or update or delete on public.pulse_editorial_entries
  for each row execute function public.pulse_global_feed_revision_from_shared_row();

drop trigger if exists trg_pulse_global_feed_revision_editorial_assets on public.pulse_editorial_assets;
create trigger trg_pulse_global_feed_revision_editorial_assets
  after insert or update or delete on public.pulse_editorial_assets
  for each row execute function public.pulse_global_feed_revision_from_shared_row();

alter table public.pulse_editorial_entries enable row level security;
alter table public.pulse_editorial_assets enable row level security;

revoke all on table public.pulse_editorial_entries from public, anon, authenticated;
revoke all on table public.pulse_editorial_assets from public, anon, authenticated;
grant select, insert, update, delete on table public.pulse_editorial_entries to service_role;
grant select, insert, update, delete on table public.pulse_editorial_assets to service_role;

notify pgrst, 'reload schema';
