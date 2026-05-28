-- Backfill tool calls that were left open before terminal cleanup was added.

update public.tool_calls as tc
  set finished_at = coalesce(ar.finished_at, now()),
      error_message = coalesce(
        nullif(tc.error_message, ''),
        case ar.status
          when 'completed' then 'Run completed before tool result was received'
          when 'cancelled' then 'Run was cancelled before tool result was received'
          when 'expired' then 'Worker lease expired before tool result was received'
          else coalesce(
            nullif(ar.error_message, ''),
            'Run failed before tool result was received'
          )
        end
      )
  from public.agent_runs as ar
  where tc.run_id = ar.id
    and tc.finished_at is null
    and ar.status in ('completed', 'failed', 'cancelled', 'expired');
