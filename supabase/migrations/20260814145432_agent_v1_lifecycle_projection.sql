-- Project the Rust run lifecycle into the existing product chat stream.
--
-- Lifecycle events are deliberately non-terminal.  The old terminal
-- projection remains authoritative and is delegated to by the v2 wrapper
-- below.  This keeps the migration additive and lets an older worker continue
-- to process answer/failure events while the new worker starts emitting
-- run.started/run.progress.

begin;

alter table public.agent_v1_product_run_mappings
  add column if not exists lifecycle_run_version bigint not null default 0
    check (lifecycle_run_version >= 0),
  add column if not exists lifecycle_stage text not null default 'queued'
    check (lifecycle_stage in ('queued', 'started', 'researching', 'composing'));

alter table public.agent_v1_product_outbox_receipts
  drop constraint if exists agent_v1_product_outbox_receipts_event_kind_check;

alter table public.agent_v1_product_outbox_receipts
  add constraint agent_v1_product_outbox_receipts_event_kind_check
  check (event_kind in (
    'answer.committed', 'answer.presentation', 'answer.billing',
    'answer.notification', 'run.started', 'run.progress',
    'run.cancelled', 'run.failed', 'run.deferred'
  ));

alter table public.agent_v1_product_outbox_receipts
  drop constraint if exists agent_v1_product_outbox_receipts_authoritative_state_check;

alter table public.agent_v1_product_outbox_receipts
  add constraint agent_v1_product_outbox_receipts_authoritative_state_check
  check (authoritative_state in ('final', 'cancelled', 'failed', 'non_terminal'));

create or replace function public.apply_agent_v1_product_outbox_v2(p_request jsonb)
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
  v_run_id uuid;
  v_outbox_id bigint;
  v_event_kind text;
  v_dedupe_key text;
  v_event_hash text;
  v_payload_run_id text;
  v_payload_version bigint;
  v_payload_stage text;
  v_payload_occurred_at timestamptz;
  v_current_rank integer;
  v_event_rank integer;
  v_started_transition boolean := false;
  v_stage text;
  v_label text;
