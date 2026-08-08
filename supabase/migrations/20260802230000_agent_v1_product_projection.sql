-- Bind the private agent_v1 runtime to the existing KRW chat product without
-- exposing its persistence tables.  The public run is a UI/SSE projection;
-- agent_v1 remains the only execution authority.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if to_regprocedure('agent_v1.enqueue_run(jsonb)') is null
     or to_regprocedure('agent_v1.request_cancel(jsonb)') is null
     or to_regprocedure('agent_v1.read_committed_outcome(jsonb)') is null then
    raise exception 'agent_v1 product projection requires the agent_v1 ABI migration first';
  end if;
end
$$;

alter table public.agent_runs
  drop constraint if exists agent_runs_executor_type_check;

alter table public.agent_runs
  add constraint agent_runs_executor_type_check
  check (executor_type in ('claude_agent', 'server_pipeline', 'rust_agent'));

-- Even an accidental application update must not place a Rust-owned run on
-- the legacy queue.  The Rust daemon owns queueing in agent_v1.
alter table public.agent_runs
  drop constraint if exists agent_runs_rust_agent_not_legacy_queued_check;

alter table public.agent_runs
  add constraint agent_runs_rust_agent_not_legacy_queued_check
  check (executor_type <> 'rust_agent' or status <> 'queued');

