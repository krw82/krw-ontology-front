# 관심=알림 통일 (follow/alert unification) — 2026-08-20

## 문제

종목을 "따라가는" 상태가 저장소 3곳에 갈라져 있고, 진입점마다 쓰는 곳이 달라 사용자 예상과 실제 동작이 어긋난다.

- 관심종목(`user_company_marks`): free 3 / 유료 무제한. Pulse 개인화·이어보기·관심종목 페이지가 소비.
- 공시·뉴스 알림 구독(`user_filing_subscriptions`): 20개 제한(플랜 무관), SEC CIK 필요. 푸시 fanout(공시+market issue)이 소유한 유일한 알림 소스.
- 뉴스 피드 팔로우(market issue follow): 피드 개인화 전용.

살아 있는 진입점은 4곳(챗 답변 CTA=이미 3개 전부 기록 / 챗 헤더·기업 페이지·관심종목 페이지=관심만 기록). 알림 전용 UI 2개(`CompanyFilingSubscriptionControl`, `FilingSubscriptionList`)는 렌더되는 곳이 없는 고아.

알림 설정 카드 카피는 이미 "관심기업을 추가하면 새 소식을 알려드릴게요"라고 약속하고 있어, 카피와 데이터가 불일치한다.

## 정책 결정

- **관심 버튼 하나 = 알림.** 관심 ON은 관심종목 + 공시 구독 + 뉴스 팔로우를 함께 기록하고, OFF는 전부 해제한다. "알림만 따로 끄기" 토글은 만들지 않는다.
- **한도는 기존 관심종목 체계를 그대로 따른다**: free 3 / 유료(lite+) 무제한. `MAX_FILING_SUBSCRIPTIONS_PER_USER=20` 상수는 삭제하고 구독 생성은 관심 마킹 성공 뒤에만 일어나므로 자연히 같은 한도를 공유한다. pricing 페이지의 "관심 기업 3개 저장" 카피가 곧 알림 정책 카피가 된다("새 소식 알림 포함" 문구만 추가).
- 저장소 3개는 유지한다(파이프라인이 각각 소비). 통일은 "쓰기를 한 곳에 모으는 것"으로 달성한다.

## 아키텍처

### 서버 통합 엔드포인트 `PUT/DELETE /api/companies/[ticker]/follow`

PUT 순서(부분 실패 관용):
1. 인증 + `requireIndexedTicker`
2. `setCompanyCoverageLevelWithEvent("interest")` — 한도 초과 시 `CoverageLimitError`를 `{code:"limit_reached", plan_limit}` 409로 반환(업그레이드 유도용)
3. 구독 생성(기존 filing-subscriptions PUT 로직을 lib 함수로 추출해 재사용). 422(SEC 식별자 없음)는 실패가 아니라 `alerts:"no_sec_id"`
4. 뉴스 팔로우 ON(best-effort)
5. 마일스톤(`first_company_followed`, `first_filing_subscription`) 유지

응답: `{ mark, alerts: "on"|"no_sec_id", news_follow: boolean }`

DELETE: coverage null(기존 RPC 통과 — monitoring_rules 동작 불변) + 구독 disable(기존 DELETE 로직 재사용) + 뉴스 팔로우 OFF.

기존 엔드포인트(`/api/watchlist/[ticker]`, `/api/filing-subscriptions/[ticker]`)는 다른 소비자(settings 카드의 목록 GET 등)를 위해 유지.

### 클라이언트 훅 `useCompanyFollow(ticker)`

- 상태 조회: 기존 `/api/watchlist/[ticker]/coverage-level` 재사용
- 토글: 통합 엔드포인트 호출 + 낙관적 업데이트
- 푸시 정책(챗 CTA 로직 그대로 공용화): 기기 구독 완료면 무반응, 권한 미결정이면 관심 ON 1회만 프롬프트, 거부됐으면 조용히 통과, iOS 비설치는 홈 화면 추가 안내
- 409 수신 시 컴포넌트에 `limit_reached` 상태 노출(업그레이드 유도 렌더는 각 표면 담당)

### 진입점 교체

| 표면 | 변경 |
|---|---|
| 챗 답변 CTA (`ChatAnswerFollowCta`) | 훅으로 리팩터(동작 보존) + 409 업그레이드 상태 추가 |
| 챗 헤더 (`ChatWatchlistHeaderActions`) | PATCH → 통합 엔드포인트 |
| 기업 페이지 (`CompanyWatchlistActions`) | PATCH → 통합 엔드포인트 |
| 관심종목 페이지 해제 (`WatchlistHomeClient`/`WorkspaceClient`) | PATCH(null) → 통합 DELETE |
| 고아 2개 | 삭제 |

