-- The browse page should not deserialize every company's documents and full
-- catalog JSON. Persist its two text summaries beside the small scalar card
-- fields so the web tier can query a narrow, release-versioned read model.

alter table public.ontology_companies
  add column if not exists browse_core_strength text,
  add column if not exists browse_critical_risk text;

create or replace function public.set_ontology_company_browse_projection()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.browse_core_strength := coalesce(
    nullif(array_to_string(array(
      select value
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(new.company_json -> 'primary_business_activities') = 'array'
            then new.company_json -> 'primary_business_activities'
          else '[]'::jsonb
        end
      )
    ), ', '), ''),
    nullif(array_to_string(array(
      select value
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(new.coverage_json -> 'core_strengths') = 'array'
            then new.coverage_json -> 'core_strengths'
          else '[]'::jsonb
        end
      )
    ), ', '), '')
  );
  new.browse_critical_risk := coalesce(
    nullif(array_to_string(array(
      select value
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(new.company_json -> 'key_external_factors') = 'array'
            then new.company_json -> 'key_external_factors'
          else '[]'::jsonb
        end
      )
    ), ', '), ''),
    nullif(array_to_string(array(
      select value
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(new.coverage_json -> 'critical_risks') = 'array'
            then new.coverage_json -> 'critical_risks'
          else '[]'::jsonb
        end
      )
    ), ', '), '')
  );
  return new;
end;
$$;

drop trigger if exists trg_ontology_company_browse_projection on public.ontology_companies;
create trigger trg_ontology_company_browse_projection
  before insert or update of company_json, coverage_json
  on public.ontology_companies
  for each row
  execute function public.set_ontology_company_browse_projection();

-- Invoke the projection trigger for every existing catalog row without
-- touching its release identity or documents.
update public.ontology_companies
set company_json = company_json;
