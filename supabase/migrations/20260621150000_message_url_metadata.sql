-- Store lightweight UI metadata for user-supplied URL context.
alter table public.messages
  add column if not exists metadata jsonb not null default '{}'::jsonb;
