-- Keep infrastructure failures distinct from a completed research answer.
--
-- The private agent_v1 ABI already stores a bounded reason_code in
-- agent_store.runs.  The existing product projection intentionally renders a
-- generic failed message, but it did not retain a product-safe classification
-- for the UI or for retry analytics.  This trigger reads only the closed
-- reason vocabulary and writes a small public metadata marker; it never
-- copies provider text, prompts, tool arguments, or private identifiers.

create or replace function public.project_agent_v1_failure_notice()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, agent_store
as $$
declare
  v_run public.agent_runs%rowtype;
  v_reason text;
  v_failure_class text := 'research_failed';
  v_message text := '리서치 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
begin
  if new.event_type <> 'error'
     or new.payload->>'error_code' <> 'agent_v1_failed'
     or new.payload->>'run_id' is null then
    return new;
  end if;

  select *
    into v_run
    from public.agent_runs as run
   where run.id = (new.payload->>'run_id')::uuid;
  if not found or v_run.assistant_message_id is null then
    return new;
  end if;

  select nullif(left(terminal_outcome->>'reason_code', 64), '')
    into v_reason
    from agent_store.runs
   where run_id = v_run.id::text;

  if v_reason in ('dependency_unavailable', 'dependency_contract_failure')
     or v_reason like 'provider_%'
     or v_reason like 'glm_%'
     or v_reason like 'deepseek_%' then
    v_failure_class := 'dependency_unavailable';
    v_message := '리서치 엔진 연결이 일시적으로 불안정합니다. 잠시 후 다시 시도해주세요.';
  elsif v_reason like 'engine_input_%'
     or v_reason in (
       'unknown_agent_image_hash',
       'execution_plan_not_loaded',
       'capability_binding_missing',
       'capability_release_pin_missing',
       'capability_release_pin_mismatch',
       'immutable_scope_failure'
     ) then
    v_failure_class := 'engine_not_ready';
    v_message := '리서치 엔진이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.';
  end if;

  update public.messages
     set content = v_message,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'kind', 'research_failure',
           'research_completed', false,
           'failure_class', v_failure_class
         )
   where id = v_run.assistant_message_id
     and status = 'failed'::public.message_status;

  return new;
exception
  when others then
    -- Failure projection must never turn a durable run failure into an
    -- outbox retry loop.  The original generic failed message remains valid.
    return new;
end;
$$;

revoke all on function public.project_agent_v1_failure_notice() from public;

drop trigger if exists trg_project_agent_v1_failure_notice on public.agent_run_events;
create trigger trg_project_agent_v1_failure_notice
  after insert on public.agent_run_events
  for each row
  execute function public.project_agent_v1_failure_notice();
