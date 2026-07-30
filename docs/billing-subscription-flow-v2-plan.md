# 구독 결제 흐름 V2 개발 계획

- 작성일: 2026-07-30
- 대상: KRW Ontology 웹 결제 설정 및 Toss Payments 자동결제
- 상태: 단일 교체 구현 및 결제 범위 로컬 검증 완료 (production 배포·원격 readiness 대기)
- 배포 방식: Billing Flow V2 한 번에 교체, 레거시 호환 경로 없음
- 전제: 전환 직전 유료 사용자와 열린 유료 구독이 모두 0명인지 DB로 재검증
- 원칙: 사용자 의도 보존, 금액 사전 동의, 중복 청구 방지, 실패 후 자동 복구

## 1. 결정

이번 작업은 `BillingPlanAction`의 “결제창 준비 중” 문구만 고치는 패치로
끝내지 않는다.

다음 네 가지를 하나의 변경으로 설계한다.

1. 화면이 구독 상태를 정확히 설명한다.
2. 돈이 청구되기 전에 실제 금액과 적용일을 확인받는다.
3. 해지·플랜 변경·갱신이 동시에 실행되어도 한 가지 사용자 의도만 반영된다.
4. 결제 후 브라우저·로그인·DB 반영에 문제가 생겨도 새 결제를 유도하지 않고
   기존 주문을 복구한다.

현재 서버에는 재사용할 기반이 있다.

- 열린 최초 결제 세션을 사용자당 하나로 제한한다.
- Toss 주문 ID와 결제 레코드를 저장한다.
- 결제 결과가 불확실하면 같은 주문을 다시 조회한다.
- 승인된 결제와 구독·권한 반영을 PostgreSQL 함수에서 처리한다.
- 승인 후 반영 실패를 billing worker가 재처리한다.

월 갱신의 확정 거절과 기간 종료 해지도 V2 범위에서 별도 SQL RPC로 묶는다.
즉, worker가 구독 원장만 먼저 `grace`/`expired`로 쓰고 권한을 나중에 바꾸는
구간을 남기지 않는다. 반대로 Toss 결과가 불확실하면 유예·만료로 바꾸지 않고
동일 `orderId`를 재조회한다.

따라서 결제 시스템을 새로 만드는 것이 아니라, 검증된 결제 기록·멱등성·복구
기반은 재사용하고 사용자 의도와 실행 순서를 V2 계약으로 교체한다.

### 단일 교체 전제

현재 결제한 사용자가 없다는 운영 전제를 활용해 다음 전환 복잡도를 만들지 않는다.

- 기존 UI와 새 UI를 동시에 운영하지 않는다.
- 기존 mutation API와 V2 operation API를 동시에 열지 않는다.
- 구·신 테이블 dual-read 또는 dual-write를 하지 않는다.
- 기존 유료 구독을 위한 변환·backfill·호환 shim을 만들지 않는다.
- canary 사용자나 점진적 활성화 단계를 두지 않는다.

개발 작업은 검토 가능한 묶음으로 나누지만, production에는 모든 묶음이 완료되고
통합 검증을 통과한 하나의 release로만 배포한다. 전환 직전 감사에서 유료 결제,
열린 유료 구독, 미확정 결제 중 하나라도 발견되면 “0명 전제”가 깨진 것이므로
자동 배포를 중단하고 해당 데이터를 먼저 조사한다.

기존 checkout session, payment, settlement, worker 복구 코드를 재사용하는 것은
레거시 호환이 아니다. 이들은 같은 주문의 중복 승인 방지와 승인 후 장애 복구를
담당하는 안전 기반이다. 반면 금액 확인 없는 즉시 청구, URL 성공 판정, 분리된
상태 갱신 같은 기존 실행 계약은 V2 배포와 동시에 제거한다.

## 2. 현재 확인된 문제

### P0. 해지 예약이 Toss 로딩 문제처럼 보인다

`src/components/BillingPlanAction.tsx`는 `cancelAtPeriodEnd`이면 모든 플랜 변경을
막지만, 현재 플랜이 아닌 카드의 문구는 “결제창 준비 중”으로 떨어진다.

사용자는 기다리거나 새로고침하면 해결될 것으로 생각하지만 실제 필요한 행동은
“계속 구독하기” 또는 “해지 예약을 취소하고 플랜 변경”이다.

### P0. 구독 조회 실패가 안전한 오류 상태가 아니라 Free처럼 처리된다

`src/app/settings/billing/page.tsx`는 구독 조회 오류를 `null`로 바꾼다.
그 결과 권한은 유료인데 구독 정보만 실패한 경우, 화면은 신규 구독 흐름을
제시할 수 있다. 서버가 새 구독을 거절하므로 바로 중복 청구되지는 않지만,
사용자는 고장 난 버튼과 잘못된 상태를 본다.

결제 상태를 읽지 못하면 모든 변경을 닫고 “구독 상태를 확인하지 못했습니다”를
보여주는 fail-closed 동작이 필요하다.

### P0. 일부 상태 변경이 두 테이블에 나뉘어 적용된다

다음 동작은 `billing_toss_subscriptions`와 `user_entitlements`를 별도 쿼리로
갱신한다.

- 해지 예약
- 다운그레이드 예약
- 다운그레이드 예약 취소
- 차액이 0원인 업그레이드

첫 번째 갱신만 성공하면 구독 원장과 실제 권한이 서로 다른 상태가 될 수 있다.
모든 무과금 변경도 하나의 PostgreSQL 트랜잭션으로 처리해야 한다.

