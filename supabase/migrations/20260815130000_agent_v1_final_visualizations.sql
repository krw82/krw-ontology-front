-- Deterministic run visualizations reach the public chat read model.
--
-- The agent runtime compiles visualization artifacts from the private
-- presentation channel (MCP `_meta`) and persists them inside the committed
-- answer bundle.  Project them into `chat_message_visualizations` in the same
-- transaction that writes the assistant message, so replays stay idempotent
-- (unique (message_id, artifact_ref)) and chart rows can never diverge from
-- the answer they belong to.

create or replace function agent_v1.read_final_projection(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, agent_store
as $$
declare
  v_run agent_store.runs%rowtype;
  v_bundle agent_store.answer_bundles%rowtype;
  v_markdown text;
  v_visualizations jsonb;
begin
  perform agent_store.assert_request(
    p_request,
    array['abi_version', 'run_id', 'tenant_id', 'principal_id', 'session_id'],
    array['abi_version', 'run_id', 'tenant_id', 'principal_id', 'session_id']
  );
  select * into v_run from agent_store.runs where run_id = p_request->>'run_id';
  if not found then
    raise exception using errcode = 'K1001', message = 'unknown_run';
  end if;
  if v_run.tenant_id is distinct from p_request->>'tenant_id'
     or v_run.principal_id is distinct from p_request->>'principal_id'
     or v_run.session_id is distinct from p_request->>'session_id' then
    raise exception using errcode = 'K1017', message = 'ownership_mismatch';
  end if;
  if v_run.state <> 'final' then
    raise exception using errcode = 'K1003', message = 'run_not_final';
  end if;
  select * into v_bundle from agent_store.answer_bundles where run_id = v_run.run_id;
  if not found then
    raise exception using errcode = 'K1001', message = 'final_projection_missing';
  end if;
  v_markdown := coalesce(
    v_bundle.answer_bundle->>'rendered_content',
    v_bundle.answer_bundle->>'rendered_markdown'
  );
  if v_markdown is null or v_markdown = '' then
    raise exception using errcode = 'K1000', message = 'final_markdown_missing';
  end if;
  v_visualizations := coalesce(v_bundle.answer_bundle->'visualizations', '[]'::jsonb);
  if jsonb_typeof(v_visualizations) <> 'array'
     or jsonb_array_length(v_visualizations) > 16
     or exists (select 1 from jsonb_array_elements(v_visualizations) element
                where jsonb_typeof(element) <> 'object') then
    raise exception using errcode = 'K1000', message = 'final_visualizations_invalid';
  end if;
  return jsonb_build_object(
    'run_id', v_run.run_id,
    'answer_bundle_hash', v_bundle.answer_bundle_hash,
    'markdown', v_markdown,
    'visualizations', v_visualizations,
    'usage', v_bundle.usage
  );
end;
$$;

revoke all on function agent_v1.read_final_projection(jsonb) from public;

create or replace function public.apply_agent_v1_product_outbox(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event jsonb;
  v_payload jsonb;
  v_mapping public.agent_v1_product_run_mappings%rowtype;
  v_run public.agent_runs%rowtype;
  v_receipt public.agent_v1_product_outbox_receipts%rowtype;
  v_projection jsonb;
  v_run_id uuid;
  v_outbox_id bigint;
  v_event_kind text;
  v_dedupe_key text;
  v_event_hash text;
  v_authoritative_state text;
  v_message text;
  v_finished_at timestamptz := clock_timestamp();
  v_usage jsonb := '{}'::jsonb;
  v_input_tokens integer := 0;
  v_output_tokens integer := 0;
  v_cache_hit_tokens integer := 0;
  v_cache_miss_tokens integer := 0;
  v_settled_credits bigint := 0;
  v_reserved_credits bigint := 0;
  v_actual_cost numeric := 0;
  v_reserved_cost numeric := 0;
  v_provider text;
  v_provider_model_version text;
  v_pricing_version text;
  v_price record;
  v_artifact jsonb;
  v_artifact_ref text;
begin
  perform public.agent_v1_product_assert_exact_object(
    p_request,
    array['schema_version', 'event_hash', 'event'],
    array['schema_version', 'event_hash', 'event'],
    'product outbox request'
  );
  if p_request->>'schema_version' is distinct from '1'
     or octet_length(p_request::text) > 1572864 then
    raise exception 'invalid or oversized product outbox request';
  end if;
  perform public.agent_v1_product_assert_hash(p_request->>'event_hash', 'event_hash');

  v_event := p_request->'event';
  perform public.agent_v1_product_assert_exact_object(
    v_event,
    array['outbox_id', 'run_id', 'event_kind', 'dedupe_key', 'payload',
          'delivery_attempts', 'delivery_deadline'],
    array['outbox_id', 'run_id', 'event_kind', 'dedupe_key', 'payload',
          'delivery_attempts', 'delivery_deadline'],
    'product outbox event'
  );
  v_outbox_id := (v_event->>'outbox_id')::bigint;
  if v_outbox_id < 1 then raise exception 'invalid outbox_id'; end if;
  v_run_id := (v_event->>'run_id')::uuid;
  v_event_kind := v_event->>'event_kind';
  v_dedupe_key := v_event->>'dedupe_key';
  v_event_hash := p_request->>'event_hash';
  v_payload := v_event->'payload';

  if v_event_kind not in (
    'answer.committed', 'answer.presentation', 'answer.billing',
    'answer.notification', 'run.cancelled', 'run.failed', 'run.deferred'
  ) then
    raise exception 'unsupported product outbox event';
  end if;
  if char_length(v_dedupe_key) not between 1 and 256 then
    raise exception 'invalid product outbox dedupe key';
  end if;
  if jsonb_typeof(v_payload) is distinct from 'object' then
    raise exception 'product outbox payload must be an object';
  end if;

  select * into v_mapping
    from public.agent_v1_product_run_mappings as mapping
   where mapping.run_id = v_run_id
   for update;
  if not found then raise exception 'product outbox mapping missing'; end if;

  select * into v_run
    from public.agent_runs as run
   where run.id = v_run_id
   for update;

  select * into v_receipt
    from public.agent_v1_product_outbox_receipts as receipt
   where receipt.dedupe_key = v_dedupe_key
   for update;
  if found then
    if v_receipt.outbox_id <> v_outbox_id
       or v_receipt.run_id <> v_run_id
       or v_receipt.event_kind <> v_event_kind
       or v_receipt.event_hash <> v_event_hash then
      raise exception 'product outbox receipt identity conflict';
    end if;
    return jsonb_build_object(
      'outcome', 'already_applied',
      'run_id', v_run_id,
      'dedupe_key', v_dedupe_key
    );
  end if;

  if v_event_kind = 'answer.committed' then
    perform public.agent_v1_product_assert_exact_object(
      v_payload,
      array['run_id', 'answer_bundle_hash', 'rendered_message_hash',
            'memory_revision', 'memory_frontier_hash', 'memory_source_lineage_hash'],
      array['run_id', 'answer_bundle_hash', 'rendered_message_hash'],
      'answer.committed payload'
    );
    perform public.agent_v1_product_assert_hash(v_payload->>'answer_bundle_hash', 'answer_bundle_hash');
    perform public.agent_v1_product_assert_hash(v_payload->>'rendered_message_hash', 'rendered_message_hash');
    if v_payload->>'run_id' is distinct from v_run_id::text then
      raise exception 'answer.committed run identity mismatch';
    end if;

    v_projection := agent_v1.read_final_projection(jsonb_build_object(
      'abi_version', 1,
      'run_id', v_run_id::text,
      'tenant_id', v_mapping.tenant_id,
      'principal_id', v_mapping.user_id::text,
      'session_id', v_mapping.session_id::text
    ));
    if v_projection->>'run_id' is distinct from v_run_id::text
       or v_projection->>'answer_bundle_hash' is distinct from v_payload->>'answer_bundle_hash'
       or jsonb_typeof(v_projection->'markdown') is distinct from 'string'
       or v_projection->>'markdown' = '' then
      raise exception 'authoritative final projection does not match outbox';
    end if;
    if encode(extensions.digest(v_projection->>'markdown', 'sha256'), 'hex')
       is distinct from substring(v_payload->>'rendered_message_hash' from 8) then
      raise exception 'rendered message hash mismatch';
    end if;

    v_message := v_projection->>'markdown';
    v_usage := case
      when jsonb_typeof(v_projection->'usage') = 'object' then v_projection->'usage'
      else '{}'::jsonb
    end;
    v_input_tokens := greatest(coalesce((v_usage->>'input_tokens')::integer, 0), 0);
    v_output_tokens := greatest(coalesce((v_usage->>'output_tokens')::integer, 0), 0);
    v_cache_hit_tokens := greatest(coalesce((v_usage->>'prompt_cache_hit_tokens')::integer, 0), 0);
    v_cache_miss_tokens := greatest(coalesce((v_usage->>'prompt_cache_miss_tokens')::integer, 0), 0);
    v_settled_credits := greatest(v_input_tokens + (v_output_tokens * 2), 0)::bigint;
    v_provider := case
      when v_run.model like 'deepseek-%' then 'deepseek'
      when v_run.model like 'glm-%' then 'glm'
      else 'krw-agent'
    end;
    v_provider_model_version := v_run.model;

    select pricing.* into v_price
      from public.provider_pricing_policies as pricing
     where pricing.provider = v_provider
       and pricing.provider_model = v_run.model
       and pricing.effective_from <= v_finished_at
       and (pricing.effective_to is null or pricing.effective_to > v_finished_at)
     order by pricing.effective_from desc
     limit 1;
    if found then
      v_pricing_version := v_price.version;
      v_actual_cost := round(
        (greatest(v_cache_hit_tokens, 0)::numeric / 1000000) * v_price.input_cache_hit_cost_per_million
        + (greatest(v_input_tokens - v_cache_hit_tokens, 0)::numeric / 1000000) * v_price.input_cache_miss_cost_per_million
        + (greatest(v_output_tokens, 0)::numeric / 1000000) * v_price.output_cost_per_million,
        6
      );
    end if;

    select coalesce(rb.reserved_cost_usd, 0)
      into v_reserved_cost
      from public.run_budgets as rb
     where rb.user_id = v_mapping.user_id
       and rb.request_id = v_mapping.request_id
     for update;
    select coalesce(cr.reserved_credits_raw, 0)
      into v_reserved_credits
      from public.run_credit_reservations as cr
     where cr.user_id = v_mapping.user_id
       and cr.request_id = v_mapping.request_id
     for update;

    perform public.settle_execution_budget(
      v_mapping.user_id,
      v_mapping.request_id,
      v_run_id,
      least(greatest(v_actual_cost, 0), greatest(v_reserved_cost, 0)),
      'completed',
      jsonb_build_object('source', 'agent_v1_product_outbox', 'answer_bundle_hash', v_payload->>'answer_bundle_hash')
    );
    perform public.settle_analysis_credits(
      v_mapping.user_id,
      v_mapping.request_id,
      v_run_id,
      'completed',
      least(v_settled_credits, v_reserved_credits),
      v_input_tokens,
      v_output_tokens,
      v_cache_hit_tokens,
      v_cache_miss_tokens,
      v_provider,
      v_run.model,
      v_provider_model_version,
      v_pricing_version,
      greatest(v_actual_cost, 0),
      jsonb_build_object('source', 'agent_v1_product_outbox', 'answer_bundle_hash', v_payload->>'answer_bundle_hash')
    );

    perform public.mark_agent_run_terminal(
      v_run_id,
      'completed'::public.run_status,
      v_finished_at,
      null,
      null,
      v_input_tokens,
      v_output_tokens,
      greatest(v_actual_cost, 0),
      null,
      v_run.assistant_message_id,
      null
    );
    update public.messages
       set content = v_message,
           status = 'completed'::public.message_status
     where id = v_run.assistant_message_id;
    for v_artifact in select value from jsonb_array_elements(
        coalesce(v_projection->'visualizations', '[]'::jsonb)
    ) loop
      v_artifact_ref := v_artifact->>'artifact_ref';
      if v_artifact_ref is null or length(v_artifact_ref) < 1 or length(v_artifact_ref) > 128 then
        raise exception 'visualization artifact_ref missing or oversized';
      end if;
      insert into public.chat_message_visualizations (
        session_id, message_id, run_id, artifact_ref, payload_json
      ) values (
        v_mapping.session_id,
        v_run.assistant_message_id,
        v_run_id,
        v_artifact_ref,
        v_artifact
      ) on conflict (message_id, artifact_ref) do nothing;
    end loop;
    insert into public.agent_run_events (run_id, event_type, payload)
    values (v_run_id, 'done', jsonb_build_object(
      'run_id', v_run_id,
      'assistant_message_id', v_run.assistant_message_id,
      'answer_bundle_hash', v_payload->>'answer_bundle_hash',
      'rendered_message_hash', v_payload->>'rendered_message_hash',
      'evidence_ledger_hash', v_projection->>'evidence_ledger_hash',
      'memory_revision', v_projection->>'memory_revision',
      'visualization_count', jsonb_array_length(
        coalesce(v_projection->'visualizations', '[]'::jsonb)
      ),
      'source', 'agent_v1_product_outbox'
    ));
    v_authoritative_state := 'final';
  elsif v_event_kind in ('run.cancelled', 'run.failed')
    and v_run.status in ('completed', 'cancelled', 'failed', 'expired') then
    -- A terminal product projection is monotonic.  A late failure/cancel
    -- notification can be acknowledged, but it must not overwrite the
    -- already-visible answer or regress billing state.
    insert into public.agent_run_events (run_id, event_type, payload)
    values (v_run_id, 'activity_update', jsonb_build_object(
      'stage', v_event_kind,
      'ignored_after_terminal', true,
      'source', 'agent_v1_product_outbox'
    ));
    v_authoritative_state := 'non_terminal';
  elsif v_event_kind = 'run.cancelled' then
    v_message := '응답 생성을 취소했습니다.';
    perform public.release_execution_budget(v_mapping.user_id, v_mapping.request_id, v_run_id, 'cancelled');
    perform public.release_analysis_credits(v_mapping.user_id, v_mapping.request_id, v_run_id, 'cancelled');
    perform public.mark_agent_run_terminal(v_run_id, 'cancelled'::public.run_status, v_finished_at, 'cancelled', v_message, null, null, null, null, v_run.assistant_message_id, null);
    update public.messages
       set content = v_message,
           status = 'cancelled'::public.message_status
     where id = v_run.assistant_message_id
       and status <> 'completed'::public.message_status;
    insert into public.agent_run_events (run_id, event_type, payload)
    values (v_run_id, 'cancelled', jsonb_build_object('run_id', v_run_id, 'source', 'agent_v1_product_outbox'));
    v_authoritative_state := 'cancelled';
  elsif v_event_kind = 'run.failed' then
    v_message := '분석 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
    perform public.release_execution_budget(v_mapping.user_id, v_mapping.request_id, v_run_id, 'failed');
    perform public.release_analysis_credits(v_mapping.user_id, v_mapping.request_id, v_run_id, 'failed');
    perform public.mark_agent_run_terminal(v_run_id, 'failed'::public.run_status, v_finished_at, 'agent_v1_failed', v_message, null, null, null, null, v_run.assistant_message_id, null);
    update public.messages
       set content = v_message,
           status = 'failed'::public.message_status
     where id = v_run.assistant_message_id
       and status <> 'completed'::public.message_status;
    insert into public.agent_run_events (run_id, event_type, payload)
    values (v_run_id, 'error', jsonb_build_object('run_id', v_run_id, 'error_code', 'agent_v1_failed', 'source', 'agent_v1_product_outbox'));
    v_authoritative_state := 'failed';
  else
    insert into public.agent_run_events (run_id, event_type, payload)
    values (v_run_id, 'activity_update', jsonb_build_object('stage', v_event_kind, 'source', 'agent_v1_product_outbox'));
    v_authoritative_state := 'non_terminal';
  end if;

  insert into public.agent_v1_product_outbox_receipts (
    dedupe_key, outbox_id, run_id, event_kind, event_hash, authoritative_state
  ) values (
    v_dedupe_key, v_outbox_id, v_run_id, v_event_kind, v_event_hash, v_authoritative_state
  );

  return jsonb_build_object(
    'outcome', 'applied',
    'run_id', v_run_id,
    'dedupe_key', v_dedupe_key
  );
end;
$$;

revoke all on function public.apply_agent_v1_product_outbox(jsonb) from public, anon, authenticated;
grant execute on function public.apply_agent_v1_product_outbox(jsonb) to service_role;
