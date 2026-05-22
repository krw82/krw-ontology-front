# KRW Ontology 분석 KPI 및 추적 체계

*최종 업데이트: 2026-05-23*

---

## 1. 분석 체계 원칙

### 1.1 핵심 철학

1. **Supabase 단일 스택:** 외부 분석 벤더 없이 Supabase 기반으로 모든 이벤트 추적
2. **행동 중심:** 페이지뷰가 아닌 사용자 행동 이벤트에 집중
3. **퍼널 기반:** 가입→활성화→전환→유지 퍼널로 정의
4. **의사결정 지향:** 분석은 행동으로 이어져야 함
5. **프라이버시 존중:** 질문 원문은 분석에 저장하지 않음 (길이, 카테고리만)

### 1.2 분석 아키텍처

```
클라이언트 이벤트 → Supabase analytics_events → SQL 뷰/함수 → 대시보드
서버 이벤트(결제 등) → Supabase analytics_events → SQL 뷰/함수 → 대시보드
```

---

## 2. 핵심 KPI 대시보드

### 2.1 North Star Metric

**월간 활성 분석 사용자 (Monthly Active Analysts, MAA)**

정의: 해당 월에 최소 1회 이상 `answer_completed` 이벤트가 있는 사용자 수

### 2.2 핵심 지표 체계

| 계층 | 지표 | 정의 | 목표 |
|------|------|------|------|
| **North Star** | MAA | 월간 분석 완료 사용자 | 추이 상승 |
| **획득** | 신규 가입자 | 월간 `login_completed` (신규) | 월 10% 증가 |
| **활성화** | 활성화율 | 가입 후 활성화 달성 비율 | > 50% |
| **전환** | 유료 전환율 | Free → Pro/Power 전환 | > 5% |
| **유지** | MRR Retention | 월간 유료 유지율 | > 95% |
| **수익** | MRR | 월간 반복 수익 | 지속 증가 |

### 2.3 대시보드 구성

**경영 대시보드 (주간 업데이트):**
- MAA 추이 (주간/월간)
- MRR 및 ARR
- 유료 전환율
- 해지율
- 주간 활성 사용자 (WAU)

**제품 대시보드 (실시간):**
- 퍼널 전환율 (홈→로그인→질문→답변→인용구)
- 질문당 답변 완료율
- 인용구 열기율
- 사용량 분포
- 에러율

**마케팅 대시보드 (일간 업데이트):**
- 채널별 트래픽
- 채널별 전환율
- UTM 캠페인 성과
- 리드 마그넷 전환율

---

## 3. 핵심 이벤트 추적

### 3.1 이벤트 테이블 스키마

```sql
CREATE TABLE analytics_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  anonymous_id TEXT,
  event_name TEXT NOT NULL,
  properties JSONB DEFAULT '{}',
  path TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS 정책
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
-- 서비스 롤만 INSERT 가능
-- 인증된 사용자는 자신의 이벤트만 조회
```

### 3.2 전체 이벤트 카탈로그

#### 획득 (Acquisition)

| 이벤트 | 발생 시점 | 주요 속성 |
|--------|----------|----------|
| `home_viewed` | 홈페이지 로드 | `source`, `utm_*`, `referrer` |
| `cta_clicked` | CTA 클릭 | `cta_id`, `cta_label`, `destination`, `cta_position` |
| `pricing_viewed` | 가격 페이지 조회 | `source`, `utm_*` |
| `companies_viewed` | 기업 목록 페이지 조회 | `source`, `filter` |
| `use_case_viewed` | 유스케이스 페이지 조회 | `use_case_slug`, `source` |

#### 가입/인증 (Authentication)

| 이벤트 | 발생 시점 | 주요 속성 |
|--------|----------|----------|
| `login_started` | Google 로그인 시작 | `next_path`, `source` |
| `login_completed` | 로그인 완료 | `next_path`, `is_new_user` |
| `login_failed` | 로그인 실패 | `error_reason` |

#### 핵심 제품 (Core Product)

| 이벤트 | 발생 시점 | 주요 속성 |
|--------|----------|----------|
| `starter_question_clicked` | 스타터 질문 클릭 | `question_id`, `ticker`, `category`, `position` |
| `question_submitted` | 질문 제출 | `scope_type` (global/ticker), `ticker`, `question_length`, `question_category`, `source_surface` |
| `answer_completed` | 분석 완료 | `scope_type`, `ticker`, `duration_ms`, `citation_count`, `artifact_created` |
| `answer_failed` | 분석 실패 | `ticker`, `error_type`, `error_code` |
| `citation_opened` | 인용구 열기 | `message_id`, `citation_id`, `ticker`, `citation_source` |
| `evidence_path_expanded` | 근거 경로 확장 | `message_id`, `path_depth`, `ticker` |
| `follow_up_question` | 후속 질문 | `parent_message_id`, `ticker` |