### P0. 사용자 변경과 월 갱신이 동시에 돈을 움직일 수 있다

월 갱신 worker는 renewal lease를 사용하지만, 사용자의 업그레이드는 그 lease와
직접 조정하지 않는다. 결제일 경계에서 갱신과 업그레이드가 겹치면 서로 다른
결제 종류로 같은 구독에 요청을 보낼 수 있다.

취소와 업그레이드가 두 탭에서 겹치는 경우도 현재는 사용자 의도를 하나로
직렬화하지 않는다.

### P0. 업그레이드는 금액 확인 없이 바로 청구된다

차액은 서버에서 계산하지만 사용자가 Pro 버튼을 누르면 즉시 저장된 빌링키로
청구한다. “오늘 청구액”, “다음 결제액”, “적용일”을 서버가 산출하고 사용자가
확인한 뒤에만 결제해야 한다.

### P0. 결과 배너가 URL 문자열을 신뢰한다

현재 `/settings/billing?billing=success`만 입력해도 성공 배너를 볼 수 있다.
실제 구독 상태는 바뀌지 않지만 결제 화면에서 거짓 성공 메시지는 신뢰를 크게
해친다.

결과 화면은 URL의 `success` 문자열이 아니라 사용자가 소유한 결제 작업의
서버 상태를 조회해 표시해야 한다.

### P0. 로그인 만료 시 성공 콜백을 이어가기 어렵다

Toss 성공 콜백은 브라우저 로그인 쿠키가 없으면 `authKey`, `customerKey`,
`sessionId`를 처리하지 않고 로그인 화면으로 이동한다.

Toss가 돌려준 일회성 인증값과 사전에 만든 결제 세션을 검증해 서버가 먼저
결제를 완결한 뒤, 로그인 여부에 따라 결과 화면으로 보내야 한다.

### P0. 결제 콜백의 일회성 값이 access log에 남을 가능성이 있다

현재 Caddy는 access log를 stdout으로 기록한다. 기본 요청 URI에는 query string이
포함되므로 Toss가 전달한 `authKey`와 `customerKey`가 로그에 기록되는지 운영
환경에서 확인하고, Caddy log filter로 해당 query 값을 반드시 제거하거나
`REDACTED` 처리한다.

### P1. 갱신 실패 사용자가 결제수단을 바꿀 수 없다

`grace` 또는 `past_due` 상태에서 가장 필요한 행동은 새 구독이나 플랜 변경이
아니라 카드 변경과 미결제 재시도다. 현재 이 흐름이 없다.

### 위험별 필수 보완과 출시 차단 조건

아래 항목은 후속 개선이 아니라 전부 V2 출시 전 완료해야 하는 필수 범위다.

| 확인된 위험 | V2 보완 | 출시 차단 검증 |
| --- | --- | --- |
| 해지·다운그레이드가 두 테이블에 따로 저장됨 | subscription과 entitlement를 하나의 PostgreSQL RPC 트랜잭션으로 변경 | 한쪽 실패를 주입했을 때 둘 다 rollback |
| 월 갱신과 업그레이드가 동시에 실행될 수 있음 | operation lease, subscription version, renewal claim을 하나의 직렬화 규칙으로 통합 | 동시 실행 시 정확히 하나만 결제·상태 변경 |
| 구독 조회 실패가 Free처럼 보임 | 서버가 `unavailable`을 확정하고 모든 결제 mutation 차단 | 조회 오류에서 신규 결제 CTA와 API 모두 닫힘 |
| URL 문자열만으로 성공 배너가 표시됨 | 소유권이 확인된 operation의 서버 상태만 결과로 사용 | `?billing=success` 직접 입력 시 성공 표시 없음 |
| 콜백 중 로그인 만료 시 인증정보가 유실됨 | 로그인 쿠키와 독립된 일회성 callback token으로 서버 완료 후 clean redirect | 로그아웃 상태 콜백도 같은 주문으로 완료·복구 |
| callback 일회성 값이 access log에 남을 수 있음 | Caddy와 앱 로그에서 `authKey`, `customerKey`, `callbackToken`, callback `state` 제거 | 로그 fixture와 production 샘플에서 비밀값 0건 |
| 금액 확인 없이 업그레이드가 즉시 청구됨 | 서버 quote → 사용자 확인 → stale 재검증 → confirm 순서 강제 | 확인 전 Toss SDK·charge 호출 0건 |
| 해지 예약 중 업그레이드 실패가 사용자 의도를 훼손할 수 있음 | 결제 성공 뒤에만 plan/cancel 상태를 원자 변경 | 거절·timeout·DB 실패 시 기존 해지 예약 유지 |
| 갱신 실패 시 카드 변경 경로가 없음 | payment recovery 전용 operation과 결제수단 교체·재시도 제공 | grace/past_due에서 새 구독 없이 복구 가능 |
| 확정된 월 갱신 거절·기간 종료가 subscription과 entitlement를 따로 바꿀 수 있음 | `apply_toss_renewal_failure`, `finalize_toss_terminal_subscriptions` RPC에서 둘을 함께 변경 | grace·expired·기간 종료 해지의 원자 반영 DB 테스트 |
| 운영 설정이 `0.0.0.0:3000` 같은 로컬 origin으로 callback을 만들 수 있음 | production callback origin은 공개 HTTPS만 허용하고 readiness에서 거부 | `0.0.0.0`·localhost·HTTP origin unit/운영 점검 |

## 3. 절대 지켜야 할 결제 불변조건

