# CIK-first SEC 공시 알림 운영 계획

## 결정

추적 CIK 수가 작은 현재 단계에서는 전체 8-K·6-K RSS를 수집하지 않는다.
활성 구독 CIK마다 `data.sec.gov/submissions/CIK##########.json`의 `filings.recent`만
서버 worker에서 조회한다. 이는 브라우저 CORS에 의존하지 않으며, 하나의 CIK를
여러 사용자가 추적해도 한 번만 읽고 fan-out할 수 있다.

문서 전문·벡터 인덱스·LLM 분석은 이 흐름에 포함하지 않는다. 저장하는 것은
공시 메타데이터, 첨부 목록, 짧은 키워드 일치 문맥, 사용자 상태뿐이다.

## 처리 흐름

```text
활성 구독 CIK
  → lease를 가진 due-poll claim
  → submissions JSON
  → accession_number 멱등 upsert
  → 8-K Item / 6-K 메타데이터 규칙 분류
  → 구독·사용자 규칙 fan-out
  → 공시함 기록
  → 긴급 즉시 또는 10분 묶음 / 일간 리캡 outbox
  → service worker push 및 receipt
```

`filings.recent` 전체를 매 poll에서 accession 기준으로 다시 대조하므로, 정상
poll 자체가 최근 제출분의 반복 reconciliation 역할을 한다. 최초 poll은 과거
공시를 저장하지만 알림을 만들지 않는다.

## 단계별 출시

1. **DB** — 모든 `20260714…`, `20260715…` migration을 적용한다.
2. **Shadow detection** — `FILING_DETECTION_ENABLED=1`, 나머지 두 feature flag는
   `0`으로 둔다. worker heartbeat, CIK poll success, 탐지 지연을 확인한다.
3. **Inbox** — `FILING_NOTIFICATION_CREATION_ENABLED=1`을 켜고, 신규 가입자 한
   명으로 90일 history와 baseline 무푸시를 확인한다.
4. **Push** — VAPID 키와 `SEC_USER_AGENT`를 설정한 뒤 `FILING_PUSH_ENABLED=1`을
   켠다. 실제 기기에서 테스트 푸시 receipt를 확인한다.
5. **Retention** — keyword, digest, RSS/ICS, 정정 비교는 같은 테이블·worker 위에서
   점진적으로 노출한다. 실험은 `docs/experiments/filing-retention.md` 순서를 따른다.

## 필수 환경값

- `SEC_USER_AGENT`: 회사명과 연락처가 있는 SEC 공정 접근 식별자
- `FILING_NOTIFICATION_WORKER_ID`
- `SEC_CIK_POLL_INTERVAL_MS` (기본 5분)
- `SEC_FILING_POLL_BATCH_SIZE` (기본 10)
- `SEC_FILING_REQUEST_DELAY_MS` (기본 650ms)
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- `FILING_DETECTION_ENABLED`, `FILING_NOTIFICATION_CREATION_ENABLED`,
  `FILING_PUSH_ENABLED`
- `FILING_TICKER_PUSH_BATCH_WINDOW_MS` (기본 10분)
- `FILING_RETENTION_CLEANUP_INTERVAL_MS` (기본 24시간)

## 운영 인수 기준

- 활성 CIK 하나를 구독하면 poll state와 최근 공시가 생성된다.
- 최초 backfill은 공시함/푸시를 만들지 않고, `/filings`의 최근 공시 예시로만 보인다.
- 신규 8-K·6-K는 한 번만 fan-out된다.
- 404/410 push endpoint는 즉시 revoked 처리된다.
- `push_provider_accepted`, `sw_push_received`, `notification_show_called`,
  `notification_clicked`를 서로 다른 단계로 집계한다.
- 보존 작업은 전송 기록 30일, 알림함 90일, 고아 공시 메타데이터 180일을 지킨다.
- 정정 비교와 키워드 검색은 사용자가 상세를 열거나 새 공시가 들어온 순간의 SEC
  원문만 사용하며, 전문을 DB에 저장하지 않는다.

## 롤백

feature flag를 먼저 `0`으로 내려 검출, 알림 생성, push를 독립적으로 멈춘다.
이미 기록한 공시함과 사용자 설정은 삭제하지 않는다. DB migration은 additive이므로
기능 off 상태에서도 기존 research 제품에는 영향을 주지 않는다.
