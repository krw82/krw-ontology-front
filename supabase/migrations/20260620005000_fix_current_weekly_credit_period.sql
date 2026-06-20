-- Avoid ambiguous OUT-parameter references inside current_weekly_credit_period.

create or replace function public.current_weekly_credit_period(
  p_credit_anchor_at timestamptz,
  p_now timestamptz,
  out period_start timestamptz,
  out period_end timestamptz
)
language plpgsql
stable
as $$
declare
  v_week_index bigint;
  v_period_start timestamptz;
begin
  if p_credit_anchor_at is null then
    raise exception 'credit_anchor_at is required';
  end if;

  v_week_index := greatest(
    floor(extract(epoch from (p_now - p_credit_anchor_at)) / 604800)::bigint,
    0
  );
  v_period_start := p_credit_anchor_at + (v_week_index * interval '7 days');
  period_start := v_period_start;
  period_end := v_period_start + interval '7 days';
end;
$$;