1. 서버가 확정한 실제 금액을 사용자가 확인하기 전에는 청구하지 않는다.
2. 실패한 결제는 사용자의 기존 플랜, 해지 예약, 다음 결제일을 임의로 바꾸지 않는다.
3. 한 사용자에게 열린 유료 구독은 최대 하나다.
4. 한 구독에서 돈을 움직이는 작업은 어느 순간에도 최대 하나다.
5. 같은 결제 작업을 재전송해도 같은 주문을 조회하며 두 번 청구하지 않는다.
6. 결제 승인 후 앱 반영 실패는 “새 결제”가 아니라 “기존 결제 반영 재시도”로 복구한다.
7. 구독 원장이 수명주기의 기준이고 `user_entitlements`는 접근 권한 projection이다.
8. 구독 원장과 권한이 불일치하면 변경을 막고 자동 복구한다.
9. 기간 종료 전 예약 상태는 사용자가 되돌릴 수 있다.
10. 기간이 이미 종료된 구독은 재활성화하지 않고 새 구독으로 시작한다.
11. URL query는 성공·실패의 진실 공급원이 아니다.
12. `authKey`, 빌링키, customer key는 최종 브라우저 URL·분석 이벤트·access log에
    남기지 않는다. Toss 콜백의 일회성 query는 서버에서만 처리한 뒤 clean URL로
    즉시 바꾼다.

## 4. 사용자에게 보여줄 단일 상태 모델

DB enum을 그대로 화면에 노출하지 않는다. 서버에서 다음 union 형태의
`BillingPageModel`을 만든다.

| 화면 상태 | 판정 | 상단 상태 문구 | 가능한 핵심 행동 |
| --- | --- | --- | --- |
| `free` | 열린 구독 없음 | Free 이용 중 | Standard 또는 Pro 시작 |
| `active` | active (pending plan은 서버 snapshot으로 함께 전달) | 다음 결제일·금액 또는 변경 예약 | 업/다운그레이드, 해지 또는 변경 예약 취소 |
| `pending_cancel` | 기간 종료 전 해지 예약 | 해지일·그날까지 이용 가능 | 계속 구독, 다른 유료 플랜 선택 |
| `grace` | 갱신 실패 유예 | 결제 실패·복구 기한 | 결제수단 변경 |
| `past_due` | 갱신 확인 필요 | 결제 확인 필요 | 결제수단 변경 |
| `processing` | 열린 결제 작업 존재 | 결제 확인 중, 다시 결제하지 않기 | 자동 상태 확인 |
| `unavailable` | 구독 조회·정합성 실패 | 상태를 확인하지 못함 | 새로고침, 고객지원 |

판정 우선순위는 다음과 같다.

```text
상태 조회 오류 / 원장-권한 불일치
  → 열린 결제 작업
  → 열린 구독 없음
  → grace / past_due
  → pending cancel
  → active (pending plan metadata 포함)
```

모든 플랜 카드는 DB를 직접 읽지 않는다. 서버가 만든 동일한 `BillingPageModel`
상태와 subscription snapshot만 받아 CTA를 렌더링한다.

## 5. 화면 구조

상단 “내 구독” 카드가 상태의 단일 진실 공급원이 된다. 플랜 카드는 비교와
선택만 담당한다.

```text
┌──────────────────────────────────────────────────────┐
│ 내 구독                                              │
│ Standard · 월 7,900원                                │
│ 2026년 8월 30일 해지 예정                            │
│ 그날까지 Standard 기능을 계속 사용할 수 있습니다.   │
│                                                      │
│ [계속 구독하기]                    [Pro 업그레이드]   │
└──────────────────────────────────────────────────────┘

 Free                     Standard                  Pro
 무료                     현재 플랜                 월 29,000원
 비교 정보                [현재 이용 중]            [Pro 선택]
```

모든 금전·예약 변경은 기존 `BottomSheet`의 `responsive-dialog`를 재사용한
확인창을 거친다. 이 컴포넌트에는 이미 focus trap, Escape, 배경 inert,
포커스 복귀, 모바일 sheet 처리가 있다.

### 확인창 필수 정보

신규 구독:

- 오늘 결제액
- 월 자동결제임
- 다음 결제 예정일과 금액
- 선택 플랜

즉시 업그레이드:

- 현재 플랜과 변경 플랜
- 오늘 청구할 비례 차액
- 즉시 열리는 기능
- 다음 갱신일의 전체 금액

다운그레이드:

- 오늘 청구액 0원
- 정확한 적용일
- 잃게 되는 기능
- 예약 취소 가능 여부

해지:

- 추가 청구 없음
- 이용 가능한 마지막 날짜
- Free 전환 시 잃게 되는 기능
- 기존 다운그레이드 예약이 함께 사라지는지

해지 예약 취소:

- 오늘 청구액 0원
- 기존 카드와 결제일 유지
- 다음 결제일과 금액

## 6. 사용자 상황 시뮬레이션과 기대 결과

