-- Final structured visualization contract for chat messages.
--
-- The model never persists raw filing bodies. Each artifact contains only the
-- rendered numeric snapshot, deterministic visual spec, and evidence anchors.

create table if not exists public.chat_message_visualizations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  artifact_ref text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_chat_message_visualizations_message_ref
  on public.chat_message_visualizations (message_id, artifact_ref);

create index if not exists idx_chat_message_visualizations_session_created
  on public.chat_message_visualizations (session_id, created_at);

create index if not exists idx_chat_message_visualizations_message
  on public.chat_message_visualizations (message_id);

create index if not exists idx_chat_message_visualizations_run
  on public.chat_message_visualizations (run_id);

create table if not exists public.chat_message_presentations (
  message_id uuid primary key references public.messages(id) on delete cascade,
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  blocks_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chat_message_presentations_session
  on public.chat_message_presentations (session_id, created_at);

create index if not exists idx_chat_message_presentations_run
  on public.chat_message_presentations (run_id);

drop trigger if exists trg_chat_message_presentations_updated_at
  on public.chat_message_presentations;
create trigger trg_chat_message_presentations_updated_at
  before update on public.chat_message_presentations
  for each row execute function public.set_updated_at();

alter table public.chat_message_visualizations enable row level security;
alter table public.chat_message_presentations enable row level security;

revoke all on table public.chat_message_visualizations from anon, authenticated;
grant select on table public.chat_message_visualizations to authenticated;
grant select, insert, update, delete on table public.chat_message_visualizations to service_role;

revoke all on table public.chat_message_presentations from anon, authenticated;
grant select on table public.chat_message_presentations to authenticated;
grant select, insert, update, delete on table public.chat_message_presentations to service_role;

drop policy if exists "chat_message_visualizations_select_own"
  on public.chat_message_visualizations;
create policy "chat_message_visualizations_select_own"
  on public.chat_message_visualizations
  for select using (public.session_owner(session_id) = auth.uid());

drop policy if exists "chat_message_visualizations_insert_own"
  on public.chat_message_visualizations;
create policy "chat_message_visualizations_insert_own"
  on public.chat_message_visualizations
  for insert with check (public.session_owner(session_id) = auth.uid());

drop policy if exists "chat_message_visualizations_update_own"
  on public.chat_message_visualizations;
create policy "chat_message_visualizations_update_own"
  on public.chat_message_visualizations
  for update using (public.session_owner(session_id) = auth.uid())
  with check (public.session_owner(session_id) = auth.uid());

drop policy if exists "chat_message_presentations_select_own"
  on public.chat_message_presentations;
create policy "chat_message_presentations_select_own"
  on public.chat_message_presentations
  for select using (public.session_owner(session_id) = auth.uid());

drop policy if exists "chat_message_presentations_insert_own"
  on public.chat_message_presentations;
create policy "chat_message_presentations_insert_own"
  on public.chat_message_presentations
  for insert with check (public.session_owner(session_id) = auth.uid());

drop policy if exists "chat_message_presentations_update_own"
  on public.chat_message_presentations;
create policy "chat_message_presentations_update_own"
  on public.chat_message_presentations
  for update using (public.session_owner(session_id) = auth.uid())
  with check (public.session_owner(session_id) = auth.uid());

-- One-time conversion of the former chart-token format. New application code
-- never reads chat_message_charts; the legacy table remains as a short-term
-- audit/rollback record until the post-cutover cleanup migration is approved.
insert into public.chat_message_visualizations (
  session_id,
  message_id,
  run_id,
  artifact_ref,
  payload_json,
  created_at
)
select
  chart.session_id,
  chart.message_id,
  chart.run_id,
  chart.chart_ref,
  jsonb_build_object(
    'artifact_format', 'krw-visualization',
    'schema_version', 1,
    'artifact_ref', chart.chart_ref,
    'intent', jsonb_build_object(
      'goal', chart.title,
      'relationship', case when chart.chart_type = 'line' then 'trend' else 'comparison' end,
      'preferred_form', chart.chart_type
    ),
    'title', chart.title,
    'views', jsonb_build_array(jsonb_build_object(
      'view_id', 'view_1',
      'chart_type', chart.chart_type,
      'title', chart.title,
      'subtitle', chart.payload_json ->> 'subtitle',
      'unit', chart.payload_json ->> 'unit',
      'series', coalesce(chart.payload_json -> 'series', '[]'::jsonb)
    )),
    'provenance', jsonb_build_object(
      'source_tool_call_ids', coalesce(chart.payload_json #> '{source,source_tool_call_ids}', '[]'::jsonb),
      'evidence_refs', coalesce(jsonb_path_query_array(chart.payload_json, '$.series[*].points[*].evidence_ref'), '[]'::jsonb),
      'source_kinds', jsonb_build_array('ontology')
    ),
    'quality', coalesce(chart.payload_json -> 'quality', jsonb_build_object(
      'series_count', 0,
      'point_count', 0,
      'warnings', '[]'::jsonb
    ))
  ),
  chart.created_at
from public.chat_message_charts as chart
on conflict (message_id, artifact_ref) do nothing;

-- The legacy token was an implementation detail, not answer content. Remove it
-- from historical assistant rows after artifacts have been converted so prompt
-- history, previews, exports, and API clients cannot surface it again.
update public.messages
set content = trim(
  regexp_replace(
    regexp_replace(
      content,
      '\[\[krw-chart:[A-Za-z0-9_-]+\]\]',
      '',
      'g'
    ),
    E'\n{3,}',
    E'\n\n',
    'g'
  )
)
where role = 'assistant'
  and content ~ '\[\[krw-chart:[A-Za-z0-9_-]+\]\]';

insert into public.chat_message_presentations (
  message_id,
  session_id,
  run_id,
  blocks_json
)
select
  chart.message_id,
  (array_agg(chart.session_id order by chart.created_at))[1],
  (array_agg(chart.run_id order by chart.created_at))[1],
  jsonb_build_array(jsonb_build_object(
    'id', 'markdown_1',
    'type', 'markdown',
    'content', regexp_replace(
      message.content,
      '[[:space:]]*\\[\\[krw-chart:[A-Za-z0-9_-]+\\]\\][[:space:]]*',
      E'\\n\\n',
      'g'
    )
  )) || jsonb_agg(
    jsonb_build_object(
      'id', 'visualization_' || chart.chart_ref,
      'type', 'visualization',
      'artifact_ref', chart.chart_ref
    )
    order by chart.created_at
  )
from public.chat_message_charts as chart
join public.messages as message on message.id = chart.message_id
group by chart.message_id, message.content
on conflict (message_id) do nothing;
