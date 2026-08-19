# 리텐션 루프 구축 계획 — "답변 → 팔로우 → 알림 → 재방문" 잇기

작성: 2026-08-19 · 대상: krw-ontology-front (+ GCP VM 워커 스택) · 기간: 2주 (D1~D12)

## 0. 배경과 기준선

8/14 이후 가입 10명 전원 가입일에만 활동(D1/D7 리텐션 0%, 체류 중앙값 <30초). 질문한 3명 중 2명은 답변을 정상 수신하고도 복귀 없음. 전 주 코호트(9명)는 3명 복귀(33%).

인프라 사용 현황(2026-08-19 프로덕션 DB 기준):

| 테이블 | 전체 사용자 기준 행 수 | 의미 |
|---|---|---|
| push_subscriptions | 2 (사용자 1명) | 푸시 구독자 사실상 0 |
| user_filing_subscriptions | 1 | 공시/뉴스 알림 구독 0 |
| market_issue_user_company_follows | 0 | 뉴스 기업 팔로우 0 |
| user_company_cards | 1 | 저장 흔적 0 |
| user_retention_milestones | 1 | 마일스톤 기록 안 됨 |

### 핵심 발견: 기계는 있고, 선이 끊어짐

**이미 완성된 것 (새로 만들 필요 없음):**
- `src/worker/filing-notification-worker.ts` — 15초 폴링 루프: SEC 공시 감지 → 관심기업 알림 팬아웃(`user_filing_notifications`) → 푸시 발송(web-push, lease/재시도/404 구독 해지 포함) → **데일리 다이제스트**(사용자별 타임존, 기본 08:30 KST, "밤사이 관심기업 업데이트 N건")
- 뉴스 이슈 팬아웃 `src/lib/filing-notifications/market-issue.ts` — 구독 티커의 검증된 이슈 → `market_issue_received` 알림, 딥링크 `/news/<issueId>`, high risk만 즉시 푸시(12h 쿨다운)
- 푸시 구독 API 전체(`/api/push/vapid`, `/api/push/subscriptions`, `/api/push/test`, `/api/push/receipts`), sw.js 푸시 수신/클릭 라우팅/배지, `pushsubscriptionchange` 자동 갱신
- 채팅 답변 끝 CTA 템플릿 `src/components/ChatAnswerSaveActions.tsx` — **만들어졌으나 어디에도 마운트 안 됨**
- 채팅 실패 재시도 `src/components/chat/RecoverableChatErrorCard.tsx` — "다시 시도" 버튼 이미 존재
- 뉴스 상세 열람 기록 `market_issue_user_states.last_seen_at` — "이어보기" 데이터로 바로 쓸 수 있음

**끊어진 3개의 선:**
1. 알림 켜기 입구가 계정 메뉴/필링 수신함深处뿐 → 신규 사용자가 도달 못 함
2. 관심기업 추가(PATCH `/api/watchlist/[ticker]`)해도 공시/뉴스 알림 구독(`user_filing_subscriptions`)이 생기지 않음 — 팔로우와 알림이 연결 안 됨
3. 답변 완료 → 다음 행동(팔로우) 유도 UI 부재

---

## Phase 0 — 프로덕션 플래그 감사 + 기준선 고정 (D1, 0.5일)

워커 기능이 env 플래그로 꺼져 있을 수 있음(기본값 `FILING_PUSH_ENABLED=0`, `FILING_NOTIFICATION_CREATION_ENABLED=0`).

```bash
# VM에서
gcloud compute ssh krw-onto-v3
cd <compose-dir> && docker compose exec filing-notification-worker env | grep -E 'FILING_|VAPID'
```

확인 항목:
- [ ] `FILING_PUSH_ENABLED=1` (꺼져 있으면 → VM `.env` 수정 + 컨테이너 재생성. VM .env가 소스 오브 트루스)
- [ ] `FILING_NOTIFICATION_CREATION_ENABLED=1`
- [ ] `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` 3종 존재
- [ ] 워커 heartbeat: `filing_notification_worker_heartbeats` 최신 행 확인
- [ ] `market-issue-worker` compose 서비스(risk fanout 담당) 실행 중인지