| # | 시작 상태 | 사용자 행동 | 오늘 청구 | 성공 후 상태 | 실패 후 상태 |
| ---: | --- | --- | ---: | --- | --- |
| 1 | Free | Standard 시작 | 7,900원 | active Standard | Free 유지 |
| 2 | Free | Toss 창에서 취소 | 0원 | Free 유지, 중립 안내 | 동일 |
| 3 | Free | 카드 인증 후 첫 결제 거절 | 0원 | Free 유지 | 재시도 가능 |
| 4 | Free | 결제 승인 후 DB 반영 지연 | 기존 주문 1회 | processing 후 active | 새 결제 버튼 없음 |
| 5 | Active Standard | Pro 선택 | 서버 산출 차액 | active Pro | Standard 그대로 |
| 6 | Active Pro | Standard 선택 | 0원 | pending change | Pro 그대로 |
| 7 | Pending change | 현재 Pro 선택 | 0원 | active Pro | 예약 유지 |
| 8 | Pending cancel | 같은 플랜 계속 구독 | 0원 | active, 같은 결제일 | 해지 예약 유지 |
| 9 | Pending cancel Standard | Pro 선택 | 서버 산출 차액 | 해지 취소 + active Pro | 해지 예약 유지 |
| 10 | Pending cancel Pro | Standard 선택 | 0원 | 해지 취소 + Standard 변경 예약 | 해지 예약 유지 |
| 11 | Pending change | 구독 해지 | 0원 | pending cancel, 변경 예약 제거 | 변경 예약 유지 |
| 12 | Grace | 새 카드 등록·미결제 재시도 | 갱신액 | active | grace 유지, 새 결제 금지 |
| 13 | Processing | 새로고침·다른 탭 열기 | 0원 추가 | 같은 작업 상태 조회 | 재결제 CTA 없음 |
| 14 | 해지일 도달 | 계속 구독 클릭 | 0원 | 요청 거절 후 Free/새 구독 안내 | 기존 종료 처리 |
| 15 | 모든 상태 | 구독 조회 실패 | 0원 | unavailable | 변경 API 호출 없음 |

### 동시에 발생하는 상황

다음 경합은 실제 PostgreSQL 테스트로 검증한다.

- 업그레이드 확인과 월 갱신 claim이 동시에 실행됨
- 해지와 업그레이드 확인이 두 탭에서 동시에 실행됨
- 같은 확인 요청이 두 번 전송됨
- Toss 결제 성공 응답 직후 서버 프로세스가 종료됨
- 결제는 성공했지만 finalizer 트랜잭션이 실패함
- 해지일 직전 만든 quote를 해지일 이후 확정함

승자는 정확히 하나여야 하며, 패자는 `409 state_changed` 또는 기존 작업 상태를
받아야 한다.

## 7. 목표 서버 구조

```text
Billing settings page
  └─ getBillingPageModel()
       ├─ subscription 원장
       ├─ entitlement projection
       ├─ 열린 billing operation
       └─ public plan versions

사용자 CTA
  └─ POST /api/billing/toss/quote
       └─ 서버 금액·날짜·현재 state version으로 짧은 quote 생성

확인
  └─ POST /api/billing/toss/confirm
       ├─ state version과 quote 만료 재검증
       ├─ 무과금 작업 → 단일 DB RPC
       └─ 과금 작업
            ├─ 구독 mutation lease 선점
            ├─ 기존 payment/order 생성 또는 조회
            ├─ Toss 승인
            └─ 단일 DB finalizer

결과 화면
  └─ GET /api/billing/toss/operations/:id
       └─ 사용자가 소유한 서버 상태만 표시

billing worker
  ├─ payment_uncertain 주문 재조회
  ├─ paid_pending_apply 재반영
  ├─ 만료된 operation/lease 정리
  └─ 열린 사용자 operation이 없는 구독만 월 갱신
```

## 8. DB 변경

새 migration은 forward-only로 만든다. 기존 payment/order 기록은 감사와 멱등성
때문에 보존하지만, 구 schema를 읽는 adapter나 dual-write trigger는 만들지 않는다.
operation table·제약·RPC 계약은 한 migration 묶음으로 V2 기준에 맞춘다.

### `billing_toss_operations`

필수 컬럼:

- `id`, `user_id`, `subscription_id`
- `kind`
  - `subscribe`
  - `upgrade`
  - `downgrade`
  - `cancel_plan_change`
  - `cancel_subscription`
  - `resume_subscription`
  - `replace_payment_method`
- `status`
  - `prepared`
  - `processing`
  - `awaiting_auth`
  - `payment_uncertain`
  - `paid_pending_apply`
  - `succeeded`
  - `failed`
  - `cancelled`
  - `expired`
- `from_plan_key`, `target_plan_key`
- `from_plan_version_id`, `target_plan_version_id`
- `expected_subscription_version`
- `quoted_amount_krw`
- `next_amount_krw`
- `effective_at`, `next_billing_at`
- `payment_id`, `checkout_session_id`
- `idempotency_key`
- 사용자에게 공개 가능한 `failure_code`
- `expires_at`, `confirmed_at`, `completed_at`, timestamps

민감한 provider 원문이나 빌링키는 operation 결과에 복사하지 않는다.

### `billing_toss_subscriptions`

- `state_version bigint not null default 1`
- `active_operation_id uuid null`
- `active_operation_expires_at timestamptz null`

`BEFORE UPDATE` trigger가 모든 구독 변경에서 `state_version`을 증가시킨다.
quote 확인 시 저장했던 version과 다르면 돈을 청구하지 않고 새 quote를 요청한다.
confirm이 active operation을 선점한 뒤에는 finalizer가 이전 version 대신
`active_operation_id`의 일치를 검증한다.

### `billing_toss_checkout_sessions`

- `purpose`: `initial_subscription | replace_payment_method`
- `operation_id`
- `callback_token_hash`

Toss URL에는 난수 callback token의 원문만 넣고 DB에는 hash를 저장한다.
콜백은 session ID, token, 만료, customer key, 현재 session 상태를 모두 검증한다.

