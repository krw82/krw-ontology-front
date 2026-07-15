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

## 장애 기준

- 15분 구간에서 `pulse_source_degraded / pulse_viewed >= 5%`: 경고
- filing source degraded가 5분 연속: 긴급 점검
- GET `/api/pulse` p95가 500ms를 15분 연속 초과: 쿼리·후보 수 점검
- 전체 API 5xx가 1% 초과: `PULSE_FEED_ENABLED=0`으로 즉시 롤백
- learning 또는 resurface만 문제면 해당 `PULSE_*_ENABLED=0`으로 격리

사용자 질문·노트 전문은 로그나 분석 속성에 기록하지 않는다. source 이름, 지연시간, 오류 코드만 기록한다.
