# Session Share — Design Spec

- **Date:** 2026-08-05
- **Status:** Approved (pending user spec review)
- **Author:** brainstorming session
- **Approach:** A — 기존 `message-share.ts` 패턴 복제, 신규 테이블 분리, 최소 변경

## 1. 목적

채팅 헤더 우측 상단에 "대화 공유" 버튼을 추가한다. 버튼을 누르면 해당 세션의 모든 `completed` Q&A 스냅샷을 저장한 뒤 `/share/s/[token]` 공개 링크를 생성한다.

기존 단일 답변 공유 시스템(`message_shares`, `/share/[token]`)은 그대로 유지하며, 세션 공유는 완전히 독립된 새 시스템으로 구축한다.

## 2. 핵심 결정사항

| 결정 | 선택 | 이유 |
|------|------|------|
| 공유 범위 | 전체 자동 공유 | 최소 변경, 기존 패턴과 일치 |
| DB 스키마 | 신규 `session_shares` 테이블 (분리) | 기존 시스템 영향 0 |
| 스냅샷 내용 | 모든 `completed` Q&A | 자연스러운 리서치 대화 재생 |
| 제목/OG | 첫 `completed` 답변 제목 | `buildShareTitle()` 재사용 |
| 접근법 | A (패턴 복제) | 기존 코드 0줄 수정 |

## 3. 아키텍처

### 3.1 파일 매핑

**기존 (수정 없음 — 0줄 변경):**

```
src/lib/share/message-share.ts       # 단일 공유 리포지토리 (수정 X)
src/lib/share/share-page.ts          # 단일 공유 페이지 헬퍼 (수정 X)
src/lib/share/share-locale.ts        # locale 추론 (수정 X, import해서 재사용)
src/lib/share/share-og.ts            # OG 카피 빌더 (수정 X, import해서 재사용)
src/app/share/[token]/page.tsx       # 단일 공유 라우트 (수정 X)
src/app/api/share/messages/[messageId]/route.ts  # 단일 공유 생성 API (수정 X)
src/components/SharedAnswerPageContent.tsx       # 단일 공유 페이지 (수정 X)
```

**신규 파일:**

```
src/lib/share/session-share.ts                     # 세션 공유 리포지토리
src/lib/share/session-share-page.ts                # 세션 공유 페이지 헬퍼
src/app/api/share/sessions/[sessionId]/route.ts    # 세션 공유 생성 API (POST)
src/app/api/share/s/[token]/og/route.ts            # 세션 공유 OG 이미지 API (GET)
src/app/share/s/[token]/page.tsx                   # 세션 공유 페이지 라우트
src/app/[locale]/share/s/[token]/page.tsx          # locale-prefixed 세션 공유 페이지
src/components/SharedSessionPageContent.tsx        # 세션 공유 페이지 콘텐츠
src/components/ChatSessionShareButton.tsx          # 헤더 공유 버튼
src/lib/share/session-share.test.ts                # 리포지토리 테스트
supabase/migrations/20260805000000_session_shares.sql  # DB 마이그레이션
```

**기존 파일 수정 (유일):**

```
src/app/chat/ChatPageClient.tsx     # 헤더 actionSlot에 ChatSessionShareButton 1개 추가
src/types/database.ts               # SessionShareRow 타입 추가만
```

### 3.2 URL 구조

| URL | 용도 |
|-----|------|
| `/share/s/[token]` | 세션 공유 페이지 (한국어 기본) |
| `/[locale]/share/s/[token]` | locale-prefixed 세션 공유 페이지 |
| `/api/share/sessions/[sessionId]` | 세션 공유 생성 (POST) |
| `/api/share/s/[token]/og` | 세션 공유 OG 이미지 (GET) |

단일 공유 `/share/[token]`과 경로가 분리되어 충돌 없음.

### 3.3 재사용되는 공통 함수

다음 함수들은 기존 모듈에서 import하여 재사용 (복제하지 않음):

- `createShareToken()` (`message-share.ts:71`)
- `buildShareTitle(content, fallback?)` (`message-share.ts:75`)
- `redactSensitiveOutput()` (민감정보 마스킹)
- `sanitizeAssistantContent()` (assistant 답변 정제)
- `inferShareLocale()` (`share-locale.ts`)
- `buildSharePath()` / `buildShareCanonicalUrl()` (`share-locale.ts`)
- `buildShareOgCopy()` / `buildShareOgImageUrl()` (`share-og.ts`)
- `normalizeShareTickers()` (`message-share.ts:216`)
- `resolveShareContext()` (`message-share.ts:347`) — 첫 답변 기준
- `tokenPattern` (`share-page.ts:12`)