### `billing_toss_payments`

- `operation_id uuid null`

결제 레코드를 만들 때 operation과 함께 연결한다. 결제 생성 직후 프로세스가
종료되어도 worker가 payment에서 원래 사용자 작업을 찾을 수 있어야 한다.

### 인덱스와 제약

- 사용자당 열린 최초 checkout session 최대 하나
- 사용자당 `processing | awaiting_auth | payment_uncertain | paid_pending_apply`
  금전 operation 최대 하나
- 구독당 active operation 최대 하나
- operation idempotency key unique
- 기존 결제의 order ID와 idempotency key unique 유지
- 열린 구독 사용자당 하나 유지

### 원자적 RPC

1. `prepare_toss_billing_operation`
2. `claim_toss_billing_operation`
3. `apply_toss_billing_no_charge_operation`
4. 기존 `finalize_toss_billing_payment`에 operation 검증·완료 처리 추가
5. `replace_toss_billing_key`
6. 만료 operation·lease 복구 RPC

무과금 동작도 subscription과 entitlement를 같은 트랜잭션에서 변경한다.

## 9. 갱신과 사용자 작업의 직렬화

quote를 열어 보기만 한 상태는 갱신을 막지 않는다.

사용자가 확인 버튼을 누를 때:

1. subscription row를 잠근다.
2. quote의 `state_version`, 플랜 버전, 기간, 금액, 만료를 다시 검사한다.
3. 진행 중인 renewal lease가 있으면 `409 renewal_in_progress`로 중단한다.
4. 유효하면 `active_operation_id`를 설정하고 operation을 `processing`으로 만든다.
5. 그 뒤에만 DB 트랜잭션 밖에서 Toss를 호출한다.

월 갱신 claim은 유효한 `active_operation_id`가 있는 구독을 제외한다.

quote 만료는 기본 30분이며 active/pending-cancel 구독에서는 현재 결제 기간 종료
시각을 넘지 않는다. 결제 기간이 끝난 뒤에는 worker가 상태를 확정하기 전까지
재개·변경을 거절하고 “갱신 확인 중” 상태로 전환한다.

## 10. 해지 예약 상태의 정확한 규칙

### 같은 플랜 계속 구독

- 기간 종료 전만 가능
- 추가 청구 없음
- `pending_cancel → active`
- `cancel_at_period_end → false`
- 기존 결제일, 빌링키, plan version 유지
- subscription과 entitlement를 한 트랜잭션에서 변경

### 해지 예약 중 상위 플랜

- 확인창에 “해지 예약 취소 + 즉시 업그레이드”를 하나의 결과로 표시
- 기존 해지 상태를 유지한 채 먼저 차액 결제
- 결제 성공 finalizer에서만 active 전환, cancel flag 제거, Pro 적용
- 결제 실패 또는 불확실 상태에서는 해지 예약을 임의로 해제하지 않음

### 해지 예약 중 하위 플랜

- 오늘 청구 없음
- 확인 후 한 트랜잭션에서 해지 예약을 해제하고 하위 플랜 변경을 예약
- 현재 플랜은 다음 결제일까지 유지

### 해지 예약 만료 후

- 기존 구독 재활성화 금지
- worker가 Free 전환과 빌링키 정리를 완료
- 새 checkout session으로 다시 구독

## 11. 결제 콜백 복구와 보안

성공 콜백은 브라우저 로그인 세션에 의존하지 않는다.

1. 사전에 저장한 checkout session과 callback token hash를 검증한다.
2. Toss가 전달한 customer key가 session 값과 일치하는지 확인한다.
3. auth key를 빌링키로 교환하고 기존 결제 주문을 처리한다.
4. 성공·불확실·실패 상태를 operation에 저장한다.
5. `/settings/billing?operation=<id>`의 clean URL로만 이동한다.
6. 로그인 세션이 만료됐으면 billing page가 operation ID만 보존한 login `next`
   경로로 보낸다. 인증값은 다시 URL에 넣지 않는다.

`authKey`를 `next` URL에 넣지 않는다.

추가 보안 작업:

- Caddy `request>uri` query filter로 `authKey`, `customerKey`, `callbackToken`, callback `state`를 redaction
- callback 응답에 `Referrer-Policy: no-referrer`, `Cache-Control: no-store`
- provider error 원문을 URL·operation 메시지에 전달하지 않고 safe error code와
  안내 문구만 저장
- 결과 페이지에서 operation 소유권 확인
- access log, app log, analytics property에 결제 식별자 원문을 넣지 않는 테스트 추가

## 12. 결제수단 변경

`grace | past_due`에서는 플랜 카드보다 “결제 복구” 카드를 먼저 보여준다.

1. 서버 quote가 미결제 금액과 grace 종료일을 반환한다.
2. 사용자 확인 후 `replace_payment_method` checkout session을 만든다.
3. Toss 카드 인증으로 새 빌링키를 발급한다.
4. 구독 원장에 새 빌링키를 원자적으로 연결한다.
5. 같은 operation에서 미결제 갱신을 즉시 재시도한다.
6. 성공하면 active로 복귀한다.
7. 카드 등록은 성공했지만 결제가 거절되면 새 카드는 유지하고 grace 상태와
   다음 재시도 시각을 정확히 안내한다.
8. 이전 빌링키는 새 키 저장이 확정된 뒤 worker가 삭제한다.

이 상태에서는 업그레이드·다운그레이드·새 구독을 제공하지 않는다.