create table if not exists public.agent_v1_product_run_mappings (
  run_id uuid primary key references public.agent_runs(id) on delete cascade,
  daemon_run_id text not null unique,
  tenant_id text not null check (char_length(tenant_id) between 1 and 128),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  request_id text not null unique check (char_length(request_id) between 1 and 128),
  descriptor_artifact_hash text not null
    check (descriptor_artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
  release_set_hash text not null
    check (release_set_hash ~ '^sha256:[0-9a-f]{64}$'),
  enqueue_mutation_id text not null
    check (char_length(enqueue_mutation_id) between 1 and 128),
  enqueue_mutation_hash text not null
    check (enqueue_mutation_hash ~ '^sha256:[0-9a-f]{64}$'),
  immutable_snapshot_hash text not null
    check (immutable_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  agent_image_hash text not null
    check (agent_image_hash ~ '^sha256:[0-9a-f]{64}$'),
  runtime_version text not null check (char_length(runtime_version) between 1 and 64),
  terminal_state text check (terminal_state in ('final', 'cancelled', 'failed')),
  terminal_run_version bigint check (terminal_run_version is null or terminal_run_version >= 1),
  terminal_cancel_generation bigint
    check (terminal_cancel_generation is null or terminal_cancel_generation >= 0),
  terminal_fencing_token bigint
    check (terminal_fencing_token is null or terminal_fencing_token >= 0),
  terminal_outcome jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (daemon_run_id = run_id::text),
  check (
    (terminal_state is null)
    = (terminal_run_version is null
       and terminal_cancel_generation is null
       and terminal_fencing_token is null
       and terminal_outcome is null)
  )
);

create index if not exists idx_agent_v1_product_run_mappings_session
  on public.agent_v1_product_run_mappings (session_id, created_at desc);

create table if not exists public.agent_v1_product_outbox_receipts (
  dedupe_key text primary key check (char_length(dedupe_key) between 1 and 256),
  outbox_id bigint not null unique check (outbox_id >= 1),
  run_id uuid not null references public.agent_v1_product_run_mappings(run_id) on delete cascade,
  event_kind text not null
    check (event_kind in ('answer.committed', 'run.cancelled', 'run.failed')),
  event_hash text not null check (event_hash ~ '^sha256:[0-9a-f]{64}$'),
  authoritative_state text not null
    check (authoritative_state in ('final', 'cancelled', 'failed')),
  applied_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_agent_v1_product_outbox_receipts_run
  on public.agent_v1_product_outbox_receipts (run_id, outbox_id);

alter table public.agent_v1_product_run_mappings enable row level security;
alter table public.agent_v1_product_outbox_receipts enable row level security;

revoke all on table public.agent_v1_product_run_mappings
  from public, anon, authenticated, service_role;
revoke all on table public.agent_v1_product_outbox_receipts
  from public, anon, authenticated, service_role;

-- Internal validator used only by the SECURITY DEFINER wrappers below.
create or replace function public.agent_v1_product_assert_exact_object(
  p_value jsonb,
  p_allowed text[],
  p_required text[],
  p_label text
)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_key text;
  v_extra text;
begin
  if jsonb_typeof(p_value) is distinct from 'object' then
    raise exception '% must be an object', p_label;
  end if;

  select string_agg(keys.key, ',' order by keys.key)
    into v_extra
    from jsonb_object_keys(p_value) as keys(key)
   where not (keys.key = any (p_allowed));

  if v_extra is not null then
    raise exception '% has unknown fields: %', p_label, v_extra;
  end if;

  foreach v_key in array p_required loop
    if not (p_value ? v_key) then
      raise exception '% is missing field %', p_label, v_key;
    end if;
  end loop;
end;
$$;

create or replace function public.agent_v1_product_assert_hash(
  p_value text,
  p_label text
)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_value is null or p_value !~ '^sha256:[0-9a-f]{64}$' then
    raise exception '% must be a lowercase sha256 content hash', p_label;
  end if;
end;
$$;

revoke all on function public.agent_v1_product_assert_exact_object(jsonb, text[], text[], text)
  from public, anon, authenticated, service_role;
revoke all on function public.agent_v1_product_assert_hash(text, text)
  from public, anon, authenticated, service_role;

create or replace function public.enqueue_agent_v1_product_run(p_request jsonb)
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
    'enqueue request'
  );

  if p_request->>'schema_version' is distinct from '1' then
    raise exception 'unsupported enqueue product schema';
  end if;
  if octet_length(p_request::text) > 1572864 then
    raise exception 'enqueue request exceeds 1.5 MiB';
  end if;

  perform public.agent_v1_product_assert_hash(
    p_request->>'descriptor_artifact_hash',
    'descriptor_artifact_hash'
  );
  perform public.agent_v1_product_assert_hash(
    p_request->>'release_set_hash',
    'release_set_hash'
  );

  v_agent_request := p_request->'agent_request';
  v_product := p_request->'product';

  perform public.agent_v1_product_assert_exact_object(
    v_product,
    array['run_id', 'user_id', 'session_id', 'user_message_id', 'request_id',
          'run_kind', 'locale', 'web_commit', 'runtime_environment'],
    array['run_id', 'user_id', 'session_id', 'user_message_id', 'request_id',
          'run_kind', 'locale', 'web_commit', 'runtime_environment'],
    'enqueue product'
  );

  if jsonb_typeof(v_agent_request) is distinct from 'object'
     or octet_length(v_agent_request::text) > 1310720 then
    raise exception 'agent_request must be an object no larger than 1.25 MiB';
  end if;
  if v_agent_request->>'abi_version' is distinct from '1' then
    raise exception 'unsupported agent_v1 ABI';
  end if;
  if v_agent_request#>>'{immutable_snapshot,schema_version}' is distinct from '3' then
    raise exception 'unsupported immutable claim schema';
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
    'company_research', 'idea_generation', 'news_discovery', 'news_research',
    'market_move_research', 'scenario_sensitivity', 'guru_advisor'
  ) then
    raise exception 'unsupported run_kind';
  end if;
  if char_length(v_product->>'locale') not between 2 and 32
     or char_length(v_product->>'web_commit') not between 1 and 128
     or char_length(v_product->>'request_id') not between 1 and 128 then
    raise exception 'invalid bounded product field';
  end if;
  if v_model is null or char_length(v_model) not between 1 and 128
     or v_model !~ '^deepseek-[a-z0-9][a-z0-9._-]*$' then
    raise exception 'requested model must be an explicit DeepSeek deployment model';
  end if;

  if v_agent_request->>'run_id' is distinct from v_run_id::text
     or v_agent_request->>'session_id' is distinct from v_session_id::text
     or v_agent_request->>'principal_id' is distinct from v_user_id::text
     or v_agent_request#>>'{immutable_snapshot,request,run_id}' is distinct from v_run_id::text
     or v_agent_request#>>'{immutable_snapshot,request,session_id}' is distinct from v_session_id::text
     or v_agent_request#>>'{immutable_snapshot,request,principal_id}' is distinct from v_user_id::text
     or v_agent_request#>>'{immutable_snapshot,request,run_kind}' is distinct from v_product->>'run_kind'
     or v_agent_request#>>'{immutable_snapshot,request,locale}' is distinct from v_product->>'locale' then
    raise exception 'product identity does not match immutable agent request';
  end if;

  perform public.agent_v1_product_assert_hash(v_agent_request->>'mutation_hash', 'mutation_hash');
  perform public.agent_v1_product_assert_hash(
    v_agent_request->>'immutable_snapshot_hash',
    'immutable_snapshot_hash'
  );
  perform public.agent_v1_product_assert_hash(v_agent_request->>'agent_image_hash', 'agent_image_hash');

  if char_length(v_agent_request->>'mutation_id') not between 1 and 128
     or char_length(v_agent_request->>'tenant_id') not between 1 and 128
     or char_length(v_agent_request->>'runtime_version') not between 1 and 64 then
    raise exception 'invalid bounded agent request field';
  end if;

  select s.user_id
    into v_session_user_id
    from public.chat_sessions as s
   where s.id = v_session_id
     and s.deleted_at is null
   for update;

  if not found or v_session_user_id is distinct from v_user_id then
    raise exception 'session ownership mismatch';
  end if;

  select m.*
    into v_user_message
    from public.messages as m
   where m.id = v_user_message_id
   for update;

  if not found
     or v_user_message.session_id is distinct from v_session_id
     or v_user_message.role is distinct from 'user'::public.message_role then
    raise exception 'user message ownership mismatch';
  end if;

  select mapping.*
    into v_existing
    from public.agent_v1_product_run_mappings as mapping
   where mapping.run_id = v_run_id
      or mapping.request_id = v_product->>'request_id'
   for update;

  if found then
    select r.* into v_run
      from public.agent_runs as r
     where r.id = v_existing.run_id
     for update;

    if v_existing.run_id is distinct from v_run_id
       or v_existing.user_id is distinct from v_user_id
       or v_existing.session_id is distinct from v_session_id
       or v_existing.request_id is distinct from v_product->>'request_id'
       or v_existing.descriptor_artifact_hash is distinct from p_request->>'descriptor_artifact_hash'
       or v_existing.release_set_hash is distinct from p_request->>'release_set_hash'
       or v_existing.enqueue_mutation_id is distinct from v_agent_request->>'mutation_id'
       or v_existing.enqueue_mutation_hash is distinct from v_agent_request->>'mutation_hash'
       or v_existing.immutable_snapshot_hash is distinct from v_agent_request->>'immutable_snapshot_hash'
       or v_existing.agent_image_hash is distinct from v_agent_request->>'agent_image_hash'
       or v_existing.runtime_version is distinct from v_agent_request->>'runtime_version'
       or v_run.executor_type is distinct from 'rust_agent'
       or v_run.user_message_id is distinct from v_user_message_id then
      raise exception 'agent_v1 product enqueue identity conflict';
    end if;

    v_kernel_response := agent_v1.enqueue_run(v_agent_request);
    if v_kernel_response->>'run_id' is distinct from v_run_id::text
       or v_kernel_response->>'outcome' not in ('enqueued', 'already_enqueued') then
      raise exception 'invalid agent_v1 enqueue response';
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
    raise exception 'invalid agent_v1 enqueue response';
  end if;

  v_assistant_message_id := gen_random_uuid();
  v_queued_at := clock_timestamp();

  insert into public.messages (id, session_id, role, content, status)
  values (
    v_assistant_message_id,
    v_session_id,
    'assistant'::public.message_role,
    '',
    'pending'::public.message_status
  );

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
    (
      v_run_id,
      'run_queued',
      jsonb_build_object(
        'run_id', v_run_id,
        'message_id', v_assistant_message_id,
        'session_id', v_session_id,
        'request_id', v_product->>'request_id',
        'queued_at', v_queued_at,
        'run_kind', v_product->>'run_kind',
        'response_locale', v_product->>'locale',
        'executor_type', 'rust_agent'
      )
    ),
    (
      v_run_id,
      'activity_update',
      jsonb_build_object('stage', 'queued', 'label', '대기열에 추가됨')
    );

  return jsonb_build_object(
    'outcome', 'enqueued',
    'run_id', v_run_id,
    'assistant_message_id', v_assistant_message_id,
    'queued_at', v_queued_at,
    'kernel_outcome', v_kernel_response->>'outcome'
  );
end;
$$;

create or replace function public.cancel_agent_v1_product_run(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_agent_request jsonb;
  v_product jsonb;
  v_mapping public.agent_v1_product_run_mappings%rowtype;
  v_run public.agent_runs%rowtype;
  v_kernel_response jsonb;
  v_run_id uuid;
  v_user_id uuid;
  v_session_id uuid;
  v_outcome text;
begin
  perform public.agent_v1_product_assert_exact_object(
    p_request,
    array['schema_version', 'agent_request', 'product'],
    array['schema_version', 'agent_request', 'product'],
    'cancel request'
  );
  if p_request->>'schema_version' is distinct from '1'
     or octet_length(p_request::text) > 1179648 then
    raise exception 'invalid or oversized cancel request';
  end if;

  v_agent_request := p_request->'agent_request';
  v_product := p_request->'product';
  perform public.agent_v1_product_assert_exact_object(
    v_product,
    array['run_id', 'user_id', 'session_id'],
    array['run_id', 'user_id', 'session_id'],
    'cancel product'
  );

  if jsonb_typeof(v_agent_request) is distinct from 'object'
     or v_agent_request->>'abi_version' is distinct from '1' then
    raise exception 'invalid cancel agent_request';
  end if;
  perform public.agent_v1_product_assert_hash(v_agent_request->>'mutation_hash', 'mutation_hash');

  v_run_id := (v_product->>'run_id')::uuid;
  v_user_id := (v_product->>'user_id')::uuid;
  v_session_id := (v_product->>'session_id')::uuid;

  select mapping.*
    into v_mapping
    from public.agent_v1_product_run_mappings as mapping
   where mapping.run_id = v_run_id
   for update;

  if not found then
    raise exception 'cancel ownership or run identity mismatch';
  end if;

  select r.*
    into v_run
    from public.agent_runs as r
   where r.id = v_run_id
   for update;

  if not found
     or v_mapping.user_id is distinct from v_user_id
     or v_mapping.session_id is distinct from v_session_id
     or v_run.executor_type is distinct from 'rust_agent'
     or v_agent_request->>'run_id' is distinct from v_run_id::text
     or v_agent_request->>'tenant_id' is distinct from v_mapping.tenant_id then
    raise exception 'cancel ownership or run identity mismatch';
  end if;

  v_kernel_response := agent_v1.request_cancel(v_agent_request);
  if v_kernel_response->>'run_id' is distinct from v_run_id::text
     or v_kernel_response->>'outcome' not in (
       'cancelled', 'already_cancelled', 'already_final', 'already_failed'
     ) then
    raise exception 'invalid agent_v1 cancel response';
  end if;

  if v_kernel_response->>'outcome' in ('cancelled', 'already_cancelled') then
    update public.agent_runs
       set cancel_requested_at = coalesce(cancel_requested_at, clock_timestamp())
     where id = v_run_id;
    v_outcome := 'cancel_requested';
  else
    v_outcome := 'already_terminal';
  end if;

  return jsonb_build_object(
    'outcome', v_outcome,
    'run_id', v_run_id,
    'kernel_outcome', v_kernel_response->>'outcome'
  );
end;
$$;