주의: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`는 빌드 시 클라이언트 번들에 구워짐(`AccountDeviceQuickActions.tsx:17`). 값 변경 시 `--no-cache` 재빌드 필요.

기준선 SQL(매주 월요일 재실행, Phase 5 대시보드에 동일 쿼리 사용):

```sql
-- 주간 코호트 D1/D7 리텐션 + 마일스톤 교차
WITH cohort AS (
  SELECT id, email_confirmed_at::date jd FROM auth.users
  WHERE email_confirmed_at >= date_trunc('week', current_date) - interval '1 week'
  AND email_confirmed_at < date_trunc('week', current_date)
), act AS (
  SELECT e.user_id, COUNT(DISTINCT e.created_at::date) days,
         COUNT(DISTINCT e.created_at::date) FILTER (WHERE e.created_at::date > c.jd) >= 1 returned
  FROM analytics_events e JOIN cohort c ON c.id = e.user_id GROUP BY e.user_id, c.jd
)
SELECT c.jd, COUNT(*) users, COUNT(a.user_id) active,
       COUNT(*) FILTER (WHERE a.returned) returned_any_day,
       round(100.0*COUNT(*) FILTER (WHERE a.returned)/COUNT(*),1) pct
FROM cohort c LEFT JOIN act a ON a.user_id=c.id GROUP BY c.jd;
```

---

## Phase 1 — 답변 끝 원탭 "이 기업 새 소식 받기" CTA (D2~D4) ★최우선

사용자가 답변을 완독하는 순간 = 팔로우 동기 최대 지점. 한 번의 클릭으로 (관심기업 등록 + 공시/뉴스 알림 구독 + 뉴스 팔로우 + 푸시 켜기)를 모두 수행.

### 신규 컴포넌트
`src/components/chat/ChatAnswerFollowCta.tsx`
- 템플릿: `ChatAnswerSaveActions.tsx`(미마운트 컴포넌트) 구조 재사용
- 회사 컨텍스트: `ChatPageClient`의 `latestCompletedAssistantMessage`(363-370) + `deriveChatPresentationContext`의 `headerActionTicker` / `primaryContextCompany`, 표시명은 `useChatCompanyMeta`

### 마운트 지점
`src/components/ChatMessage.tsx` 완료 브랜치(567-596) — `MessageActions`(589-594)와 동일 조건(`status==='completed' && messageId && createdAt`)으로 그 옆에 렌더. 최신 답변에만 노출하려면 `ChatPageClient.tsx` 래퍼(922-980)에서 `isLatestAssistantMessage` 전달.

### 클릭 시퀀스 (모두 성공해야 체크 표시)
1. `PATCH /api/watchlist/[ticker]` body `{coverage_level:'interest'}` — 관심기업 (이미 3곳에서 쓰는 패턴: `CompanyWatchlistActions` 참고)
2. `PUT /api/filing-subscriptions/[ticker]` — 공시+뉴스 알림 구독 생성 (preference 행 자동 seed됨)
3. `PUT /api/news/companies/[ticker]/follow` — 뉴스 기업 팔로우(현재 UI 호출자 0개인 엔드포인트. Pulse 피드 부스팅에 쓰임 `src/lib/pulse/sources/news.ts:59`)
4. 푸시 미구독 시 `subscribeCurrentDevice()`(`src/lib/filing-notifications/push-subscription-client.ts:58`) — OS 권한 프롬프트
   - iOS(PWA 미설치) 감지 시: 프롬프트 대신 "홈 화면에 추가하면 새 소식을 폰으로 받을 수 있어요" 설치 가이드 카드로 전환 (문구는 `NotificationSettingsCard` 기존 iOS 안내 재사용)

### 상태 3가지 렌더
- 미팔로우: 버튼 "이 기업 새 소식 받기" (부제: "공시·뉴스 뜨면 알려드려요")
- 진행 중: 스피너
- 완료: "팔로우 완료 · 알림 켜짐" + 설정 링크(`/settings/notifications`)

### 분석 이벤트 (`src/lib/analytics/events.ts` 클라이언트 allowlist에 신규 등록 필요)
- `cta_clicked` `{cta_id:'answer_follow_cta', surface:'chat_answer', ticker}`
- `company_followed` `{surface:'chat_answer', ticker}` (기존 이름 재사용)
- `filing_subscription_created` `{surface:'chat_answer', ticker}` (기존 이름 재사용)
- 신규 `push_opt_in_attempted` / `push_opt_in_completed` `{surface:'chat_answer'}` — 허용 목록 등록

### 서버 마일스톤 기록 (신규 헬퍼 `src/lib/retention/milestones.ts`)
`user_retention_milestones(user_id, milestone, achieved_at, metadata)` upsert — `first_answer_completed`, `first_company_followed`, `first_filing_subscription`, `push_enabled`. `answer_completed` 이벤트는 이미 존재하므로 이 시점에 서버에서 1회 기록.

### 킬스위치
`NEXT_PUBLIC_ANSWER_FOLLOW_CTA=off` env (기본 on) — props로 전달.

---

## Phase 2 — 알림 프라이밍 배너 (Pulse) + iOS 설치 유도 (D3~D5, Phase 1과 병행)

Phase 1은 "답변 본 사람"용. 답변 없이 떠나는 7할을 위한 두 번째 입구.

### 프라이밍 배너
- 위치: `src/components/pulse/PulseFeed.tsx` — `FirstValuePulseContext` 배너(1295) 스타일 그대로 참고, 피드 상단
- 패턴: `FilingInbox.tsx`의 `NotificationPermissionNudge`(~396) 로직 재사용
- 표시 조건: 관심기업 ≥1 (`GET /api/watchlist`) && `Notification.permission==='default'` && VAPID 키 존재
- 문구(한 문장 원칙 — 알림 프라이밍 실험 근거): 제목 "관심 기업의 새 소식을 폰으로 받아보세요" / 본문 "중요한 공시와 이슈만 보냅니다. 언제든 끌 수 있어요." / CTA "알림 켜기" → `subscribeCurrentDevice()` 직접 호출(설정 페이지 경유 X)
- 소거: 세션당 1회 + localStorage 노출 카운터 3회 초과 시 영구 숨김
- iOS(PWA 미설치): 알림 CTA 대신 "홈 화면에 추가" 가이드(공유 버튼 → 홈 화면에 추가 스텝 텍스트 안내) — iOS 웹 푸시는 설치 필수
- 이벤트: `cta_clicked{cta_id:'pulse_push_priming', surface:'pulse'}`, `push_opt_in_attempted/completed{surface:'pulse_priming'}`

---

## Phase 3 — 데일리 다이제스트 실가동 (D5~D8)

코드 변경 최소화 — Phase 0에서 플래그를 켜고 Phase 1에서 구독이 쌓이면 자동으로 작동하는 구조.

- 팬아웃 흐름(이미 구현됨): 관심기업 공시 → `filing_received` 알림 → `important_immediate`(기본값)면 high-risk만 즉시 푸시, 나머지는 08:30 다이제스트로 모아 발송("밤사이 관심기업 업데이트 N건" → `/filings`)
- 뉴스: `fanoutVerifiedMarketIssueNotifications`가 구독 티커 이슈 → `market_issue_received` → high risk만 즉시, 딥링크 `/news/<id>`
- 확인/조정 항목:
  - [ ] 다이제스트 기본 시간 08:30 KST 유지 (preference seed 확인)
  - [ ] 알림 과잉 방지 정책 그대로(high risk만 즉시 + 12h 티커 쿨다운) — 알림 빈도 연구 근거상 무차별 발송 금지
  - [ ] `market-issue-worker`(GCP compose)가 `runLocalNewsCycle`에서 fanout 호출하는지 로그 확인
- 트랜지션: 플래그 on 직후 첫 다이제스트가 구독자 1명에게 정상 도착하는지 receipts(`filing_push_receipts`)에서 확인 — 이 테이블이 수신/표시/클릭 3단계 영수증을 이미 기록함

---

## Phase 4 — Pulse 상단 "이어보기" 배너 (D8~D10)

재방문자의 첫 화면을 빈 피드가 아닌 "이어할 것"으로.

### 신규 API
`GET /api/pulse/resume` (`src/app/api/pulse/resume/route.ts`)
- 쿼리: `market_issue_user_states`(해당 사용자)를 `last_seen_at` desc로 최대 3건 → 각 이슈의 티커에 대해 그 `last_seen_at` 이후 발행된 `market_issues` 수(`published_at > last_seen_at`, state=published, env=prod) + 관심기업(`user_filing_subscriptions`) 한도 5건
- 응답: `[{ticker, company_name, last_issue_title, new_count, latest_issue_id}]`
- 익명/데이터 없음: 404 대신 `{items: []}` (배너 숨김)

### 컴포넌트
`src/components/pulse/PulseResumeBanner.tsx` — `PulseFeed.tsx:855` 근처(FirstValue 배너 아래) 삽입
- 문구: "지난번에 본 {회사명}, 그 이후 새 소식 {n}건" → 클릭 시 `/news/{latest_issue_id}`
- 이벤트: `resume_banner_viewed`, `resume_banner_clicked{ticker}` (events.ts 등록)

### 덤(선택, 30분)
뉴스 상세의 research 링크가 `suggested_question_clicked`를 안 남김(`MarketIssueDetail.tsx:153-177`이 plain `<a>`) — `trackClientEventSilently` 추가. 뉴스→채팅 전환율 측정의 빈 구멍.

---

## Phase 5 — 측정·마일스톤·QA (D10~D12)

### 마일스톤 정의 (우리의 "10일 안에 친구 7명")
**"가입 세션 안에 기업 1개 팔로우 + 푸시 켬"** 달성자의 D7을 미달성자와 비교. 임계치는 2주 데이터 쌓이면 상관분석으로 확정(팔로우 수 1/2/3+, 질문 수).

### 주간 리포트 SQL (Phase 0 쿼리 + 아래 교차)
```sql
-- 마일스톤 달성 여부별 D7 복귀
WITH m AS (
  SELECT user_id,
    bool_or(milestone='first_company_followed') followed,
    bool_or(milestone='push_enabled') pushed
  FROM user_retention_milestones GROUP BY user_id
)
SELECT m.followed, m.pushed, COUNT(DISTINCT c.id) users,
  COUNT(DISTINCT a.user_id) FILTER (WHERE a.returned) d7_returned