결제 결과가 불확실한 시도는 같은 order ID를 조회한다. 카드사가 명확히 거절한
시도만 같은 결제 기간의 새 attempt와 새 order ID로 재시도한다.

사용자가 grace 상태에서 “구독 종료”를 선택하면 이후 재시도를 중단하고 즉시
Free로 전환한다. 이미 결제된 기간이 끝난 뒤의 복구 유예 상태이므로, 확인창에도
즉시 종료임을 명시한다.

## 13. API 변경

### 새 API

- `POST /api/billing/toss/quote`
  - 입력: intent, target plan
  - 출력: operation ID, 실제 금액, 적용일, 다음 결제일·금액, 사용자 안내 항목
- `POST /api/billing/toss/confirm`
  - 입력: operation ID
  - 출력: succeeded, awaiting auth, processing 중 하나
- `GET /api/billing/toss/operations/[operationId]`
  - 소유권 확인 후 안전한 상태만 반환
- 결제수단 변경도 `POST /api/billing/toss/confirm`으로 확정한다.
  - 확인된 replace operation만 Toss 인증을 시작한다.

### 기존 API

- `/checkout`, `/change-plan`, `/cancel` 직접 mutation route를 제거하여 `404`로 만든다.
- 기존 직접 mutation handler와 클라이언트 호출 코드는 같은 release에서 삭제
- 호환 adapter, delegation shim, 구·신 API 동시 운영은 하지 않음
- `/success`와 `/fail`은 operation 상태를 저장하고 clean URL로 redirect

### 오류 응답

사용자에게 다음 세 가지를 항상 제공한다.

- 무엇이 일어났는지
- 기존 구독에 어떤 영향이 있는지
- 지금 할 수 있는 행동

예:

```json
{
  "error": {
    "code": "quote_stale",
    "message": "구독 상태가 바뀌어 금액을 다시 확인해야 합니다.",
    "subscriptionUnchanged": true,
    "nextAction": "refresh_quote"
  }
}
```

## 14. 단일 교체 구현 작업 묶음

아래 순서는 개발과 검토를 위한 작업 순서일 뿐 production 활성화 단계가 아니다.
모든 작업 묶음과 테스트가 하나의 PR/release에 포함되어야 하며 일부만 먼저
production에 배포하지 않는다.

### 작업 A. 0명 전제 검증과 로그 보안

- 전환용 검사 스크립트에서 다음 값이 모두 0인지 검증
  - paid payment와 미확정 payment
  - 열린 subscription
  - 만료되지 않은 checkout session
  - 처리 중 billing operation
- 하나라도 0이 아니면 배포를 실패 처리하고 자동 수정하지 않음
- subscription과 entitlement 불일치는 별도 진단 결과로 출력하되 키·금액은 숨김
- Caddy access log에서 `authKey`, `customerKey`, callback `state` query를 redaction
- callback 응답에 `no-store`와 `no-referrer` 적용
- 운영 로그 샘플에서 기존 노출 여부를 확인하고 보존 정책에 따라 안전하게 처리
- Caddy config validate와 redaction fixture 테스트

### 작업 B. 상태 모델과 오표시 제거

- `getBillingPageModel`과 순수 `resolveBillingUiState` 추가
- subscription status, 기간, pending plan, open operation을 페이지 모델에 포함
- 구독 조회 오류를 `unavailable`로 표시하고 모든 mutation 차단
- 상단 내 구독 카드 추가
- 해지 예약을 “결제창 준비 중”으로 표시하는 fallback 제거
- URL success 문자열을 서버 결과처럼 표시하지 않도록 변경

### 작업 C. DB operation·version·원자적 변경

- V2 schema migration 적용. 기존 결제 안전 기록은 보존하지만 dual-read/write는 하지 않음
- operation table, subscription version, active operation lease 추가
- cancel, resume, schedule downgrade, cancel pending change RPC 구현
- 기존 두 테이블 분리 update 제거
- renewal claim과 사용자 operation 직렬화
- 원장과 entitlement 정합성 worker 추가

### 작업 D. quote-confirm 업그레이드와 신규 구독

- 서버 quote 생성
- responsive confirmation dialog
- confirm 시 stale quote 재검증
- upgrade payment를 operation과 연결
- pending cancel + upgrade 성공/실패 규칙 반영
- 신규 구독도 quote 확인 후 Toss SDK 실행
- 처리 중 polling 화면 추가

### 작업 E. 콜백 완료와 장애 복구

- 로그인 쿠키 없는 callback completion
- callback token 검증
- operation 기반 clean redirect
- 성공 후 반영 지연 자동 polling 및 worker repair

### 작업 F. 결제수단 변경과 grace 복구

- payment method checkout purpose
- 새 빌링키 교체
- 미결제 같은 주문/기간 재시도
- old billing key 비동기 삭제
- payment recovery UI

### 작업 G. 결제 내역과 운영 관측

- 최근 결제 금액·일자·상태·영수증 링크
- 최근 예약 변경 이력
- 실패 code별 집계
- 오래 지속되는 processing/paid-pending-apply 경보

## 15. 파일 영향 예상

재사용:

- `src/lib/billing/toss.ts`
- `src/lib/billing/billing-cycle.ts`
- `src/components/ui/BottomSheet.tsx`
- `src/lib/billing/api-rate-limit.ts`
- 기존 checkout session, payment, settlement 및 worker 복구 코드

주요 수정:

- `src/app/settings/billing/page.tsx`
- `src/components/BillingPlanAction.tsx`
- `src/lib/billing/toss-subscriptions.ts`
- `src/lib/billing/api-rate-limit.ts`
- 삭제: `src/app/api/billing/toss/checkout/route.ts`
- `src/app/api/billing/toss/success/route.ts`
- `src/app/api/billing/toss/fail/route.ts`
- 삭제: `src/app/api/billing/toss/change-plan/route.ts`
- 삭제: `src/app/api/billing/toss/cancel/route.ts`
- `src/worker/billing-worker.ts`
- `src/types/database.ts`
- `Caddyfile`
- `docs/billing-credit-contract.md`

신규 예상:

- `src/lib/billing/billing-page-model.ts`
- quote, confirm, operation status·취소 API routes
- V2 Supabase migration과 readiness assertion
- `e2e/billing.spec.ts`
- 실제 PostgreSQL RPC 경합 테스트 스크립트

구현 전 Next.js 16.2.6의 local docs에서 Route Handler, Server/Client Component,
redirect, Vitest, Playwright 가이드를 다시 읽고 현재 프로젝트 규칙에 맞춘다.

## 16. 테스트 계획

### 순수 상태 모델 테스트

표 기반으로 최소 다음 상태를 전부 검증한다.

- managed
- free
- active Standard
- active Pro
- pending downgrade
- pending cancel Standard
- pending cancel Pro
- grace
- past due
- processing
- period-end ending
- ended
- entitlement/subscription mismatch
- subscription read failure

각 행에서 다음을 검증한다.

- 상단 문구
- primary/secondary CTA
- 각 플랜 카드 label
- disabled reason
- 오늘 청구 여부

### 금액·quote 테스트

- 기간 시작, 중간, 마지막 날의 비례 차액
- 28·29·30·31일 월 경계
- quote 생성 후 가격 version 변경
- quote 생성 후 cancel 또는 plan state 변경
- quote 만료
- 결제일 60초 이내
- 0원 차액 경계

### 실제 PostgreSQL 통합 테스트

문자열 포함 여부만 검사하는 migration 테스트로는 부족하다. local Supabase
PostgreSQL에 migration을 적용한 뒤 실제 RPC를 동시에 호출한다.

- cancel은 subscription과 entitlement를 함께 바꿈
- 한 쪽 constraint 실패 시 둘 다 rollback
- 같은 operation confirm 두 번은 한 번만 적용
- cancel과 upgrade 중 하나만 active operation을 획득
- renewal claim과 upgrade confirm 중 하나만 승리
- stale state version은 청구 전 거절
- paid_pending_apply는 같은 payment로 복구
- internal entitlement는 모든 결제 mutation 차단
- RLS와 function execute 권한은 service role에만 허용

### API 테스트

- 인증, rate limit, invalid JSON
- operation 소유권
- 직접 planKey 실행 거절
- safe error mapping
- raw provider message가 URL에 없음
- callback token mismatch, 만료, replay
- 로그인 없는 success callback
- success/fail clean redirect

### UI·Playwright 테스트

Toss SDK를 mock하고 다음을 브라우저에서 검증한다.

- 금액 확인 전 SDK와 charge API가 호출되지 않음
- 해지 예약 화면에 “결제창 준비 중”이 없음
- 계속 구독 성공
- pending cancel + Pro 성공·거절
- 처리 중에는 모든 CTA가 닫힘
- focus trap, Escape, focus return
- 모바일 bottom sheet와 desktop dialog
- 새로고침·뒤로가기·두 탭에서 operation이 하나만 유지
- URL에 `billing=success`를 직접 넣어도 성공으로 확정하지 않음

### 보안·운영 테스트

- Caddy config validate
- access log fixture에 auth key, customer key, callback state가 나타나지 않음
- application log/analytics payload에 billing key가 없음
- worker 중단 후 재시작 시 payment uncertain 복구
- `BILLING_WRITES_ENABLED=0`에서 새 quote/confirm/cancel mutation은 503과 안전한
  안내를 반환하며, 이미 Toss 인증을 끝낸 callback은 인증값을 저장해 나중에 같은
  주문으로만 복구한다 (새 청구는 하지 않음).

### 필수 실행 명령

```text
npm run typecheck
npm run lint
npm run test:unit
npm run build
npm run test:e2e -- --grep "billing"
scripts/supabase-cli.sh db push --dry-run
scripts/verify-billing-production-readiness.sh
```

새 PostgreSQL 경합 테스트는 별도 `npm run billing:v2:db-test` 명령으로 실행한다.

## 17. 단일 교체 배포 계획

### production 전환 전 자동 중단 조건

배포 직전 readiness script가 production DB에서 다음을 검증한다.

- 열린 유료 구독 0건
- paid 또는 unresolved payment 0건
- 열린 checkout session과 billing operation 0건
- subscription과 entitlement 불일치 0건
- 결제 callback origin이 `https`의 공개 도메인이고 `0.0.0.0`·localhost가 아님
- migration·Caddy config·필수 테스트 통과
- 현재 release SHA와 web·worker·migration 대상 SHA 일치

한 항목이라도 실패하면 DB migration과 애플리케이션 배포를 시작하지 않는다.
“현재 결제한 사람이 없다”는 수동 판단만으로 이 검사를 건너뛸 수 없다.

### 한 번의 전환 순서

1. V2 web, worker, migration, Caddy 설정을 같은 release artifact로 확정한다.
2. production snapshot을 만들고 readiness script로 0명 전제를 다시 검증한다.
3. `BILLING_WRITES_ENABLED=0`으로 결제 mutation을 잠시 닫는다.
4. V2 schema migration을 적용한다.
5. Caddy, billing worker, web을 같은 release로 교체한다.
6. schema, callback redaction, operation 상태 조회, worker lease의 비금전 smoke test를
   수행한다.
