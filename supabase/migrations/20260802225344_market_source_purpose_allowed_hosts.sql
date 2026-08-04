begin;

with overrides (source_key, discovery_allowed_hosts, detail_allowed_hosts) as (
  values
    ('official-ir-klac', array['ir.kla.com']::text[], array[]::text[]),
    ('official-ir-nee', array['newsroom.nexteraenergy.com']::text[], array[]::text[]),
    ('official-ir-xom', array['investor.exxonmobil.com']::text[], array[]::text[]),
    ('official-ir-hlt', array[]::text[], array['stories.hilton.com']::text[]),
    ('official-ir-emr', array['ir.emerson.com']::text[], array[]::text[]),
    ('official-ir-zm', array[]::text[], array['zoom.us']::text[])
)
update public.market_issue_sources as source
set
  adapter_config = coalesce(source.adapter_config, '{}'::jsonb)
    || jsonb_build_object(
      'discovery_allowed_hosts', to_jsonb(overrides.discovery_allowed_hosts),
      'detail_allowed_hosts', to_jsonb(overrides.detail_allowed_hosts)
    ),
  updated_at = now()
from overrides
where source.env = 'prod'
  and source.active
  and source.source_key = overrides.source_key;

commit;
