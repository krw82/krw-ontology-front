-- A Form 4 accession can appear in both the reporting owner's submissions
-- file and the issuer's submissions file. The event identity is intentionally
-- accession-scoped, so a later cross-listed CIK must not create a second event
-- or turn a healthy reconciliation pass into a retry loop. Preserve the first
-- catalog issuer mapping and silently reuse that event only for Form 4 forms;
-- every other CIK/form mismatch remains a hard data-integrity error.
--
-- The discovery function is deliberately large and was already replaced by
-- the immediately preceding ambiguity fix. Patch its single guarded branch
-- from its live definition so this migration does not fork that transaction.
do $$
declare
  v_definition text;
  v_match text := '    raise exception ''accession % conflicts with stored filing (% / %, expected % / %)'',';
  v_replacement text := E'    if v_event_form in (''4'', ''4/A'') and v_form in (''4'', ''4/A'') then\n      return query select v_event_id, false;\n      return;\n    end if;\n    raise exception ''accession % conflicts with stored filing (% / %, expected % / %)'',';
begin
  select pg_get_functiondef(
    'public.record_catalog_sec_filing_discovery(text,text,text,text,text,date,date,timestamptz,text,text,text,jsonb,text,timestamptz)'::regprocedure
  )
  into v_definition;

  if v_definition is null or position(v_match in v_definition) = 0 then
    raise exception 'record_catalog_sec_filing_discovery has an unexpected definition';
  end if;
  if position('return query select v_event_id, false;' in v_definition) > 0 then
    raise exception 'record_catalog_sec_filing_discovery already handles cross-listed Form 4 accessions';
  end if;

  v_definition := replace(v_definition, v_match, v_replacement);
  execute v_definition;
end;
$$;
