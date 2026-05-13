-- Promote research artifacts from temporary brief cards to canonical KRW artifacts.

ALTER TABLE research_artifacts
  ADD COLUMN IF NOT EXISTS artifact_version TEXT NOT NULL DEFAULT 'krw-artifact/v1',
  ADD COLUMN IF NOT EXISTS tickers TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS source_scope JSONB,
  ADD COLUMN IF NOT EXISTS answer_alignment JSONB,
  ADD COLUMN IF NOT EXISTS artifact_json JSONB;

ALTER TABLE research_artifacts
  DROP CONSTRAINT IF EXISTS research_artifacts_type_check;

UPDATE research_artifacts
SET artifact_type = CASE artifact_type
  WHEN 'company_snapshot' THEN 'company_overview'
  WHEN 'timeline' THEN 'filing_timeline'
  WHEN 'evidence_chain' THEN 'evidence_path'
  WHEN 'research_brief' THEN 'company_overview'
  ELSE artifact_type
END
WHERE artifact_type IN (
  'company_snapshot',
  'timeline',
  'evidence_chain',
  'research_brief'
);

ALTER TABLE research_artifacts
  ALTER COLUMN artifact_type SET DEFAULT 'company_overview';

UPDATE research_artifacts
SET blocks_json = jsonb_build_array(
  jsonb_build_object(
    'type', 'key_takeaways',
    'title', '핵심 요약',
    'items', jsonb_build_array(
      jsonb_build_object(
        'label', '요약',
        'text', COALESCE(NULLIF(summary, ''), '분석 요약'),
        'confidence', 'indirect'
      )
    )
  )
)
WHERE artifact_json IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(blocks_json) AS block
    WHERE block->>'type' IN (
      'key_takeaways',
      'metric_grid',
      'period_delta',
      'business_segments',
      'premise_card',
      'impact_channels',
      'risk_driver_map',
      'timeline',
      'comparison',
      'evidence_chain',
      'caveats',
      'glossary'
    )
  );

UPDATE research_artifacts
SET quality_json = jsonb_build_object('overall', 'medium', 'warnings', '[]'::jsonb)
WHERE quality_json IS NULL
   OR NOT (quality_json ? 'overall')
   OR NOT (quality_json ? 'warnings');

UPDATE research_artifacts
SET artifact_json = jsonb_build_object(
  'artifact_version', artifact_version,
  'artifact_type', artifact_type,
  'title', title,
  'summary', summary,
  'tickers', to_jsonb(tickers),
  'source_scope', source_scope,
  'answer_alignment', answer_alignment,
  'blocks', blocks_json,
  'evidence_refs', COALESCE(evidence_refs, '[]'::jsonb),
  'quality', quality_json
)
WHERE artifact_json IS NULL;

ALTER TABLE research_artifacts
  ADD CONSTRAINT research_artifacts_type_check CHECK (
    artifact_type IN (
      'company_overview',
      'financial_snapshot',
      'scenario_impact',
      'market_report_impact',
      'risk_review',
      'filing_timeline',
      'comparison',
      'evidence_path'
    )
  );
