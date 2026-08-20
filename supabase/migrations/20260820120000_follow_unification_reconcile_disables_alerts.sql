-- 관심=알림 통일(2026-08-20): 관심이 reconcile(플랜 강등 등)로 해제되면
-- 공시·뉴스 알림 구독도 함께 끈다. 이전에는 구독이 남아 관심목록에서
-- 사라진 종목의 알림이 계속 배달되는 좀비 상태가 있었다.
-- 설계: docs/plans/2026-08-20-follow-unification-plan.md
--
-- reconcile_user_company_coverage_limit을 재정의하며, demotion 루프의
-- monitoring_rules disable 직후에 구독 해제를 추가한다(나머지 본문은
-- 20260721000000_unify_company_coverage_interest.sql과 동일).

create or replace function public.reconcile_user_company_coverage_limit(
  p_user_id uuid,
  p_active_limit integer,
  p_preferred_ticker text default null
)
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_preferred_ticker text := upper(trim(coalesce(p_preferred_ticker, '')));
  v_mark public.user_company_marks%rowtype;
  v_previous_coverage_level text;
  v_event_id uuid;
  v_cleared_tickers text[] := '{}'::text[];
begin
  if p_user_id is null or p_active_limit is null or p_active_limit < 0 then
    raise exception 'invalid coverage reconciliation' using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 734251));

  for v_mark in
    select mark.*
    from public.user_company_marks mark
    where mark.user_id = p_user_id and mark.coverage_level is not null
    order by
      case when mark.ticker = v_preferred_ticker then 0 else 1 end,
      mark.priority desc,
      coalesce(mark.last_activity_at, mark.updated_at) desc,
      mark.ticker
    offset p_active_limit
  loop
    v_previous_coverage_level := v_mark.coverage_level;
    update public.user_company_marks mark
    set coverage_level = null,
        coverage_cleared_at = now(),
        last_activity_at = now(),
        updated_at = now()
    where mark.user_id = p_user_id and mark.ticker = v_mark.ticker
    returning * into v_mark;

    update public.user_company_monitoring_rules rule
    set enabled = false, updated_at = now()
    where rule.user_id = p_user_id and rule.ticker = v_mark.ticker and rule.enabled;

    update public.user_filing_subscriptions sub
    set enabled = false,
        disabled_at = now()
    where sub.user_id = p_user_id
      and sub.ticker = v_mark.ticker
      and sub.enabled;

    v_event_id := gen_random_uuid();
    insert into public.user_company_coverage_events (
      id, user_id, ticker, previous_coverage_level, coverage_level, event_type,
      changed, source, idempotency_key, request_payload, response_payload
    ) values (
      v_event_id, p_user_id, v_mark.ticker, v_previous_coverage_level, null,
      'plan_reconciliation', true, 'plan_reconciliation',
      'plan-reconcile:' || v_event_id::text,
      jsonb_build_object(
        'ticker', v_mark.ticker,
        'coverage_level', null,
        'source', 'plan_reconciliation',
        'active_limit', p_active_limit
      ),
      jsonb_build_object(
        'mark', to_jsonb(v_mark),
        'event_id', v_event_id,
        'previous_coverage_level', v_previous_coverage_level,
        'coverage_level', null,
        'changed', true,
        'idempotent_replay', false,
        'reconciled', true
      )
    );
    v_cleared_tickers := array_append(v_cleared_tickers, v_mark.ticker);
  end loop;
  return v_cleared_tickers;
end;
$$;
