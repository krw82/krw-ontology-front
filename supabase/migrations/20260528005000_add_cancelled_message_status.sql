-- Keep assistant message lifecycle aligned with cancelled agent runs.

ALTER TYPE public.message_status ADD VALUE IF NOT EXISTS 'cancelled';
