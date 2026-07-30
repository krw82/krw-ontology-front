-- An entry may keep archived distribution history, but only one live Pulse
-- placement is allowed. Without this guard an edit/retry can produce duplicate
-- cards in the same feed refresh.
with ranked_distributions as (
  select
    id,
    row_number() over (
      partition by entry_id, channel
      order by
        case status when 'active' then 0 when 'paused' then 1 when 'draft' then 2 else 3 end,
        updated_at desc,
        created_at desc
    ) as row_number
  from public.pulse_editorial_distributions
  where status <> 'archived'
)
update public.pulse_editorial_distributions as distribution
set status = 'archived'
from ranked_distributions
where distribution.id = ranked_distributions.id
  and ranked_distributions.row_number > 1;

create unique index if not exists idx_pulse_editorial_distributions_one_live_channel
  on public.pulse_editorial_distributions (entry_id, channel)
  where status <> 'archived';