7. 문제가 없으면 `BILLING_WRITES_ENABLED=1`로 모든 사용자에게 한 번에 연다.
8. 전용 production 계정으로 Standard 신규 결제, Pro 업그레이드, 해지·복구,
   실패 결제 복구를 즉시 확인한다.
9. 확인 중 이상이 있으면 즉시 writes를 닫고 열린 operation을 복구한다.

이 순서에는 canary, 사용자별 feature flag, 구 API fallback이 없다. writes를 잠시
닫는 것은 V2를 점진적으로 노출하는 단계가 아니라 동일 release의 원자적 전환을
보호하는 운영 잠금이다.

### emergency kill switch

`BILLING_WRITES_ENABLED`만 둔다.

- `0`: 상태와 내역은 표시하되 모든 결제·해지·플랜 변경 mutation을 차단
- `1`: V2 mutation을 전체 사용자에게 허용

사용자별 예외나 레거시 흐름 활성화 값은 만들지 않는다.

### 장애 대응과 rollback

- 가장 먼저 `BILLING_WRITES_ENABLED=0`으로 모든 새 결제 의도를 차단
- worker는 승인된 payment와 열린 operation 복구를 끝낼 때까지 유지
- operation과 payment 원장은 삭제하거나 migration down하지 않음
- 이전 즉시 청구 API나 이전 Billing UI를 다시 활성화하지 않음
- 상태 조회 화면은 유지하고 원인을 수정한 V2 release로 fix-forward
- web 자체가 동작하지 않을 때만 같은 V2 계약을 읽는 maintenance/read-only
  release로 롤백
- 열린 operation 0건, unresolved payment 0건을 확인한 뒤 writes를 다시 활성화

## 18. 운영 지표와 경보

필수 지표:

- quote 생성 대비 confirm 비율
- confirm 대비 payment success/decline/uncertain 비율
- operation별 p50/p95 완료 시간
- 2분 이상 processing 수
- 5분 이상 paid_pending_apply 수
- subscription-entitlement 불일치 수
- callback token 실패·replay 수
- 결제수단 변경 성공률
- resume 후 다음 갱신 성공률
- 동일 사용자 중복 operation 거절 수

즉시 경보:

- 동일 order ID에서 서로 다른 amount 관측
- 열린 구독 unique constraint 충돌
- paid payment가 5분 이상 미반영
- subscription과 entitlement의 plan/cancel flag 불일치
- callback query 비밀값의 로그 탐지

## 19. 완료 승인 기준

다음 조건을 모두 만족해야 단일 production 교체가 가능하다.

- 전환 직전 열린 유료 구독·paid/unresolved payment·열린 session/operation이 0건이다.
- 구 API·구 UI·dual-read/write·canary 코드가 release artifact에 없다.
- 해지 예약 상태에서 “결제창 준비 중”이 보이지 않는다.
- 구독 조회 실패 시 `unavailable`로 닫히고 Free·신규 결제로 오인되지 않는다.
- 사용자가 모든 청구액을 확인한 뒤에만 Toss 승인 요청이 발생한다.
- pending cancel + upgrade 실패 시 해지 예약이 그대로 남는다.
- 같은 요청·두 탭·worker 경합에서 결제는 한 번만 발생한다.
- 승인 후 서버 장애를 주입해도 기존 주문으로 자동 복구된다.
- 로그인 만료 상태의 Toss 성공 콜백이 결제를 잃지 않는다.
- URL 문자열만으로 성공 배너를 만들 수 없다.
- callback query 비밀값이 access log에 남지 않는다.
- 구독과 entitlement 변경이 실제 PostgreSQL 트랜잭션 테스트를 통과한다.
- grace/past_due 사용자가 새 구독 없이 결제수단 변경과 미결제 복구를 완료한다.
- writes-off 전환, snapshot, fix-forward 절차를 staging에서 한 번 리허설한다.

## 20. 이번 범위에서 제외

- 연간 결제
- 환불 자동화
- 쿠폰·프로모션
- 좌석 기반 결제
- 세금계산서 자동 발급
- Toss 외 다른 결제 provider

다만 결제 내역, 영수증 링크, 사용자 변경 이력은 V2 완료 범위에 포함한다.

## 21. 근거

- Toss Payments 자동결제는 카드 인증 후 빌링키를 발급하고, 서비스가 직접
  결제 금액과 스케줄을 관리한다.
  - https://docs.tosspayments.com/guides/v2/billing/integration
- Stripe는 기간 종료 해지를 종료 전까지 되돌릴 수 있게 하고, 플랜 변경 시
  비례 청구와 기간 종료 다운그레이드를 별도 정책으로 다룬다.
  - https://docs.stripe.com/billing/subscriptions/cancel
  - https://docs.stripe.com/customer-management/configure-portal
- Paddle도 기간 말 해지를 scheduled change로 저장하고 종료 전 제거할 수 있게 한다.
  - https://developer.paddle.com/build/subscriptions/cancel-subscriptions
- Caddy access log는 `request>uri` query filter로 민감한 query 값을 제거하거나
  대체할 수 있다.
  - https://caddyserver.com/docs/caddyfile/directives/log
- 현재 화면 및 참고 흐름:
  - `.lazyweb/quick-references/subscription-billing-state-flows-2026-07-30/report.html`
