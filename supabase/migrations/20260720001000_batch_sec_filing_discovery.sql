-- Recording candidates one RPC at a time makes a reconciliation pass issue
-- hundreds of HTTP/database round-trips. Keep the existing per-candidate
-- atomic contract and expose a bounded batch wrapper for the worker.

create or replace function public.record_catalog_sec_filing_discoveries(
  p_candidates jsonb
)
returns table (filing_event_id uuid, inserted boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate jsonb;
  v_count integer;
begin
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'p_candidates must be a JSON array';
  end if;

  v_count := jsonb_array_length(p_candidates);
  if v_count > 100 then
    raise exception 'p_candidates must contain at most 100 candidates';
  end if;

  for v_candidate in select value from jsonb_array_elements(p_candidates) loop
    if jsonb_typeof(v_candidate) <> 'object' then
      raise exception 'each filing candidate must be a JSON object';
    end if;

    return query
    select recorded.filing_event_id, recorded.inserted
    from public.record_catalog_sec_filing_discovery(
      v_candidate ->> 'env',
      v_candidate ->> 'release_id',
      v_candidate ->> 'cik',
      v_candidate ->> 'accession_number',
      v_candidate ->> 'form_type',
      nullif(v_candidate ->> 'filing_date', '')::date,
      nullif(v_candidate ->> 'report_date', '')::date,
      nullif(v_candidate ->> 'accepted_at', '')::timestamptz,
      nullif(v_candidate ->> 'primary_document_name', ''),
      v_candidate ->> 'filing_detail_url',
      nullif(v_candidate ->> 'primary_document_url', ''),
      coalesce(v_candidate -> 'source_metadata', '{}'::jsonb),
      v_candidate ->> 'discovery_source',
      nullif(v_candidate ->> 'seen_at', '')::timestamptz
    ) as recorded;
  end loop;
end;
$$;

revoke all on function public.record_catalog_sec_filing_discoveries(jsonb) from public, anon, authenticated;
grant execute on function public.record_catalog_sec_filing_discoveries(jsonb) to service_role;

notify pgrst, 'reload schema';
