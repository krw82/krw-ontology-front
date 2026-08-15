-- A daemon heartbeat is admissible only when its sealed MCP routes passed the
-- startup/periodic preflight. Database liveness alone must not open research.
begin;

alter table public.agent_v1_daemon_heartbeats
  add column if not exists mcp_ready boolean not null default false;

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
          'release_set_hash','runtime_version','heartbeat_ttl_ms','mcp_ready'],
    array['abi_version','daemon_id','provider','descriptor_artifact_hash',
          'release_set_hash','runtime_version','heartbeat_ttl_ms','mcp_ready']
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
    runtime_version, mcp_ready, last_seen_at, heartbeat_expires_at, updated_at
  ) values (
    p_request->>'daemon_id', p_request->>'provider',
    p_request->>'descriptor_artifact_hash', p_request->>'release_set_hash',
    p_request->>'runtime_version', agent_store.request_boolean(p_request, 'mcp_ready'),
    clock_timestamp(), v_expires_at, clock_timestamp()
  ) on conflict (daemon_id) do update set
    provider = excluded.provider,
    descriptor_artifact_hash = excluded.descriptor_artifact_hash,
    release_set_hash = excluded.release_set_hash,
    runtime_version = excluded.runtime_version,
    mcp_ready = excluded.mcp_ready,
    last_seen_at = excluded.last_seen_at,
    heartbeat_expires_at = excluded.heartbeat_expires_at,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ready', true,
    'mcp_ready', agent_store.request_boolean(p_request, 'mcp_ready'),
    'heartbeat_expires_at', v_expires_at
  );
end;
$function$;

commit;