FROM cohort c JOIN m ON m.user_id=c.id LEFT JOIN act a ON a.user_id=c.id
GROUP BY 1,2;
```

### 성공 기준 (2주 후)
| 지표 | 기준선 | 목표 |
|---|---|---|
| 신규 가입 푸시 옵트인 | ~0% | ≥ 40% |
| 답변 완료자 팔로우 전환 | 0% | ≥ 50% |
| 신규 가입 D7 | 0% | ≥ 15% (팔로우+푸시 코호트 ≥ 25%) |
| 다이제스트 클릭률(receipts) | — | ≥ 10% |

### QA 항목
- [ ] 첫 질문 실패 시 재시도 동작 확인(`RecoverableChatErrorCard` — 이미 구현됨, QA만) — 8/17 MSCI 실패 이탈 재발 방지
- [ ] Android Chrome / iOS Safari(PWA 설치 전후) / macOS Chrome 3환경 푸시 E2E
- [ ] `PUT /api/filing-subscriptions/[ticker]`에 플랜 게이트(`requireMenuFeatureAccess`) 없는지 확인 — card 라우트에는 있어서 신규 무료 사용자 차단 가능성 점검

---

## 일정 요약

| 일차 | 작업 | 산출 |
|---|---|---|
| D1 | Phase 0 플래그 감사, 기준선 고정 | VM env 수정 + 리포트 SQL |
| D2~4 | Phase 1 CTA 컴포넌트+마운트+마일스톤 | 답변 끝 원탭 팔로우 |
| D3~5 | Phase 2 프라이밍 배너 + iOS 가이드 | Pulse 알림 입구 |
| D5~8 | Phase 3 다이제스트 실가동 확인 | 08:30 KST 푸시 |
| D8~10 | Phase 4 이어보기 배너 + API | 재방문 랜딩 |
| D10~12 | Phase 5 측정·QA·배포 | 주간 리포트 |

배포 순서 주의: 프론트(NEXT_PUBLIC_* 포함 → `--no-cache` 재빌드) → VM `.env` 플래그 → compose 재생성. 롤백은 env 플래그 3개(워커 2개 + CTA 1개)로 전체 비활성 가능.

## 리스크
1. **알림 스팸 → 옵트아웃**: 기본 `important_immediate` + high-risk 필터 + 쿨다운 유지. 다이제스트 클릭률 <5%면 문구/시간 조정.
2. **iOS 설치 마찰**: 한국 아이폰 비중 고려, 프라이밍 배너에서 설치 가이드 우선 노출. 설치율도 `pwa_install_prompted` 이벤트로 추적.
3. **플래그가 이미 켜져 있는데도 구독자 0명**: 인과가 "입구 부재"로 확정되므로 계획 그대로 유효.