## 4. 데이터 모델

### 4.1 `session_shares` 테이블

```sql
CREATE TABLE session_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  tickers TEXT[],
  locale TEXT NOT NULL DEFAULT 'ko',
  messages JSONB NOT NULL,        -- 정렬된 메시지 스냅샷 배열
  message_count INT NOT NULL,
  share_context JSONB DEFAULT '{}',
  snapshot_version INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

-- 단일 공유와 동일한 인덱스 패턴
CREATE UNIQUE INDEX uq_session_shares_active_session
  ON session_shares (source_session_id)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_session_shares_token_active
  ON session_shares (token)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_session_shares_owner_created
  ON session_shares (owner_user_id, created_at DESC);

ALTER TABLE session_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE session_shares FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE session_shares TO service_role;
```

### 4.2 `messages` JSONB 구조

```ts
type SessionShareMessage = {
  role: "user" | "assistant";
  content: string;          // redactSensitiveOutput + sanitize 적용됨
  created_at: string;       // ISO timestamp
};
```

배열은 `created_at` 오름차순 정렬. `user` 질문과 그에 대응하는 `assistant completed` 답변이 쌍으로 포함됨.

**`user` 메시지 필터링 규칙:** 모든 `user` 메시지를 무조건 포함하지 않는다. `assistant completed` 답변을 기준점으로 삼고, 각 답변 바로 직전의 `user` 메시지만 질문으로 포함한다. 단, 연속된 `user` 메시지(중간에 답변 없이 여러 번 질문한 경우)는 모두 포함한다. "고마워", "좋아요" 등 답변이 없는 후속 `user` 발언은 assistant 답변이 뒤따르지 않으면 제외된다.

포함 로직 의사코드:
```
for each assistant message where status='completed':
    include this assistant message
    look backward for user messages since the previous included message:
        include all of them
```

결과적으로 스냅샷에는 항상 `[user, assistant]` 또는 `[user, user, ..., assistant]` 쌍만 포함되며, 답변 없는 `user` 단독 메시지는 포함되지 않는다. `pending`/`streaming`/`failed` 상태의 assistant 메시지도 제외된다.

### 4.3 TypeScript 타입

```ts
// src/types/database.ts에 추가
interface SessionShareRow {
  id: string;
  token: string;
  owner_user_id: string;
  source_session_id: string;
  title: string;
  tickers: string[] | null;
  locale: string;
  messages: SessionShareMessage[];
  message_count: number;
  share_context: Record<string, unknown>;
  snapshot_version: number;
  created_at: string;
  revoked_at: string | null;
}

// src/lib/share/session-share.ts
interface PublicSessionShare {
  token: string;
  title: string;
  tickers: string[] | null;
  locale: Locale;
  messages: SessionShareMessage[];
  message_count: number;
  share_context: PublicShareContext;
  created_at: string;
}
```

## 5. 컴포넌트 설계

### 5.1 `ChatSessionShareButton`

헤더 `actionSlot`에 렌더링되는 버튼. `ChatMessage.tsx:238-273`의 `handleShare` state machine을 복제.

```tsx
// 상태: idle → sharing → shared | failed | auth_required
// POST /api/share/sessions/[sessionId]
// 성공 시 navigator.share (있으면) / 클립보드 복사
// 401 → auth_required
// AbortError → idle 복귀
// transient 상태는 1800ms 후 idle로 자동 복귀
```

`ChatPageClient.tsx` 수정 지점:

```tsx
actionSlot={
  headerActionTicker && sessionId ? (
    <div className="flex items-center gap-xs">
      <ChatSessionShareButton sessionId={sessionId} />
      <ChatWatchlistHeaderActions ticker={headerActionTicker} ... />
    </div>
  ) : null
}
```

### 5.2 `SharedSessionPageContent`

`SharedAnswerPageContent.tsx`의 헤더/푸터/CTA/guru 섹션을 복제. 차이점:

