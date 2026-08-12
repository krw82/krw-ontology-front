-- Rust Agent V1 owns this small readiness receipt directly. It is separate
-- from the retired Claude/plugin worker heartbeat and from ontology data.
-- No user text, tool result, prompt, credential, or provider response is
-- stored here.
begin;

create table if not exists public.agent_v1_daemon_heartbeats (
  daemon_id text primary key
    check (char_length(daemon_id) between 1 and 128),
  provider text not null
    check (provider in ('glm', 'deepseek')),
  descriptor_artifact_hash text not null
    check (descriptor_artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
  release_set_hash text not null
    check (release_set_hash ~ '^sha256:[0-9a-f]{64}$'),
  runtime_version text not null
    check (char_length(runtime_version) between 1 and 128),
  last_seen_at timestamptz not null default clock_timestamp(),
  heartbeat_expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists agent_v1_daemon_heartbeats_ready_idx
  on public.agent_v1_daemon_heartbeats (
    provider,
    descriptor_artifact_hash,
    release_set_hash,
    heartbeat_expires_at desc,
    last_seen_at desc
  );

alter table public.agent_v1_daemon_heartbeats enable row level security;
revoke all on table public.agent_v1_daemon_heartbeats from public, anon, authenticated;
grant select on table public.agent_v1_daemon_heartbeats to service_role;

create or replace function agent_v1.heartbeat_daemon(p_request jsonb) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, agent_store, public
as $function$
declare
  v_ttl_ms bigint;
  v_expires_at timestamptz;
begin
  perform agent_store.assert_request(
    p_request,
    array['abi_version','daemon_id','provider','descriptor_artifact_hash',
          'release_set_hash','runtime_version','heartbeat_ttl_ms'],
    array['abi_version','daemon_id','provider','descriptor_artifact_hash',
          'release_set_hash','runtime_version','heartbeat_ttl_ms']
  );
  perform agent_store.assert_text(p_request, 'daemon_id', 128);
  perform agent_store.assert_text(p_request, 'provider', 16);
  perform agent_store.assert_hash(p_request->>'descriptor_artifact_hash');
  perform agent_store.assert_hash(p_request->>'release_set_hash');
  perform agent_store.assert_text(p_request, 'runtime_version', 128);
  if p_request->>'provider' not in ('glm', 'deepseek') then
    raise exception using errcode = 'K1000', message = 'invalid_daemon_provider';
  end if;
  v_ttl_ms := agent_store.request_bigint(p_request, 'heartbeat_ttl_ms', 30000, 120000);
  v_expires_at := clock_timestamp() + v_ttl_ms * interval '1 millisecond';

  insert into public.agent_v1_daemon_heartbeats(
    daemon_id, provider, descriptor_artifact_hash, release_set_hash,
    runtime_version, last_seen_at, heartbeat_expires_at, updated_at
  ) values (
    p_request->>'daemon_id', p_request->>'provider',
    p_request->>'descriptor_artifact_hash', p_request->>'release_set_hash',
    p_request->>'runtime_version', clock_timestamp(), v_expires_at, clock_timestamp()
  ) on conflict (daemon_id) do update set
    provider = excluded.provider,
    descriptor_artifact_hash = excluded.descriptor_artifact_hash,
    release_set_hash = excluded.release_set_hash,
    runtime_version = excluded.runtime_version,
    last_seen_at = excluded.last_seen_at,
    heartbeat_expires_at = excluded.heartbeat_expires_at,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ready', true,
    'heartbeat_expires_at', v_expires_at
  );
end;
$function$;

revoke all on function agent_v1.heartbeat_daemon(jsonb) from public;
do $grant$
begin
  if exists (select 1 from pg_roles where rolname = 'krw_agent_daemon') then
    grant execute on function agent_v1.heartbeat_daemon(jsonb) to krw_agent_daemon;
  end if;
end;
$grant$;

commit;
