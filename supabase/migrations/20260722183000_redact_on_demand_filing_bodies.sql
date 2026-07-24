-- The agent may read SEC source text in memory during a run, but tool-call
-- records and citations must not become a durable copy of the source body.
-- This also redacts legacy records created before the application-level guard.

UPDATE public.tool_calls
SET
  result_summary = 'SEC filing source body read (legacy body redacted).',
  result_json = jsonb_build_object(
    'schema_version', 'on-demand-sec-body-read/v1',
    'source_body_persisted', false,
    'legacy_record_redacted', true
  ),
  result_text = NULL
WHERE tool_name IN ('read_filing_section', 'read_filing_document')
  AND (
    result_text IS NOT NULL
    OR result_json ? 'text'
  );

-- Filing MCP citations use a deterministic SEC HTML extraction trace. Their
-- quote_text is a source-body excerpt and is therefore removed as well.
UPDATE public.citations
SET quote_text = NULL
WHERE trace_json ->> 'extraction' = 'deterministic_html'
  AND trace_json ? 'filing_event_id'
  AND quote_text IS NOT NULL;

-- Worker-stream events mirror the durable tool and citation audit trail. Keep
-- their structural payloads, but remove the same source excerpts and tool
-- summaries from historical events.
UPDATE public.agent_run_events
SET payload = payload - 'quote_text'
WHERE event_type = 'citation'
  AND payload -> 'trace_json' ->> 'extraction' = 'deterministic_html'
  AND payload -> 'trace_json' ? 'filing_event_id'
  AND payload ? 'quote_text';

UPDATE public.agent_run_events AS event
SET payload = jsonb_set(
  event.payload,
  '{result_summary}',
  to_jsonb('SEC filing source body read (legacy body redacted).'::text),
  true
)
WHERE event.event_type = 'tool_call_end'
  AND EXISTS (
    SELECT 1
    FROM public.tool_calls AS tool_call
    WHERE tool_call.run_id = event.run_id
      AND tool_call.tool_use_id = event.payload ->> 'tool_call_id'
      AND tool_call.tool_name IN ('read_filing_section', 'read_filing_document')
  );