- `messages` 배열을 `map`으로 타임라인 렌더링
- 각 `user` 메시지는 질문 스타일(border-l-2 primary-container), `assistant`는 `ResearchMarkdown`
- 인덱스 라벨은 `01`, `02`, `03` ... 순차 증가 (Q/A 쌍 단위)
- `SharePageEvents` 이벤트명: `session_share_viewed`, `session_share_answer_read`
- `ShareStartLink`는 동일 컴포넌트 재사용, `location: "session_share"` 전달

### 5.3 OG 이미지

`/api/share/s/[token]/og` — 기존 `/api/share/[token]/og` 패턴 복제. 첫 `completed` 답변 기반으로 `buildShareOgCopy` 호출. `Cache-Control` 동일.

## 6. 데이터 흐름

### 6.1 생성 플로우

```
1. ChatSessionShareButton 클릭 (idle → sharing)
2. POST /api/share/sessions/[sessionId]
   a. getAuthUser() → 실패 시 401 (→ auth_required)
   b. chat_sessions 로드, session.user_id === user.id 검사 (아니면 forbiddenError 403)
   c. findExistingActiveSessionShare(sessionId)
      · 존재하면 재사용 (누락된 share_context만 ensureSessionShareContextSnapshot으로 백필)
      · 없으면 createSessionShare()
   d. session_share_created 분석 이벤트 기록
3. createSessionShare():
   a. 세션의 messages 로드 (role IN ('user','assistant'), status='completed' for assistant)
   b. created_at 오름차순 정렬
   c. 각 메시지에 redactSensitiveOutput + sanitizeAssistantContent 적용
   d. 첫 completed assistant 답변으로 title = buildShareTitle(content, session.title)
   e. messages = [{role, content, created_at}, ...] 배열 구성
   f. share_context = resolveShareContext(admin, 첫 completed assistant message)
   g. locale = inferShareLocale(...)
   h. token = createShareToken()
   i. INSERT session_shares
   j. unique-violation 시 findExistingActiveSessionShare fallback
4. 응답 { token, share_url } 반환
5. 클라이언트: navigator.share 지원 시 네이티브 시트, 아니면 클립보드 복사
6. sharing → shared (1800ms 후 idle)
```

### 6.2 검증 규칙 (생성 API)

- `sessionId` UUID 형식 검증
- 인증 필수 (미인증 401)
- 세션 존재 + 소유권 (비소유 403)
- `completed` assistant 메시지가 1개 이상 (0개 시 badRequestError 400)

### 6.3 조회 플로우

```
1. /share/s/[token] 요청
2. generateMetadata:
   - getPublicSessionShareForPage(token) → null이면 noindex 메타데이터
   - 있으면 buildPublicShareMetadata (robots: noindex, OG article)
3. 페이지 렌더:
   - getPublicSessionShareForPage(token)
     · tokenPattern 검증 (/^[A-Za-z0-9_-]{16,80}$/)
     · findPublicSessionShare: revoked_at IS NULL 필터, redactSensitiveOutput 재적용(방어적)
   - null이면 notFound()
   - SharedSessionPageContent 렌더링
4. 분석: 마운트 시 session_share_viewed, 답변 끝 스크롤 시 session_share_answer_read
```

## 7. 에러 처리

기존 `message-share` 패턴을 그대로 계승:

| 케이스 | HTTP | 처리 |
|--------|------|------|
| 미인증 | 401 | 클라이언트 `auth_required` 상태 |
| 세션 비소유 | 403 | `forbiddenError` |
| `completed` 답변 0개 | 400 | `badRequestError` ("공유할 답변이 없습니다") |
| 삽입 충돌 (레이스) | — | `findExistingActiveSessionShare` fallback (`createMessageShare:210`과 동일 패턴) |
| 토큰 없음/revoked | 404 | `notFound()` |
| `navigator.share` 취소 | — | `AbortError` 무시, `idle` 복귀 |
| 잘못된 token 형식 | 404 | `tokenPattern` 불일치 → null → `notFound()` |

**취소(revoke) API는 구현하지 않음** — 기존 단일 공유와 동일 정책. `revoked_at`은 쿼리에서 필터링에만 사용되며, 폐기가 필요하면 DB 직접 조작.

## 8. 접근 제어 / 보안

기존 단일 공유(`message_shares`)와 **동일한 보안 모델**:

| 항목 | 정책 |
|------|------|
| 조회 인증 | 없음 — 토큰 소유자만 접근 가능 (토큰 = 18 랜덤 바이트) |
| 만료 | 없음 — 영구 (`expires_at` 컬럼 없음) |
| 취소 | `revoked_at` soft-delete (취소 API는 없음, DB 직접 조작) |
| 생성 권한 | 인증 + 세션 소유자만 |
| 토큰 예측 | 18 랜덤 바이트 → 사실상 불가능 |
| DB 보호 | RLS 활성화, anon/authenticated/PUBLIC 모두 REVOKE, service_role만 접근 |
| 스냅샷 불변 | 공개 조회는 원본 세션/메시지 추적 안 함 — `messages` JSONB만 읽음 |
| 민감정보 | `redactSensitiveOutput`을 생성 시 + 조회 시(방어적) 2회 적용 |

## 9. SEO / OG

- **robots:** 모든 세션 공유 페이지 `noindex, nofollow` (검색엔진 비노출, 기존과 동일)
- **OG/Twitter:** 링크 미리보기용 카드는 렌더링 (`article` type, 1200×630)
- **canonical:** `buildShareCanonicalUrl` → `/share/s/[token]` 또는 `/[locale]/share/s/[token]`
- **OG 카피:** 첫 `completed` 답변 기반, `buildShareOgCopy` 재사용

## 10. 테스트 전략

### 10.1 유닛 테스트 (`session-share.test.ts`)

`message-share.test.ts` 패턴 복제:

| 테스트 | 검증 항목 |
|--------|----------|
| `buildSessionShareTitle` | 첫 completed 답변에서 타이틀 추출, markdown 헤더 제거, 90자 truncate |
| `createSessionShare` | messages 배열 순서(created_at 오름차순), redaction 적용, title 생성, 중복 시 fallback |
| `findPublicSessionShare` | revoked 필터, 없는 토큰 null 반환, redaction 재적용 |
| `findExistingActiveSessionShare` | session 단위 중복 제거, revoked 제외 |

### 10.2 API 라우트 테스트

| 시나리오 | 예상 응답 |
|----------|----------|
| 미인증 | 401 |
| 비소유 세션 | 403 |
| `completed` 답변 0개 | 400 |
| 정상 생성 | 200 + `{ token, share_url }` |
| 동일 세션 재공유 | 200 + 동일 토큰 (재사용) |

### 10.3 타입체크

- `npx tsc --noEmit` 통과
- 기존 `message-share.test.ts` 수정 없음 (0줄 변경 원칙)

## 11. 비교: 단일 공유 vs 세션 공유

| 항목 | 단일 공유 (`message_shares`) | 세션 공유 (`session_shares`) |
|------|------------------------------|------------------------------|
| 트리거 | `ChatMessage`의 메시지별 공유 아이콘 | `ChatSessionShareButton` 헤더 버튼 |
| 범위 | 1 Q&A | 세션의 모든 completed Q&A |
| URL | `/share/[token]` | `/share/s/[token]` |
| DB | `message_shares` (단일 answer_content) | `session_shares` (messages JSONB 배열) |
| OG | 답변 1개 기반 | 첫 답변 기반 |
| 보안 | 동일 (토큰 + RLS) | 동일 |

## 12. 구현 순서

1. DB 마이그레이션 (`session_shares` 테이블)
2. TypeScript 타입 추가 (`database.ts`)
3. `session-share.ts` 리포지토리 (create/find/redact)
4. 생성 API (`POST /api/share/sessions/[sessionId]`)
5. `ChatSessionShareButton` 컴포넌트
6. `ChatPageClient.tsx` 헤더 버튼 추가 (유일한 기존 파일 수정)
7. `session-share-page.ts` 페이지 헬퍼
8. `/share/s/[token]/page.tsx` 라우트
9. `SharedSessionPageContent` 컴포넌트
10. OG 이미지 API
11. locale-prefixed 라우트
12. 테스트
13. `npx tsc --noEmit` 검증

## 13. 명시적 비목표 (Out of Scope)

- 선택 다이얼로그 (체크박스로 일부 답변만 공유) — 향후 확장 가능
- 취소(revoke) API — 기존 단일 공유와 동일 정책 유지
- 만료 기능 — 영구 보존
- 세션 공유 수정/업데이트 — 생성 후 불변
- 단일 공유 시스템 통합 — 완전 분리 유지
