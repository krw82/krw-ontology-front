-- Preserve chat provenance for user-owned thesis entries saved from answers.

alter table public.user_company_theses
  add column if not exists source_chat_session_id uuid
    references public.chat_sessions(id) on delete set null,
  add column if not exists source_message_id uuid
    references public.messages(id) on delete set null;
