-- Forward compatibility for the current krw-agent host contract.
-- The original product projection migration predates immutable claim v7 and
-- only admitted one provider model. New code calls the provider-neutral v7
-- wrapper below; historical functions remain untouched so the migration is
-- safe on an already-live DB.

do $$
begin
  if to_regprocedure('agent_v1.enqueue_run(jsonb)') is null
     or to_regprocedure('agent_v1.request_cancel(jsonb)') is null
     or to_regprocedure('public.agent_v1_product_assert_exact_object(jsonb,text[],text[],text)') is null then
    raise exception 'agent_v1 v7 compatibility requires the base product projection and agent ABI';
  end if;
end
$$;

alter table public.agent_v1_product_outbox_receipts
  drop constraint if exists agent_v1_product_outbox_receipts_event_kind_check;

alter table public.agent_v1_product_outbox_receipts
  add constraint agent_v1_product_outbox_receipts_event_kind_check
  check (event_kind in (
    'answer.committed', 'answer.presentation', 'answer.billing',
    'answer.notification', 'run.cancelled', 'run.failed', 'run.deferred'
  ));

create or replace function public.enqueue_agent_v1_product_run_v7(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_agent_request jsonb;
  v_product jsonb;
  v_kernel_response jsonb;
  v_existing public.agent_v1_product_run_mappings%rowtype;
  v_run public.agent_runs%rowtype;
  v_user_message public.messages%rowtype;
  v_session_user_id uuid;
  v_run_id uuid;
  v_session_id uuid;
  v_user_message_id uuid;
  v_user_id uuid;
  v_assistant_message_id uuid;
  v_queued_at timestamptz;
  v_model text;
  v_runtime_environment text;
begin
  perform public.agent_v1_product_assert_exact_object(
    p_request,
    array['schema_version', 'descriptor_artifact_hash', 'release_set_hash',
          'agent_request', 'product'],
    array['schema_version', 'descriptor_artifact_hash', 'release_set_hash',
          'agent_request', 'product'],
    'enqueue v7 request'
  );
  if p_request->>'schema_version' is distinct from '1'
     or octet_length(p_request::text) > 1572864 then
    raise exception 'invalid or oversized enqueue v7 request';
  end if;
  perform public.agent_v1_product_assert_hash(p_request->>'descriptor_artifact_hash', 'descriptor_artifact_hash');
  perform public.agent_v1_product_assert_hash(p_request->>'release_set_hash', 'release_set_hash');

  v_agent_request := p_request->'agent_request';
  v_product := p_request->'product';
  perform public.agent_v1_product_assert_exact_object(
    v_product,
    array['run_id', 'user_id', 'session_id', 'user_message_id', 'request_id',
          'run_kind', 'locale', 'web_commit', 'runtime_environment'],
    array['run_id', 'user_id', 'session_id', 'user_message_id', 'request_id',
          'run_kind', 'locale', 'web_commit', 'runtime_environment'],
    'enqueue v7 product'
  );

  if jsonb_typeof(v_agent_request) is distinct from 'object'
     or octet_length(v_agent_request::text) > 1310720
     or v_agent_request->>'abi_version' is distinct from '1'
     or v_agent_request#>>'{immutable_snapshot,schema_version}' is distinct from '7'
     or v_agent_request#>>'{resource_profile,schema_version}' is distinct from '7' then
    raise exception 'unsupported immutable claim v7';
  end if;

  v_run_id := (v_product->>'run_id')::uuid;
  v_user_id := (v_product->>'user_id')::uuid;
  v_session_id := (v_product->>'session_id')::uuid;
  v_user_message_id := (v_product->>'user_message_id')::uuid;
  v_runtime_environment := lower(trim(v_product->>'runtime_environment'));
  v_model := v_agent_request#>>'{immutable_snapshot,request,requested_model}';

  if v_runtime_environment not in ('dev', 'staging', 'prod') then
    raise exception 'runtime_environment must be dev, staging, or prod';
  end if;
  if v_product->>'run_kind' not in (
    'company_research', 'company_research_en', 'earnings_deep_dive',
    'wide_research', 'scenario_sensitivity', 'idea_generation', 'guru_ackman', 'guru_buffett',
    'guru_flatt', 'guru_marks', 'guru_terry_smith'
  ) then
    raise exception 'unsupported v7 run_kind';
  end if;
  if v_model not in ('glm-5.2', 'deepseek-v4-flash') then
    raise exception 'requested model is not an allowed deployment model';
  end if;
  if v_agent_request->>'run_id' is distinct from v_run_id::text
     or v_agent_request->>'session_id' is distinct from v_session_id::text
     or v_agent_request->>'principal_id' is distinct from v_user_id::text
     or v_agent_request#>>'{immutable_snapshot,request,run_id}' is distinct from v_run_id::text
     or v_agent_request#>>'{immutable_snapshot,request,session_id}' is distinct from v_session_id::text
     or v_agent_request#>>'{immutable_snapshot,request,principal_id}' is distinct from v_user_id::text
     or v_agent_request#>>'{immutable_snapshot,request,run_kind}' is distinct from v_product->>'run_kind'
     or v_agent_request#>>'{immutable_snapshot,request,locale}' is distinct from v_product->>'locale' then
    raise exception 'product identity does not match v7 immutable request';
  end if;
  perform public.agent_v1_product_assert_hash(v_agent_request->>'mutation_hash', 'mutation_hash');
  perform public.agent_v1_product_assert_hash(v_agent_request->>'immutable_snapshot_hash', 'immutable_snapshot_hash');
  perform public.agent_v1_product_assert_hash(v_agent_request->>'agent_image_hash', 'agent_image_hash');

  select s.user_id
    into v_session_user_id
    from public.chat_sessions as s
   where s.id = v_session_id
     and s.deleted_at is null
     and s.closed_at is null
   for update;
  if not found or v_session_user_id is distinct from v_user_id then
    raise exception 'session ownership mismatch or closed session';
  end if;

  select m.*
    into v_user_message
    from public.messages as m
   where m.id = v_user_message_id
     and m.session_id = v_session_id
     and m.role = 'user'::public.message_role
   for update;
  if not found then raise exception 'user message ownership mismatch'; end if;

  select mapping.*
    into v_existing
    from public.agent_v1_product_run_mappings as mapping
   where mapping.run_id = v_run_id
      or mapping.request_id = v_product->>'request_id'
   for update;
  if found then
    select r.* into v_run from public.agent_runs as r where r.id = v_existing.run_id for update;
    if v_existing.run_id is distinct from v_run_id
       or v_existing.user_id is distinct from v_user_id
       or v_existing.session_id is distinct from v_session_id
       or v_existing.request_id is distinct from v_product->>'request_id'
       or v_run.executor_type is distinct from 'rust_agent'
       or v_run.user_message_id is distinct from v_user_message_id then
      raise exception 'v7 enqueue identity conflict';
    end if;
    v_kernel_response := agent_v1.enqueue_run(v_agent_request);
    if v_kernel_response->>'run_id' is distinct from v_run_id::text
       or v_kernel_response->>'outcome' not in ('enqueued', 'already_enqueued') then
      raise exception 'invalid v7 enqueue replay response';
    end if;
    return jsonb_build_object(
      'outcome', 'already_enqueued',
      'run_id', v_run_id,
      'assistant_message_id', v_run.assistant_message_id,
      'queued_at', v_run.queued_at,
      'kernel_outcome', v_kernel_response->>'outcome'
    );
  end if;

  v_kernel_response := agent_v1.enqueue_run(v_agent_request);
  if v_kernel_response->>'run_id' is distinct from v_run_id::text
     or v_kernel_response->>'outcome' not in ('enqueued', 'already_enqueued') then
    raise exception 'invalid v7 enqueue response';
  end if;
  v_assistant_message_id := extensions.gen_random_uuid();
  v_queued_at := clock_timestamp();

  insert into public.messages (id, session_id, role, content, status)
  values (v_assistant_message_id, v_session_id, 'assistant'::public.message_role, '', 'pending'::public.message_status);

  insert into public.agent_runs (
    id, session_id, user_message_id, assistant_message_id, request_id, model,
    status, queued_at, web_commit, ontology_env, run_kind, executor_type
  ) values (
    v_run_id, v_session_id, v_user_message_id, v_assistant_message_id,
    v_product->>'request_id', v_model, 'pending'::public.run_status,
    v_queued_at, v_product->>'web_commit', v_runtime_environment,
    v_product->>'run_kind', 'rust_agent'
  ) returning * into v_run;

  insert into public.agent_v1_product_run_mappings (
    run_id, daemon_run_id, tenant_id, user_id, session_id, request_id,
    descriptor_artifact_hash, release_set_hash, enqueue_mutation_id,
    enqueue_mutation_hash, immutable_snapshot_hash, agent_image_hash, runtime_version
  ) values (
    v_run_id, v_run_id::text, v_agent_request->>'tenant_id', v_user_id,
    v_session_id, v_product->>'request_id', p_request->>'descriptor_artifact_hash',
    p_request->>'release_set_hash', v_agent_request->>'mutation_id',
    v_agent_request->>'mutation_hash', v_agent_request->>'immutable_snapshot_hash',
    v_agent_request->>'agent_image_hash', v_agent_request->>'runtime_version'
  );

  perform public.attach_execution_budget_run(v_user_id, v_product->>'request_id', v_run_id);
  perform public.attach_analysis_credit_run(v_user_id, v_product->>'request_id', v_run_id);
  insert into public.agent_run_events (run_id, event_type, payload)
  values
    (v_run_id, 'run_queued', jsonb_build_object(
      'run_id', v_run_id, 'message_id', v_assistant_message_id,
      'session_id', v_session_id, 'request_id', v_product->>'request_id',
      'queued_at', v_queued_at, 'run_kind', v_product->>'run_kind',
      'response_locale', v_product->>'locale', 'executor_type', 'rust_agent'
    )),
    (v_run_id, 'activity_update', jsonb_build_object('stage', 'queued', 'label', '대기열에 추가됨'));

  return jsonb_build_object(
    'outcome', 'enqueued', 'run_id', v_run_id,
    'assistant_message_id', v_assistant_message_id,
    'queued_at', v_queued_at, 'kernel_outcome', v_kernel_response->>'outcome'
  );
end;
$$;

revoke all on function public.enqueue_agent_v1_product_run_v7(jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_agent_v1_product_run_v7(jsonb) to service_role;
