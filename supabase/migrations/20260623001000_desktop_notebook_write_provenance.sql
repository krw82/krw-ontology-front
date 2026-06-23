alter table public.user_research_notes
  add column if not exists client_operation_id text,
  add column if not exists source_origin text not null default 'web',
  add column if not exists source_device_id text,
  add column if not exists source_local_session_id text,
  add column if not exists source_local_run_id text,
  add column if not exists source_local_message_id text;

alter table public.user_research_notes
  drop constraint if exists user_research_notes_source_origin_check;

alter table public.user_research_notes
  add constraint user_research_notes_source_origin_check
    check (source_origin in ('web', 'desktop'));

alter table public.user_research_notes
  drop constraint if exists user_research_notes_client_operation_id_length;

alter table public.user_research_notes
  add constraint user_research_notes_client_operation_id_length
    check (
      client_operation_id is null
      or char_length(client_operation_id) between 8 and 200
    );

create unique index if not exists idx_user_research_notes_user_client_operation
  on public.user_research_notes (user_id, client_operation_id)
  where client_operation_id is not null;
