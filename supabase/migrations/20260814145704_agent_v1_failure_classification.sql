-- Refine product-safe failure classes after the generic terminal projection.
-- The Rust daemon owns the bounded reason_code; this trigger only maps the
-- closed vocabulary to a user-facing class.  It never persists raw provider
-- output, prompts, tool arguments, or database diagnostics.

create or replace function public.reclassify_agent_v1_failure_notice()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, agent_store
as $$
declare
  v_run public.agent_runs%rowtype;
  v_reason text;
  v_failure_class text;
  v_message text;
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

  if v_reason in (
       'engine_output_thinking_budget_exhausted',
       'budget_exhausted'
     ) then
    v_failure_class := 'budget_exhausted';
    v_message := '리서치 답변을 마무리할 예산이 부족했습니다. 다시 시도해주세요.';
  elsif v_reason = 'engine_input_session_memory_delta_invalid' then
    v_failure_class := 'context_recovery_failed';
    v_message := '이 채팅의 이전 맥락을 복원하지 못했습니다. 다시 시도해주세요.';
  elsif v_reason = 'engine_input_compiled_plan_mismatch' then
    v_failure_class := 'research_plan_mismatch';
    v_message := '리서치 계획과 실행 환경이 일치하지 않습니다. 잠시 후 다시 시도해주세요.';
  elsif v_reason in (
       'engine_input_final_output_reservation_invalid',
       'engine_input_provider_context_invalid'
     ) then
    v_failure_class := 'engine_not_ready';
    v_message := '리서치 엔진이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.';
  else
    return new;
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
    -- Classification is an optional projection.  Never turn a durable
    -- terminal failure into an outbox retry loop.
    return new;
end;
$$;

revoke all on function public.reclassify_agent_v1_failure_notice() from public;

drop trigger if exists trg_reclassify_agent_v1_failure_notice on public.agent_run_events;
create trigger trg_reclassify_agent_v1_failure_notice
  after insert on public.agent_run_events
  for each row
  execute function public.reclassify_agent_v1_failure_notice();