begin
  perform public.agent_v1_product_assert_exact_object(
    p_request,
    array['schema_version', 'event_hash', 'event'],
    array['schema_version', 'event_hash', 'event'],
    'product outbox v2 request'
  );
  if p_request->>'schema_version' is distinct from '1'
     or octet_length(p_request::text) > 1572864 then
    raise exception 'invalid or oversized product outbox v2 request';
  end if;
  perform public.agent_v1_product_assert_hash(p_request->>'event_hash', 'event_hash');

  v_event := p_request->'event';
  perform public.agent_v1_product_assert_exact_object(
    v_event,
    array['outbox_id', 'run_id', 'event_kind', 'dedupe_key', 'payload',
          'delivery_attempts', 'delivery_deadline'],
    array['outbox_id', 'run_id', 'event_kind', 'dedupe_key', 'payload',
          'delivery_attempts', 'delivery_deadline'],
    'product outbox v2 event'
  );
  v_outbox_id := (v_event->>'outbox_id')::bigint;
  if v_outbox_id < 1 then raise exception 'invalid outbox_id'; end if;
  v_run_id := (v_event->>'run_id')::uuid;
  v_event_kind := v_event->>'event_kind';
  v_dedupe_key := v_event->>'dedupe_key';
  v_event_hash := p_request->>'event_hash';
  v_payload := v_event->'payload';

  -- Terminal and settlement events keep the already-deployed projection
  -- unchanged.  The wrapper exists only to add the two lifecycle kinds.
  if v_event_kind not in ('run.started', 'run.progress') then
    return public.apply_agent_v1_product_outbox(p_request);
  end if;

  if char_length(v_dedupe_key) not between 1 and 256 then
    raise exception 'invalid lifecycle outbox dedupe key';
  end if;
  if jsonb_typeof(v_payload) is distinct from 'object' then
    raise exception 'lifecycle outbox payload must be an object';
  end if;
  v_payload_run_id := v_payload->>'run_id';
  if v_payload->>'schema_version' is distinct from '1'
     or v_payload_run_id is distinct from v_run_id::text then
    raise exception 'lifecycle payload identity mismatch';
  end if;
  v_payload_version := (v_payload->>'run_version')::bigint;
  if v_payload_version < 1 then raise exception 'invalid lifecycle run_version'; end if;
  v_payload_occurred_at := (v_payload->>'occurred_at')::timestamptz;

  if v_event_kind = 'run.started' then
    perform public.agent_v1_product_assert_exact_object(
      v_payload,
      array['schema_version', 'run_id', 'run_version', 'occurred_at'],
      array['schema_version', 'run_id', 'run_version', 'occurred_at'],
      'run.started payload'
    );
    v_stage := 'started';
    v_event_rank := 1;
  else
    perform public.agent_v1_product_assert_exact_object(
      v_payload,
      array['schema_version', 'run_id', 'run_version', 'stage', 'occurred_at'],
      array['schema_version', 'run_id', 'run_version', 'stage', 'occurred_at'],
      'run.progress payload'
    );
    v_payload_stage := v_payload->>'stage';
    if v_payload_stage not in ('researching', 'composing') then
      raise exception 'invalid lifecycle stage';
    end if;
    v_stage := v_payload_stage;
    v_event_rank := case v_stage when 'researching' then 2 when 'composing' then 3 end;
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
  if not found then raise exception 'public agent run missing'; end if;

  select * into v_receipt
    from public.agent_v1_product_outbox_receipts as receipt
   where receipt.dedupe_key = v_dedupe_key
   for update;
  if found then
    if v_receipt.outbox_id <> v_outbox_id
       or v_receipt.run_id <> v_run_id
       or v_receipt.event_kind <> v_event_kind
       or v_receipt.event_hash <> v_event_hash then
      raise exception 'lifecycle outbox receipt identity conflict';
    end if;
    return jsonb_build_object(
      'outcome', 'already_applied',
      'run_id', v_run_id,
      'dedupe_key', v_dedupe_key
    );
  end if;

  -- Once a terminal projection exists, lifecycle events are only receipts.
  -- They must never resurrect a completed or failed chat message.
  if v_run.status in ('completed', 'failed', 'cancelled', 'expired') then
    insert into public.agent_v1_product_outbox_receipts (
      dedupe_key, outbox_id, run_id, event_kind, event_hash, authoritative_state
    ) values (
      v_dedupe_key, v_outbox_id, v_run_id, v_event_kind, v_event_hash, 'non_terminal'
    );
    return jsonb_build_object(
      'outcome', 'applied', 'run_id', v_run_id, 'dedupe_key', v_dedupe_key
    );
  end if;

  v_current_rank := case v_mapping.lifecycle_stage
    when 'queued' then 0 when 'started' then 1 when 'researching' then 2
    when 'composing' then 3 else 0 end;

  -- A new lease may carry a higher run_version, but within one version stages
  -- only move forward.  This rejects delayed/duplicated events deterministically.
  if v_payload_version < v_mapping.lifecycle_run_version
     or (v_payload_version = v_mapping.lifecycle_run_version
         and v_event_rank <= v_current_rank) then
    insert into public.agent_v1_product_outbox_receipts (
      dedupe_key, outbox_id, run_id, event_kind, event_hash, authoritative_state
    ) values (
      v_dedupe_key, v_outbox_id, v_run_id, v_event_kind, v_event_hash, 'non_terminal'
    );
    return jsonb_build_object(
      'outcome', 'already_applied', 'run_id', v_run_id, 'dedupe_key', v_dedupe_key
    );
  end if;

  v_started_transition := v_mapping.lifecycle_stage = 'queued';
  update public.agent_v1_product_run_mappings
     set lifecycle_run_version = v_payload_version,
         lifecycle_stage = v_stage,
         updated_at = clock_timestamp()
   where run_id = v_run_id;

  update public.agent_runs
     set status = case
           when status in ('pending', 'queued') then 'running'::public.run_status
           else status
         end,
         started_at = coalesce(started_at, v_payload_occurred_at)
   where id = v_run_id
     and status not in ('completed', 'failed', 'cancelled', 'expired');

  if v_started_transition then
    insert into public.agent_run_events (run_id, event_type, payload)
    values (v_run_id, 'run_started', jsonb_build_object(
      'run_id', v_run_id,
      'message_id', v_run.assistant_message_id,
      'session_id', v_run.session_id,
      'request_id', v_run.request_id,
      'started_at', v_payload_occurred_at,
      'source', 'agent_v1_product_outbox'
    ));
  end if;

  if v_event_kind = 'run.progress' then
    v_label := case v_stage
      when 'researching' then '사업·재무 단서 확인'
      when 'composing' then '투자 해석 작성'
    end;
    insert into public.agent_run_events (run_id, event_type, payload)
    values (v_run_id, 'activity_update', jsonb_build_object(
      'run_id', v_run_id,
      'stage', v_stage,
      'label', v_label,
      'source', 'agent_v1_product_outbox'
    ));
  end if;

  insert into public.agent_v1_product_outbox_receipts (
    dedupe_key, outbox_id, run_id, event_kind, event_hash, authoritative_state
  ) values (
    v_dedupe_key, v_outbox_id, v_run_id, v_event_kind, v_event_hash, 'non_terminal'
  );

  return jsonb_build_object(
    'outcome', 'applied', 'run_id', v_run_id, 'dedupe_key', v_dedupe_key
  );
end;
$$;

revoke all on function public.apply_agent_v1_product_outbox_v2(jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_agent_v1_product_outbox_v2(jsonb)
  to service_role;

commit;
