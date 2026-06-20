-- Idempotent retries must preserve the reservation's original shadow/enforced
-- decision instead of re-evaluating it against unrelated concurrent reserves.

do $$
declare
  v_sql text;
  v_replaced text;
begin
  select pg_get_functiondef(
    'public.reserve_analysis_credits(uuid,text,bigint,timestamptz,timestamptz)'::regprocedure
  )
    into v_sql;

  if position(
    'v_allowed := nullif(v_existing.metadata ->> ''shadow_allowed'', '''')::boolean;'
    in v_sql
  ) > 0 then
    return;
  end if;

  v_replaced := replace(
    v_sql,
    'if found and v_existing.status in (''reserved'', ''running'', ''settled'') then
    v_allowed :=
      v_balance.credits_used_raw + v_balance.credits_reserved_raw
      <= v_balance.credits_limit_raw;
    v_reason := case
      when v_allowed then null
      else ''weekly_credit_limit_exceeded''
    end;',
    'if found and v_existing.status in (''reserved'', ''running'', ''settled'') then
    begin
      v_allowed := nullif(v_existing.metadata ->> ''shadow_allowed'', '''')::boolean;
    exception
      when invalid_text_representation then
        v_allowed := null;
    end;
    v_allowed := coalesce(
      v_allowed,
      v_balance.credits_used_raw + v_balance.credits_reserved_raw
        <= v_balance.credits_limit_raw
    );
    v_reason := coalesce(
      v_existing.metadata ->> ''shadow_reason'',
      case
        when v_allowed then null
        else ''weekly_credit_limit_exceeded''
      end
    );'
  );

  if v_replaced = v_sql then
    raise exception 'reserve_analysis_credits idempotency patch did not match function body';
  end if;

  execute v_replaced;
end;
$$;