#### 사용량/플랜 (Usage/Plan)

| 이벤트 | 발생 시점 | 주요 속성 |
|--------|----------|----------|
| `usage_nudge_shown` | 사용량 넛지 표시 | `plan`, `remaining`, `total` |
| `limit_reached` | 한계 도달 | `plan`, `limit_type`, `period` |
| `paywall_shown` | 페이월 모달 표시 | `plan`, `trigger`, `suggested_plan` |
| `paywall_dismissed` | 페이월 모달 닫기 | `plan`, `trigger` |
| `upgrade_clicked` | 업셀 CTA 클릭 | `plan_from`, `plan_to`, `surface`, `trigger` |
| `feature_gated` | 소프트 게이트 노출 | `feature`, `plan` |
| `feature_gate_clicked` | 소프트 게이트 CTA 클릭 | `feature`, `plan` |

#### 결제 (Payment)

| 이벤트 | 발생 시점 | 주요 속성 |
|--------|----------|----------|
| `checkout_started` | 결제 플로우 시작 | `plan`, `billing_interval` |
| `subscription_created` | 구독 생성 | `plan`, `billing_interval`, `price_id` |
| `subscription_upgraded` | 플랜 업그레이드 | `plan_from`, `plan_to` |
| `subscription_downgraded` | 플랜 다운그레이드 | `plan_from`, `plan_to` |
| `subscription_cancelled` | 구독 해지 | `plan`, `reason`, `months_active`, `analyses_last_month` |
| `subscription_saved` | 세이브 오퍼 수락 | `plan`, `save_offer_type` |
| `payment_failed` | 결제 실패 | `plan`, `failure_reason` |
| `payment_recovered` | 결제 복구 | `plan`, `days_to_recover` |

#### 리텐션 (Retention)

| 이벤트 | 발생 시점 | 주요 속성 |
|--------|----------|----------|
| `session_started` | 세션 시작 | `days_since_last_session`, `plan` |
| `session_renamed` | 세션 이름 수정 | `session_id`, `plan` |
| `session_deleted` | 세션 삭제 | `session_id`, `plan` |
| `share_created` | 답변 공유 링크 생성 | `message_id`, `ticker`, `plan` |
| `citation_opened` | 근거/인용구 확인 | `message_id`, `ticker`, `plan` |

#### 이메일 (Email)

| 이벤트 | 발생 시점 | 주요 속성 |
|--------|----------|----------|
| `email_sent` | 이메일 발송 | `email_type`, `email_step`, `days_since_signup` |
| `email_opened` | 이메일 열기 | `email_type`, `email_step` |
| `email_clicked` | 이메일 링크 클릭 | `email_type`, `email_step`, `link_url` |

---

## 4. 퍼널 분석

### 4.1 주 퍼널: 홈 → 유료 전환

```
home_viewed
    ↓ (목표: > 15%)
cta_clicked
    ↓ (목표: > 80%)
login_completed
    ↓ (목표: > 80%)
question_submitted (첫 번째)
    ↓ (목표: > 90%)
answer_completed (첫 번째)
    ↓ (목표: > 60%)
citation_opened (첫 번째)
    ↓ (목표: > 40%)
question_submitted (두 번째)
    ↓ (목표: > 30%)
limit_reached
    ↓ (목표: > 10%)
upgrade_clicked
    ↓ (목표: > 20%)
subscription_created
```

### 4.2 퍼널 SQL 쿼리 (개념적)

```sql
-- 주 퍼널 전환율 쿼리
WITH funnel AS (
  SELECT
    user_id,
    MIN(CASE WHEN event_name = 'login_completed' THEN created_at END) AS step_login,
    MIN(CASE WHEN event_name = 'question_submitted' THEN created_at END) AS step_question,
    MIN(CASE WHEN event_name = 'answer_completed' THEN created_at END) AS step_answer,
    MIN(CASE WHEN event_name = 'citation_opened' THEN created_at END) AS step_citation,
    MIN(CASE WHEN event_name = 'limit_reached' THEN created_at END) AS step_limit,
    MIN(CASE WHEN event_name = 'upgrade_clicked' THEN created_at END) AS step_upgrade,
    MIN(CASE WHEN event_name = 'subscription_created' THEN created_at END) AS step_subscribe
  FROM analytics_events
  WHERE created_at >= date_trunc('month', now()) - interval '1 month'
  GROUP BY user_id
)
SELECT
  COUNT(*) AS total_logins,
  COUNT(step_question) AS has_question,
  COUNT(step_answer) AS has_answer,
  COUNT(step_citation) AS has_citation,
  COUNT(step_limit) AS hit_limit,
  COUNT(step_upgrade) AS clicked_upgrade,
  COUNT(step_subscribe) AS subscribed,
  ROUND(COUNT(step_question)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS login_to_question_pct,
  ROUND(COUNT(step_answer)::numeric / NULLIF(COUNT(step_question), 0) * 100, 1) AS question_to_answer_pct,
  ROUND(COUNT(step_citation)::numeric / NULLIF(COUNT(step_answer), 0) * 100, 1) AS answer_to_citation_pct
FROM funnel;
```

