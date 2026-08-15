-- Preserve the bounded provider usage that the Rust worker attaches to a
-- terminal failure.  The agent ABI stores that payload in the private
-- release settlement, while the public run projection previously called
-- mark_agent_run_terminal with NULL token counts and therefore displayed 0 /
-- unknown usage for failures such as a provider output-limit exhaustion.
--
-- This is a projection-only repair: it does not bill failed work and it does
-- not expose prompts, model output, or the private settlement body.  It only
-- copies the two bounded counters already accepted by the Rust BudgetUsage
-- contract into the existing public run row.

create or replace function public.sync_agent_v1_failure_usage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, agent_store
as $$
declare
  v_usage jsonb;
  v_input_tokens integer;
  v_output_tokens integer;
begin
  if new.status <> 'failed'::public.run_status
     or old.status is not distinct from new.status then
    return new;
  end if;

  select settlement_payload -> 'usage'
    into v_usage
   from agent_store.settlements
   where run_id = new.id::text
     and settlement_kind = 'released'
   limit 1;

  if jsonb_typeof(v_usage) is distinct from 'object' then
    return new;
  end if;

  -- Rust emits non-negative u32 counters.  Keep the public integer column
  -- bounded even if an old/malformed settlement is replayed.
  if (v_usage ->> 'input_tokens') ~ '^[0-9]{1,10}$' then
    v_input_tokens := least((v_usage ->> 'input_tokens')::bigint, 2147483647)::integer;
  end if;
  if (v_usage ->> 'output_tokens') ~ '^[0-9]{1,10}$' then
    v_output_tokens := least((v_usage ->> 'output_tokens')::bigint, 2147483647)::integer;
  end if;

  if v_input_tokens is null and v_output_tokens is null then
    return new;
  end if;

  update public.agent_runs
     set input_tokens = coalesce(v_input_tokens, input_tokens),
         output_tokens = coalesce(v_output_tokens, output_tokens)
   where id = new.id
     and status = 'failed'::public.run_status
     and (input_tokens is null or output_tokens is null);

  return new;
exception
  when others then
    -- Usage is observational metadata.  A missing/malformed private release
    -- must never make the already-terminal public failure transaction fail.
    return new;
end;
$$;

revoke all on function public.sync_agent_v1_failure_usage() from public, anon, authenticated;

drop trigger if exists trg_sync_agent_v1_failure_usage on public.agent_runs;
create trigger trg_sync_agent_v1_failure_usage
after update of status on public.agent_runs
for each row
when (
  new.status = 'failed'::public.run_status
  and old.status is distinct from new.status
)
execute function public.sync_agent_v1_failure_usage();
