-- Beta is no longer the default entitlement for newly created rows.
alter table public.user_entitlements
  alter column plan_key set default 'free';