### 4.3 보조 퍼널

| 퍼널 | 정의 | 측정 목적 |
|------|------|----------|
| 온보딩 퍼널 | 로그인→첫질문→첫답변→첫인용구 | 활성화율 |
| 업셀 퍼널 | 한계도달→업셀클릭→결제시작→결제완료 | 전환율 |
| 리인게이지먼트 퍼널 | 이메일발송→이메일열기→클릭→재방문→분석 | 이메일 효과 |
| SEO 퍼널 | 검색유입→페이지조회→CTA클릭→가입 | SEO 효과 |

---

## 5. 코호트 분석 체계

### 5.1 가입 코호트 분석

주 단위로 가입한 사용자 그룹의 주간 리텐션 추적.

```sql
-- 주간 가입 코호트 리텐션
WITH cohort AS (
  SELECT
    user_id,
    date_trunc('week', MIN(created_at))::date AS cohort_week
  FROM analytics_events
  WHERE event_name = 'login_completed'
    AND properties->>'is_new_user' = 'true'
  GROUP BY user_id
),
activity AS (
  SELECT DISTINCT
    user_id,
    date_trunc('week', created_at)::date AS activity_week
  FROM analytics_events
  WHERE event_name = 'answer_completed'
)
SELECT
  c.cohort_week,
  a.activity_week,
  (a.activity_week - c.cohort_week) / 7 AS weeks_since_signup,
  COUNT(DISTINCT c.user_id) AS cohort_size,
  COUNT(DISTINCT a.user_id) AS active_users,
  ROUND(COUNT(DISTINCT a.user_id)::numeric / NULLIF(COUNT(DISTINCT c.user_id), 0) * 100, 1) AS retention_pct
FROM cohort c
LEFT JOIN activity a ON c.user_id = a.user_id
GROUP BY c.cohort_week, a.activity_week
ORDER BY c.cohort_week, weeks_since_signup;
```

### 5.2 활성화 코호트 비교

활성화 달성 사용자 vs 미달성 사용자의 장기 리텐션 비교.

| 코호트 | Day-7 | Day-14 | Day-30 | Day-60 |
|--------|-------|--------|--------|--------|
| 활성화 달성 | > 60% | > 45% | > 30% | > 20% |
| 활성화 미달성 | < 20% | < 10% | < 5% | < 3% |

### 5.3 플랜 코호트 분석

| 코호트 | 측정 항목 |
|--------|----------|
| Free 사용자 | 월간 질문 수, 인용구 열기율, Day-7 재방문 |
| Pro 신규 | 첫 달 사용량, 기능 활용률, 두 번째 달 유지율 |
| Power 사용자 | 월간 사용량 분포, 기능 다양성, 장기 유지 |

### 5.4 채널 코호트 분석

| 채널 | 측정 항목 |
|------|----------|
| 자연 검색 (Organic) | 가입→활성화율, 장기 리텐션 |
| 소셜 미디어 | 가입→활성화율, Day-7 재방문 |
| 이메일 | 가입→활성화율, 전환율 |
| 직접 접속 | 가입→활성화율, 유료 전환율 |
| 리퍼럴 | 가입→활성화율, 전환율 |

---

## 6. 사용자 세분화

### 6.1 행동 기반 세그먼트

| 세그먼트 | 정의 | 전략 |
|----------|------|------|
| 파워 유저 | 주 10회+ 분석, 인용구 열기율 > 50% | Power 업셀, VIP 대우 |
| 활성 유저 | 주 3-9회 분석 | Pro 유지, 기능 확장 안내 |
| 캐주얼 유저 | 주 1-2회 분석 | 사용량 증가 유도, 질문 다양화 |
| 위험 유저 | 2주+ 미접속 | 리인게이지먼트 |
| 신규 유저 | 가입 후 7일 이내 | 온보딩 집중 |

### 6.2 가치 기반 세그먼트

| 세그먼트 | 정의 | 전략 |
|----------|------|------|
| 고가치 | MRR ₩39,900, 사용량 > 80% | Power 유지, 확장 방지 |
| 중가치 | MRR ₩19,900, 사용량 > 40% | Power 업셀 |
| 저가치 | MRR ₩19,900, 사용량 < 20% | 사용량 증가, 해지 방지 |
| 무료 | Free 플랜, 활성 | Pro 전환 유도 |

---

## 7. 분석 리포트 일정

### 7.1 정기 리포트

