-- The GLM endpoint now identifies the physical model as glm-5.3.
-- Replace the already-installed v7 enqueue function without editing the
-- historical migration. This is a contract pin update, not an ontology or
-- table-schema change.
do $krw$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.enqueue_agent_v1_product_run_v7(jsonb)'::regprocedure
  )
    into v_definition;
  if v_definition is null or position('glm-5.2' in v_definition) = 0 then
    raise exception 'agent_v1 v7 enqueue function does not contain the previous GLM model pin';
  end if;
  execute replace(v_definition, 'glm-5.2', 'glm-5.3');
end
$krw$;
