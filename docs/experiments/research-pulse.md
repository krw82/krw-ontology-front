# Research Pulse retention experiment

## 판단 기준

Pulse의 목표는 체류시간이나 스크롤 증가가 아니라 다음 유효 사건에서의 재방문과 근거 행동이다.

- 1차: 첫 `pulse_viewed` 이후 7일 안에 다시 `pulse_viewed`한 사용자 비율
- 2차: 다음 공시 사건 이후 `filing_detail_viewed` 또는 `sec_source_opened` 비율
- 보호 지표: 기존 공시 원문 열기율, negative feedback, source degraded 비율
- 비용 지표: Pulse 조회·합성으로 생성된 LLM job 및 analysis credit은 항상 0

```sql
with first_pulse as (
  select user_id, min(created_at) as first_seen_at
  from public.analytics_events
  where event_name = 'pulse_viewed' and user_id is not null
  group by user_id
), retained as (
  select first_pulse.user_id,
         exists (
           select 1
           from public.analytics_events event
           where event.user_id = first_pulse.user_id
             and event.event_name = 'pulse_viewed'
             and event.created_at > first_pulse.first_seen_at + interval '24 hours'
             and event.created_at <= first_pulse.first_seen_at + interval '7 days'
         ) as returned_within_7d,
         exists (
           select 1
           from public.analytics_events event
           where event.user_id = first_pulse.user_id
             and event.event_name in ('filing_detail_viewed', 'sec_source_opened')
             and event.created_at > first_pulse.first_seen_at
             and event.created_at <= first_pulse.first_seen_at + interval '7 days'
         ) as opened_evidence_within_7d
  from first_pulse
)
select count(*) as users,
       avg(returned_within_7d::int) as seven_day_return_rate,
       avg(opened_evidence_within_7d::int) as evidence_open_rate
from retained;
```

## 비용 경계 확인

`src/lib/pulse`는 agent, LLM gateway, 크레딧 예약 모듈을 import하지 않는다. 운영 점검에서는 Pulse 요청 시각 주변에 Pulse 원인의 agent run이나 desktop LLM job이 생기지 않았는지 확인한다. 질문 카드는 `/chat/new?...` 초안까지만 만들며 사용자가 제출해야 기존 연구 실행 경로가 시작된다.

## v2 후보·정렬 계약

Pulse는 모든 상장사의 문서를 무제한으로 훑는 화면이 아니다. 활성 온톨로지 카탈로그에 포함된 CIK의 `feed_eligible`, `ready` SEC 이벤트만 후보로 읽는다. 원문 본문은 이 경로에 넣지 않고, 사용자가 공시 상세나 채팅을 열 때만 기존 MCP/상세 경로로 가져온다.

- DB RPC는 한 요청에 긴급 80개, 우선 100개, 보유·관심·최근 리서치 기업 80개, 발견 40개로 최대 300개만 반환한다.
- 같은 이벤트가 여러 버킷에 걸리면 한 번만 남기며, 긴급 → 우선 → 개인 관련 → 발견 순으로 후보 출처를 기록한다.
- 최종 순서는 LLM 없이 `긴급성 lane → materiality + 개인 관련도 + 행동 가치 + freshness 점수 → 결정적 tie-break`로 계산한다. 보유/관심/최근 리서치는 같은 lane 안에서만 우대하므로 긴급 공시를 밀어내지 않는다.
- 첫 화면은 같은 티커를 2개 이하로 억제하고, 긴급 공시가 아닌 마지막 자리가 있으면 발견 후보 1개를 보장한다. 이 재배치는 이미 잘라낸 첫 페이지 안에서만 실행하므로 cursor 경계와 페이지 중복을 바꾸지 않는다.
- 사용자 상태는 `user_pulse_item_states`에만 저장하며, 조회는 item key 100개씩 최대 3개 병렬 요청으로 분할한다. 긴 URL로 PostgREST 414를 내는 경로를 피한다.

`/api/pulse/status`는 피드 전체를 재합성하지 않는다. 새 공시 수, 현재 진행 중인 회사 분석 수, 마지막 완료/실패 분석 수만 읽는다. 진행 중 분석은 별도 카드 영역에 계속 보이고, 새 항목 배지는 새 공시와 완료된 분석에만 붙는다.

## 출시 순서와 되돌리기

1. `20260717010000_pulse_ranked_filing_candidates_v2.sql`을 먼저 적용한다. 이 migration은 새 RPC, 부분 인덱스, PostgREST schema reload를 포함한다.
2. 새 web image를 배포한다. migration이 아직 보이지 않는 짧은 창에서는 기존 global feed RPC를 최대 300개로 제한해 fallback한다.
3. 로그인한 사용자로 `/pulse`, `/api/pulse?limit=20`, `/api/pulse/status?since=<ISO>`를 확인한다. 이전 v1/v2 cursor는 의도적으로 409을 반환하고 클라이언트가 첫 페이지를 다시 읽는다.
4. 문제 시 직전 web image로 되돌린다. migration은 additive이고 기존 global feed RPC를 삭제하지 않으므로 DB 롤백이 필요하지 않다.

알고리즘 버전, 카드 위치, reason code, 클릭·노출은 분석 이벤트에만 기록한다. 질문·노트 본문, 보유 종목의 전체 목록, rank score는 기록하지 않는다.

## 장애 기준

- 15분 구간에서 `pulse_source_degraded / pulse_viewed >= 5%`: 경고
- filing source degraded가 5분 연속: 긴급 점검
- GET `/api/pulse` p95가 500ms를 15분 연속 초과: 쿼리·후보 수 점검
- GET `/api/pulse/status` p95가 150ms를 15분 연속 초과: 상태 조회 인덱스와 RPC 계획 점검
- 전체 API 5xx가 1% 초과: 직전 정상 web image로 롤백하고 원인을 점검
- learning 또는 resurface만 문제면 해당 `PULSE_*_ENABLED=0`으로 격리

사용자 질문·노트 전문은 로그나 분석 속성에 기록하지 않는다. source 이름, 지연시간, 오류 코드만 기록한다.
