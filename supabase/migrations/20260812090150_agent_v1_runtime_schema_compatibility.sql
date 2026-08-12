-- Keep the product database compatible with the current agent runtime ABI.
-- Older product migrations named the rendered answer hash
-- `rendered_message_hash`; the runtime's typed projection also requires the
-- validated `final_output_hash` field.  This bridge is local/product-owned
-- and does not alter the ontology schema.

begin;

alter table if exists agent_store.answer_bundles
  add column if not exists final_output_hash text;

do $$
begin
  if to_regclass('agent_store.answer_bundles') is not null
     and to_regclass('agent_store.answer_bundles') is not null
     and exists (
       select 1
         from information_schema.columns
        where table_schema = 'agent_store'
          and table_name = 'answer_bundles'
          and column_name = 'rendered_message_hash'
     ) then
    update agent_store.answer_bundles
       set final_output_hash = rendered_message_hash
     where final_output_hash is null;
  end if;
end
$$;

alter table if exists agent_store.answer_bundles
  alter column final_output_hash set not null;

do $$
begin
  if to_regclass('agent_store.answer_bundles') is not null
     and not exists (
       select 1
         from pg_constraint
        where conrelid = 'agent_store.answer_bundles'::regclass
          and conname = 'answer_bundles_final_output_hash_check'
     ) then
    alter table agent_store.answer_bundles
      add constraint answer_bundles_final_output_hash_check
      check (final_output_hash ~ '^sha256:[0-9a-f]{64}$');
  end if;
end
$$;

commit;
