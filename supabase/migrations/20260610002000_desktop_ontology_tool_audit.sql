-- Desktop ontology tool-call audit.
-- Desktop is a client, not a privileged worker. Every server-side ontology
-- search executed for Desktop must have a bounded audit row.

create table if not exists public.desktop_ontology_tool_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.desktop_devices(id) on delete set null,
  local_session_id text not null,
  local_run_id text not null,
  tool_call_id text not null,
  tool_name text not null,
  arguments_hash text not null,
  arguments_summary jsonb not null default '{}'::jsonb,
  desktop_context jsonb not null default '{}'::jsonb,
  ontology_release_id text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  result_count integer check (result_count is null or result_count >= 0),
  result_size_bytes integer check (result_size_bytes is null or result_size_bytes >= 0),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed')),
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, local_run_id, tool_call_id)
);

create index if not exists idx_desktop_ontology_tool_calls_user_created
  on public.desktop_ontology_tool_calls (user_id, created_at desc);

create index if not exists idx_desktop_ontology_tool_calls_device_created
  on public.desktop_ontology_tool_calls (device_id, created_at desc);

create index if not exists idx_desktop_ontology_tool_calls_status_created
  on public.desktop_ontology_tool_calls (status, created_at desc);

alter table public.desktop_ontology_tool_calls enable row level security;

revoke all on table public.desktop_ontology_tool_calls from public;
revoke all on table public.desktop_ontology_tool_calls from anon;
revoke all on table public.desktop_ontology_tool_calls from authenticated;
grant select, insert, update, delete on table public.desktop_ontology_tool_calls to service_role;
