-- Keep Form 4 in the personal update inbox, but avoid interrupting users for
-- small reported open-market trades by default. The threshold applies only to
-- immediate push delivery; users can set 0 to opt back into every P/S trade.

alter table public.filing_notification_preferences
  add column if not exists form4_immediate_min_value_usd numeric not null default 1000000;

alter table public.filing_notification_preferences
  drop constraint if exists filing_notification_preferences_form4_immediate_min_value_usd_check,
  add constraint filing_notification_preferences_form4_immediate_min_value_usd_check
    check (form4_immediate_min_value_usd >= 0 and form4_immediate_min_value_usd <= 100000000);