| 리포트 | 주기 | 대상 | 내용 |
|--------|------|------|------|
| 데일리 펄스 | 일간 | 팀 전체 | 주요 지표 전일 대비 |
| 위클리 퍼널 | 주간 | 프로덕트 | 퍼널 전환율 추이 |
| 먼슬리 코호트 | 월간 | 경영진 | 코호트 리텐션, MRR |
| 쿼터리 비즈니스 | 분기 | 경영진 | ARR, LTV, CAC, ROI |

### 7.2 임시 리포트

| 트리거 | 리포트 |
|--------|--------|
| 새 캠페인 런칭 | 캠페인 성과 리포트 |
| 가격 변경 | 전환율 영향 분석 |
| 기능 출시 | 기능 채택률 리포트 |
| 이탈 급증 | 이탈 원인 분석 |

---

## 8. 분석 인프라 요구사항

### 8.1 데이터 파이프라인

```
이벤트 발생 (클라이언트/서버)
    ↓
analytics_events 테이블 INSERT
    ↓
Supabase Realtime (실시간 대시보드용)
    ↓
Materialized View (집계 쿼리용, 시간별 갱신)
    ↓
대시보드 / 리포트
```

### 8.2 Materialized View 예시

```sql
-- 일별 사용자 요약
CREATE MATERIALIZED VIEW daily_user_summary AS
SELECT
  user_id,
  created_at::date AS date,
  COUNT(CASE WHEN event_name = 'question_submitted' THEN 1 END) AS questions,
  COUNT(CASE WHEN event_name = 'answer_completed' THEN 1 END) AS answers,
  COUNT(CASE WHEN event_name = 'citation_opened' THEN 1 END) AS citations,
  COUNT(CASE WHEN event_name = 'answer_failed' THEN 1 END) AS errors,
  COUNT(DISTINCT CASE WHEN event_name = 'answer_completed'
    THEN properties->>'ticker' END) AS companies_researched
FROM analytics_events
GROUP BY user_id, created_at::date;

-- 시간별 갱신
-- SELECT cron.schedule('refresh_daily_summary',
--   '*/60 * * * *', 'REFRESH MATERIALIZED VIEW daily_user_summary');
```

### 8.3 프라이버시 가드

| 규칙 | 적용 |
|------|------|
| 질문 원문 저장 안 함 | `question_length`, `question_category`만 저장 |
| 답변 원문 저장 안 함 | `citation_count`, `duration_ms`만 저장 |
| PII 최소화 | `user_id`만, 이름/이메일은 analytics_events에 없음 |
| UTM 캐리오버 | 최초 익명 세션의 UTM을 인증 후 이벤트에 전파 |
| 보존 기간 | raw events 12개월, 집계 무기한 |

---

## 9. 실험 추적

### 9.1 A/B 테스트 추적

```sql
-- 실험 할당 이벤트
{
  "event_name": "experiment_assigned",
  "properties": {
    "experiment_id": "pricing_copy_v1",
    "variant": "control" | "treatment_a",
    "assignment_time": "2026-05-23T10:00:00Z"
  }
}
```

### 9.2 실험 분석 쿼리

```sql
-- 실험 결과 분석
SELECT
  e.properties->>'variant' AS variant,
  COUNT(DISTINCT e.user_id) AS participants,
  COUNT(DISTINCT CASE WHEN ae.event_name = 'upgrade_clicked'
    THEN ae.user_id END) AS upgrade_clicks,
  ROUND(COUNT(DISTINCT CASE WHEN ae.event_name = 'upgrade_clicked'
    THEN ae.user_id END)::numeric /
    NULLIF(COUNT(DISTINCT e.user_id), 0) * 100, 2) AS upgrade_rate
FROM analytics_events e
LEFT JOIN analytics_events ae ON e.user_id = ae.user_id
  AND ae.event_name = 'upgrade_clicked'
  AND ae.created_at > e.created_at
WHERE e.event_name = 'experiment_assigned'
  AND e.properties->>'experiment_id' = 'pricing_copy_v1'
GROUP BY e.properties->>'variant';
```

---

## 10. 체크리스트

### 분석 인프라 구현 전
- [x] 핵심 이벤트 카탈로그 정의
- [x] 퍼널 정의
- [x] 코호트 분석 체계 설계
- [x] KPI 대시보드 구성
- [ ] analytics_events 마이그레이션 생성
- [ ] RLS 정책 설정
- [ ] 클라이언트/서버 이벤트 헬퍼 구현
- [ ] Materialized View 생성
- [ ] 대시보드 UI 구현

### 분석 인프라 런칭 후
- [ ] 전체 퍼널 이벤트 검증
- [ ] 기준선 (Baseline) 지표 설정
- [ ] 첫 주간 리포트 생성
- [ ] 첫 코호트 분석 실행