### 분석

기존 이벤트 이름 재사용(`company_followed`/`company_unfollowed`/`filing_subscription_created`/`filing_subscription_removed` + surface 파라미터). 신규 이벤트 없음 → allowlist 마이그레이션 불필요. 단, 관심 추가가 전부 구독을 동반하게 되므로 `filing_subscription_created` 발생량이 구조적으로 증가한다(퍼널 해석 시 배포 시점 표시).

## 마이그레이션

`reconcile_user_company_coverage_limit`이 초과 관심을 해제할 때 공시 구독도 disable하도록 수정(현재는 구독이 남아 "관심에서 사라진 종목의 알림"이 계속 오는 좀비 상태 — 기존 버그의 수정). `disabled_at` 기록, `enabled=false`만 세팅(row는 유지 — resolveFilingAccess의 과거 공시 접근 보존).

## 백필 (배포 후 prod 실행, scripts/)

- 구독만 있고 관심 없는 유저: 관심 마킹 백필(free는 최신 3개까지만)
- 관심만 있고 구독 없는 유저: 구독 생성(SEC 식별자 있는 경우만). 단 `enabled=false` 이력(명시적 알림 끔)이 있으면 스킵
- 양쪽 모두에 뉴스 팔로우 백필
- prod 적용은 pooler 접근 런북 참조

## 제외 항목 (2차)

- `delivery_mode` 신규값 "끔(관심만)" — CHECK 제약 마이그레이션 2곳 필요한 독립 기능. 1차 출시 후 소음 민원 확인 후 추가.

## 테스트

- 통합 엔드포인트 라우트 테스트(성공/no_sec_id/409 한도/미인증/origin 검증)
- 훅 토글 + 409 상태 테스트
- reconcile 마이그레이션: 강등 시 구독 disable 검증
- 기존 4개 표면 컴포넌트 테스트 갱신

## 롤아웃 순서

1. 통합 엔드포인트 + 훅 + 챗 CTA 리팩터(동작 보존)
2. 나머지 진입점 교체 + 고아 삭제
3. reconcile 마이그레이션 + pricing 카피
4. 백필 스크립트 (prod 직접 실행)

## 실행 결과 (2026-08-20, feat/follow-alert-unification)

- 태스크 1~10 전부 구현·커밋 (f2cdf02 → 0b9b7ee, 게이트 수정 11a81a7)
- 검증: `npm run typecheck` 0 에러, 린트는 main에도 있던 FilingInbox 사전결함 1개만, `npx vitest run` 319 파일 / 1397 테스트 전부 통과
- reconcile 마이그레이션 로컬 DB 실증: 4개 관심+구독 → limit 3 강등 시 최저우선순위 종목의 관심·구독이 함께 해제되고 나머지 불변 (롤백 검증)
- 백필 스크립트 dev 적용 검증: 관심만 있던 3건 구독 생성, 구독→관심 방향 대상 0건. **prod 미실행** — 배포 후 pooler 런북대로 dry-run → --apply
- 예외: 진입점 5곳으로 확대(스펙 4곳 + 온보딩 FirstValueFilingActions 발견), pricing 표가 전 플랜 "기업 3개"로 되어 있던 과거 카피 오류를 free 3/유료 무제한으로 바로잡음
- 남은 것: prod 배포(마이그레이션 포함) → prod 백필 → 2차 delivery_mode "끔(관심만)" 옵션

## PROD 반영 (2026-08-21)

- main 병합(9ba78a4) + 푸시 → `npm run prod:deploy:full -- --agent-provider glm` → **release 20260820T150226Z-91559f42** sealed·activated·open (12단계, 0 스킵)
- 라이브 검증: `PUT /api/companies/AAPL/follow` 익명 Origin 없음 403 / Origin 있음 401 — 라우트·가드 정상. pricing 카피 라이브 반영 확인
- 배포 컨트롤러는 agent 저장소 마이그레이션만 적용(`applied_migrations: []`)하므로, 이 저장소 SQL은 pooler 런북대로 **직접 적용**: reconcile 함수 재정의 + schema_migrations 등록(20260820120000), prod 함수 본문에 구독 해제 포함 확인
- **prod 백필 적용**: 구독→관심 1건, 관심→구독 13건(관심만 있던 유저가 알림 확보), CIK 미해결 스킵 2건. 재드라이런 0건으로 멱등 확인
- 2차 후보만 남음: delivery_mode "끔(관심만)" 옵션


