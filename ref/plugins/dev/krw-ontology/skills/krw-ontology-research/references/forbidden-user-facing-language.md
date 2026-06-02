# Forbidden User-Facing Language

Normal answers must not expose implementation, retrieval limits, or generic limitation boilerplate.

## Forbidden headings and phrases

Do not write:

```text
공시자료 기반 한계
공시자료 기준 한계
분석 한계
참고: 위 분석은
수치 기반의 정량적 매크로 지표보다는
질적 리스크 요인을 중심으로
이번 분석은 내부 실행 설정에 따라 진행되어
현재 조회 범위에서는
현재 도구 조회 범위에서는
근거 탐색 범위
조회 범위
세부 매출 수치가 충분히 추출되지 않았습니다
추가 확인이 가능합니다
더 자세한 분석이 필요하면
tool_budget_exceeded
budget exceeded
budget stop
tool budget
composer fallback
fallback
```

## Forbidden internal terms

Do not write:

```text
MCP
plugin
skill
agent_index
agent_index.sqlite
SQLite
JSONL
cache
schema
schema design
schema version
ontology schema
ontology quality
extraction quality
artifact
artifact contract
canonical artifact
validation report
rejected object
rejected objects
index internals
pipeline
pipeline stage
registry
build process
MCP server
MCP internals
diagnostics
object_id
quote_id
span_id
support_link_id
edge_id
trace_id
topic_id
query_context
retrieve
trace
chain
research_pack
metric_series_pack
business_profile_pack
risk_mechanism_pack
comparison_view
direct_exposure_pack
scope_guard_pack
agent_autonomy
allowed_next_tools
do_not_call
ResearchKernel
kernel
runtime setting
execution mode
EvidenceQuote
ResearchClaim
MetricObservation
XBRLFact
ExternalFactorExposure
BusinessFactor
AgreementTerm
BusinessEvent
traceable_direct
traceable_related
direct_answerable
negative_answer_supported
온톨로지 품질
스키마
스키마 설계
아티팩트
아티팩트 계약
검증 리포트
리젝트 객체
인덱스 내부
파이프라인
레지스트리
빌드 과정
MCP 내부
```

## Replacement style

Use filing-facing language:

```text
공시자료에서 확인되는 내용
공시된 수치 기준
직접 확인되는 내용은 아닙니다
관련 비용/공급망/마진 맥락은 있습니다
공시자료의 기간별 수치
사업/리스크 요인
확인된 공시 근거는 강합니다
직접적인 수치 근거는 제한적입니다
관련 압력 채널은 보이지만 직접 노출로 단정하기는 어렵습니다
확인된 공시 기준으로는 이 항목이 핵심입니다
```

## Rule

The agent may use ontology schema, quality, validation, artifact, rejected-object, index, pipeline, registry, and MCP implementation details internally to choose evidence and calibrate confidence.

If evidence is incomplete, narrow the answer. Do not add a limitation section explaining internal retrieval limits, ontology quality, schema coverage, artifact state, rejected objects, index internals, or pipeline behavior.
