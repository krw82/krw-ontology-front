# Session Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채팅 헤더에 "대화 공유" 버튼을 추가하여 세션의 모든 completed Q&A를 스냅샷으로 저장한 `/share/s/[token]` 공개 링크를 생성한다.

**Architecture:** 기존 단일 답변 공유 시스템(`message_shares`)과 완전히 분리된 신규 `session_shares` 테이블 + 신규 라우트 `/share/s/[token]`. 기존 코드는 `ChatPageClient.tsx` 헤더 1곳만 수정하고, 공통 함수(`createShareToken`, `buildShareTitle`, `redactSensitiveOutput`, `inferShareLocale`, `buildSharePath` 등)는 기존 모듈에서 import하여 재사용한다.

**Tech Stack:** Next.js (App Router), TypeScript, Supabase (Postgres + RLS), React Server Components.

**Spec:** `docs/superpowers/specs/2026-08-05-session-share-design.md`

## Global Constraints

- 기존 `message-share.ts`, `share-page.ts`, `share-locale.ts`, `share-og.ts`, `SharedAnswerPageContent.tsx`, 단일 공유 라우트는 **수정하지 않음** (0줄 변경 원칙).
- 기존 파일 중 수정 허용: `src/app/chat/ChatPageClient.tsx` (헤더 버튼 추가 1곳), `src/types/database.ts` (타입 추가만).
- 공통 함수는 반드시 import하여 재사용 (복제 금지): `createShareToken`, `buildShareTitle`, `redactSensitiveOutput`, `sanitizeAssistantContent`, `normalizeShareTickers`, `inferShareLocale`, `buildSharePath`, `resolveShareContext`, `tokenPattern`.
- 모든 신규 SQL 마이그레이션은 `supabase/migrations/` 아래 `YYYYMMDDHHMMSS_session_shares.sql` 형식.
- 한국어 기본 locale, `robots: { index: false, follow: false }` 항상 적용.
- `completed` assistant 답변이 1개 이상일 때만 공유 가능 (빈 세션은 400).
- 각 Task 끝에는 반드시 commit.

---

## File Structure

**신규 파일 (10개):**

| 파일 | 책임 |
|------|------|
| `supabase/migrations/20260805000000_session_shares.sql` | `session_shares` 테이블 + 인덱스 + RLS |
| `src/types/database.ts` (수정 — 섹션만 추가) | `SessionShareRow` 인터페이스 추가 |
| `src/lib/share/session-share-message.ts` | 메시지 스냅샷 필터링/정렬/직렬화 로직 (순수 함수, 테스트 용이) |
| `src/lib/share/session-share.ts` | 리포지토리: `createSessionShare`, `findPublicSessionShare`, `findExistingActiveSessionShare` |
| `src/lib/share/session-share-page.ts` | 페이지 헬퍼: `getPublicSessionShareForPage`, `buildPublicSessionShareMetadata`, `buildSessionSharePath` |
| `src/app/api/share/sessions/[sessionId]/route.ts` | POST 생성 API |
| `src/app/api/share/s/[token]/og/route.ts` | OG 이미지 API |
| `src/app/share/s/[token]/page.tsx` | 세션 공유 페이지 라우트 (한국어 기본) |
| `src/app/[locale]/share/s/[token]/page.tsx` | locale-prefixed 라우트 |
| `src/components/SharedSessionPageContent.tsx` | 페이지 콘텐츠 컴포넌트 |
| `src/components/ChatSessionShareButton.tsx` | 헤더 버튼 |

**수정 파일 (2개):**

| 파일 | 변경 내용 |
|------|----------|
| `src/app/chat/ChatPageClient.tsx` | 헤더 `actionSlot`에 `<ChatSessionShareButton>` 추가 |
| `src/types/database.ts` | `SessionShareRow` 인터페이스 추가 (기존 코드 수정 X) |

---

## Task 1: DB 마이그레이션 — `session_shares` 테이블

**Files:**
- Create: `supabase/migrations/20260805000000_session_shares.sql`

**Interfaces:**
- Produces: `session_shares` 테이블 (이후 Task 2, 3, 4가 의존)

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- Session-level chat sharing stores immutable snapshots of all completed Q&A
-- in a chat session behind unguessable tokens. Separate from message_shares
-- (single-answer sharing) to keep the two systems independent.

CREATE TABLE IF NOT EXISTS session_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '공유된 대화',
  tickers TEXT[],
  locale TEXT NOT NULL DEFAULT 'ko',
  messages JSONB NOT NULL,
  message_count INT NOT NULL,
  share_context JSONB DEFAULT '{}'::jsonb,
  snapshot_version INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_session_shares_active_session
  ON session_shares (source_session_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_session_shares_token_active
  ON session_shares (token)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_session_shares_owner_created
  ON session_shares (owner_user_id, created_at DESC);

ALTER TABLE session_shares ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE session_shares FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE session_shares TO service_role;
```

- [ ] **Step 2: 로컬 DB에 적용 확인**

Run: `npx supabase db push --local` (또는 개발 DB에 직접 적용)
Expected: 에러 없이 테이블 생성. `session_shares` 테이블과 3개 인덱스 확인.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260805000000_session_shares.sql
git commit -m "feat(share): add session_shares table migration"
```

---

## Task 2: TypeScript 타입 — `SessionShareRow`

**Files:**
- Modify: `src/types/database.ts` (새 인터페이스 추가만 — 기존 코드 수정 X)

**Interfaces:**
- Consumes: `MessageRow` (기존)
- Produces: `SessionShareRow`, `SessionShareMessage` 타입 (이후 Task 3, 4, 5가 의존)

- [ ] **Step 1: `SessionShareMessage` 타입 추가**

`src/types/database.ts` 파일에서 `MessageRow` 인터페이스 정의 근처(약 line 28-50)에 아래 추가:

```ts
export interface SessionShareMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface SessionShareRow {
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
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 기존 코드 영향 없음, 에러 0건.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "feat(share): add SessionShareRow and SessionShareMessage types"
```

---

## Task 3: 메시지 스냅샷 로직 — `session-share-message.ts`

**Files:**
- Create: `src/lib/share/session-share-message.ts`
- Create: `src/lib/share/session-share-message.test.ts`

**Interfaces:**
- Consumes: `MessageRow` from `@/types/database`; `redactSensitiveOutput`, `sanitizeAssistantContent` from 기존 모듈; `parseChatAttachmentContent` (user 메시지 정제용).
- Produces: `buildSessionMessages`, `pickFirstAssistantAnswer`, `buildSessionShareTitle` 함수.

이 태스크는 메시지 선택/정렬/직렬화 로직을 순수 함수로 분리하여 유닛 테스트를 쉽게 만든다.

- [ ] **Step 2의 테스트를 먼저 작성한다 (TDD).**

- [ ] **Step 1: `redactSensitiveOutput`/`sanitizeAssistantContent`의 정확한 import 경로 확인**

Run: `grep -rn "export.*redactSensitiveOutput\|export.*sanitizeAssistantContent" src/lib/`
Expected: 두 함수의 정확한 모듈 경로 확인 (아마 `src/lib/share/sensitive-output.ts` 또는 `message-share.ts` 내부).

> 참고: `message-share.ts`에서 `redactSensitiveOutput`과 `sanitizeAssistantContent`를 import하고 있다면 그 경로를 그대로 사용. 만약 비-export internal helper라면 새 헬퍼를 만들지 말고 동일 로직을 직접 호출하는 래퍼를 작성.

- [ ] **Step 2: 실패 테스트 작성**

`src/lib/share/session-share-message.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { MessageRow } from "@/types/database";
import {
  buildSessionMessages,
  pickFirstAssistantAnswer,
  buildSessionShareTitle,
} from "@/lib/share/session-share-message";

function msg(
  id: string,
  role: "user" | "assistant",
  content: string,
  createdAt: string,
  status: MessageRow["status"] = "completed",
): MessageRow {
  return {
    id,
    session_id: "session-1",
    role,
    content,
    status,
    created_at: createdAt,
    updated_at: createdAt,
  } as MessageRow;
}

describe("buildSessionMessages", () => {
  it("pairs user question with assistant completed answer", () => {
    const rows = [
      msg("u1", "user", "질문1", "2026-01-01T00:00:00Z"),
      msg("a1", "assistant", "답변1", "2026-01-01T00:01:00Z"),
    ];
    const result = buildSessionMessages(rows);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
  });

  it("excludes user message without following assistant answer", () => {
    const rows = [
      msg("u1", "user", "질문1", "2026-01-01T00:00:00Z"),
      msg("a1", "assistant", "답변1", "2026-01-01T00:01:00Z"),
      msg("u2", "user", "고마워", "2026-01-01T00:02:00Z"), // 답변 없음
    ];
    const result = buildSessionMessages(rows);
    expect(result).toHaveLength(2);
    expect(result.find((m) => m.content === "고마와")).toBeUndefined();
  });

  it("excludes non-completed assistant messages", () => {
    const rows = [
      msg("u1", "user", "질문1", "2026-01-01T00:00:00Z"),
      msg("a1", "assistant", "진행중", "2026-01-01T00:01:00Z", "streaming"),
      msg("a2", "assistant", "완료답변", "2026-01-01T00:02:00Z", "completed"),
    ];
    const result = buildSessionMessages(rows);
    expect(result).toHaveLength(2); // u1 + a2 only
    expect(result[1].content).toContain("완료답변");
  });

  it("sorts by created_at ascending", () => {
    const rows = [
      msg("a1", "assistant", "답변1", "2026-01-01T00:02:00Z"),
      msg("u1", "user", "질문1", "2026-01-01T00:00:00Z"),
      msg("a0", "assistant", "답변0", "2026-01-01T00:01:00Z"),
    ];
    const result = buildSessionMessages(rows);
    expect(result.map((m) => m.created_at)).toEqual([
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:01:00Z",
      "2026-01-01T00:02:00Z",
    ]);
  });
});

describe("pickFirstAssistantAnswer", () => {
  it("returns first completed assistant content", () => {
    const rows = [
      msg("u1", "user", "질문", "2026-01-01T00:00:00Z"),
      msg("a1", "assistant", "첫답변", "2026-01-01T00:01:00Z"),
    ];
    expect(pickFirstAssistantAnswer(rows)).toBe("첫답변");
  });

  it("returns empty string when no completed assistant", () => {
    const rows = [msg("u1", "user", "질문", "2026-01-01T00:00:00Z")];
    expect(pickFirstAssistantAnswer(rows)).toBe("");
  });
});

describe("buildSessionShareTitle", () => {
  it("builds title from first answer content", () => {
    const title = buildSessionShareTitle("## 삼성전자 실적 요약\n내용...", "폴백");
    expect(title).toBe("삼성전자 실적 요약");
  });

  it("uses fallback when content empty", () => {
    expect(buildSessionShareTitle("", "폴백")).toBe("폴백");
  });
});
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

Run: `npx vitest run src/lib/share/session-share-message.test.ts`
Expected: FAIL (모듈이 존재하지 않음).

- [ ] **Step 4: 구현**

`src/lib/share/session-share-message.ts`:

```ts
import type { MessageRow } from "@/types/database";
import { buildShareTitle } from "@/lib/share/message-share";

const SESSION_SHARE_MESSAGE_LIMIT = 100;

export interface SessionShareMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

/**
 * message_shares 테이블의 messages JSONB에 들어갈 직렬화된 메시지 배열을 만든다.
 *
 * 규칙 (spec 섹션 4.2):
 * - completed assistant 답변을 기준점으로 삼는다.
 * - 각 답변 바로 직전(이전 포함 메시지 이후)의 user 메시지들을 질문으로 포함한다.
 * - 답변 없이 뒤따르는 user 발언은 제외된다.
 * - streaming/pending/failed assistant 메시지는 제외된다.
 * - 결과는 created_at 오름차순 정렬된다.
 */
export function buildSessionMessages(rows: MessageRow[]): SessionShareMessage[] {
  const sorted = [...rows].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );

  const result: SessionShareMessage[] = [];
  let lastIncludedIndex = -1;

  for (let i = 0; i < sorted.length; i += 1) {
    const row = sorted[i];
    if (row.role === "assistant" && row.status === "completed") {
      // 이전 포함 메시지 이후부터 현재 답변 직전까지의 user 메시지 포함
      for (let j = lastIncludedIndex + 1; j < i; j += 1) {
        const candidate = sorted[j];
        if (candidate.role === "user" && candidate.content.trim()) {
          result.push(toSessionMessage(candidate));
          lastIncludedIndex = j;
        }
      }
      // 현재 assistant 답변 포함
      result.push(toSessionMessage(row));
      lastIncludedIndex = i;
    }
  }

  return result.slice(0, SESSION_SHARE_MESSAGE_LIMIT * 2);
}

function toSessionMessage(row: MessageRow): SessionShareMessage {
  return {
    role: row.role as "user" | "assistant",
    content: row.content,
    created_at: row.created_at,
  };
}

/**
 * 첫 completed assistant 답변의 content를 반환한다.
 * buildSessionShareTitle의 입력으로 사용된다.
 */
export function pickFirstAssistantAnswer(rows: MessageRow[]): string {
  const sorted = [...rows].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const first = sorted.find(
    (r) => r.role === "assistant" && r.status === "completed",
  );
  return first?.content ?? "";
}

/**
 * 첫 completed assistant 답변에서 세션 공유 제목을 만든다.
 * buildShareTitle()을 재사용한다 (spec: 첫 답변 제목).
 */
export function buildSessionShareTitle(
  firstAnswerContent: string,
  fallbackTitle?: string,
): string {
  return buildShareTitle(firstAnswerContent, fallbackTitle);
}
```

> 참고: 위 구현은 메시지 정제(redaction/sanitize)를 하지 않는다. 정제는 Task 4의 `createSessionShare`에서 DB 저장 직전에 적용한다. 이 태스크는 순수 selection/sorting 로직에 집중.

- [ ] **Step 5: 테스트 실행 — 통과 확인**

Run: `npx vitest run src/lib/share/session-share-message.test.ts`
Expected: PASS (4개 describe 블록 모두 통과)

- [ ] **Step 6: Commit**

```bash
git add src/lib/share/session-share-message.ts src/lib/share/session-share-message.test.ts
git commit -m "feat(share): add session message snapshot selection logic"
```

---

## Task 4: 리포지토리 — `session-share.ts`

**Files:**
- Create: `src/lib/share/session-share.ts`

**Interfaces:**
- Consumes: `SessionShareRow`, `MessageRow`, `ChatSessionRow` from `@/types/database`; `createShareToken`, `buildShareTitle` from `@/lib/share/message-share`; `redactSensitiveOutput`, `sanitizeAssistantContent` (Task 3 Step 1에서 확인한 경로); `resolveShareContext` from `@/lib/share/message-share`; `buildSessionMessages`, `pickFirstAssistantAnswer`, `buildSessionShareTitle` from Task 3; `inferShareLocale`, `normalizeShareTickers` from 기존 모듈; `getSupabaseAdmin` from `@/lib/supabase/admin`.
- Produces: `PublicSessionShare` 타입, `createSessionShare`, `findPublicSessionShare`, `findExistingActiveSessionShare` 함수.

- [ ] **Step 1: 구현**

`src/lib/share/session-share.ts`:

```ts
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  ChatSessionRow,
  MessageRow,
  SessionShareMessage,
  SessionShareRow,
} from "@/types/database";
import type { Locale } from "@/i18n/config";
import type { PublicShareContext } from "@/lib/share/message-share";
import {
  createShareToken,
  redactSensitiveOutput,
  resolveShareContext,
  sanitizeAssistantContent,
} from "@/lib/share/message-share";
import { normalizeShareTickers, inferShareLocale } from "@/lib/share/message-share";
import {
  buildSessionMessages,
  buildSessionShareTitle,
  pickFirstAssistantAnswer,
} from "@/lib/share/session-share-message";

const SESSION_SHARE_SNAPSHOT_VERSION = 1;

export interface PublicSessionShare {
  token: string;
  title: string;
  tickers: string[] | null;
  locale: Locale;
  messages: SessionShareMessage[];
  message_count: number;
  share_context: PublicShareContext;
  created_at: string;
}

export async function findExistingActiveSessionShare(
  sessionId: string,
): Promise<Pick<SessionShareRow, "token" | "share_context"> | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("session_shares")
    .select("token, share_context")
    .eq("source_session_id", sessionId)
    .is("revoked_at", null)
    .maybeSingle<Pick<SessionShareRow, "token" | "share_context">>();
  return data ?? null;
}

export async function createSessionShare(params: {
  userId: string;
  session: ChatSessionRow;
  messages: MessageRow[];
}): Promise<Pick<SessionShareRow, "token">> {
  const admin = getSupabaseAdmin();
  const token = createShareToken();

  // 메시지 선택 + 정렬
  const selectedMessages = buildSessionMessages(params.messages);
  if (selectedMessages.length === 0) {
    throw new Error("No completed Q&A to share");
  }

  // 정제 적용 (redact + sanitize)
  const sanitizedMessages: SessionShareMessage[] = selectedMessages.map((m) => ({
    role: m.role,
    content:
      m.role === "assistant"
        ? redactSensitiveOutput(sanitizeAssistantContent(m.content)).content
        : redactSensitiveOutput(m.content).content,
    created_at: m.created_at,
  }));

  // 첫 completed assistant 답변으로 타이틀 생성
  const firstAnswer = pickFirstAssistantAnswer(params.messages);
  const sanitizedFirstAnswer = redactSensitiveOutput(
    sanitizeAssistantContent(firstAnswer),
  ).content;
  const title = buildSessionShareTitle(sanitizedFirstAnswer, params.session.title);

  // share_context (첫 completed assistant 메시지 기준)
  const firstAssistantMessage = params.messages.find(
    (m) => m.role === "assistant" && m.status === "completed",
  );
  const shareContext = firstAssistantMessage
    ? await resolveShareContext(admin, firstAssistantMessage)
    : { run_kind: null, guru_lens: null };

  // locale 추론 (모든 답변 텍스트 기반)
  const locale = inferShareLocale({
    answerContent: sanitizedMessages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content)
      .join("\n"),
  });

  const payload = {
    token,
    owner_user_id: params.userId,
    source_session_id: params.session.id,
    title,
    tickers: normalizeShareTickers(params.session.default_tickers),
    locale,
    messages: sanitizedMessages,
    message_count: sanitizedMessages.length,
    share_context: shareContext,
    snapshot_version: SESSION_SHARE_SNAPSHOT_VERSION,
  };

  const { data, error } = await admin
    .from("session_shares")
    .insert(payload)
    .select("token")
    .single<Pick<SessionShareRow, "token">>();

  if (!error && data) return data;

  // unique-violation (race) → fallback
  const existing = await findExistingActiveSessionShare(params.session.id);
  if (existing) return existing;

  throw new Error(error?.message || "Failed to create session share");
}

export async function findPublicSessionShare(
  token: string,
): Promise<PublicSessionShare | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("session_shares")
    .select(
      "token, title, tickers, locale, messages, message_count, share_context, created_at",
    )
    .eq("token", token)
    .is("revoked_at", null)
    .maybeSingle<Omit<PublicSessionShare, "messages"> & {
      messages: SessionShareMessage[];
    }>();

  if (!data) return null;

  // 방어적 redaction 재적용
  const redactedMessages = data.messages.map((m) => ({
    role: m.role,
    content: redactSensitiveOutput(m.content).content,
    created_at: m.created_at,
  }));

  return {
    token: data.token,
    title: data.title,
    tickers: data.tickers,
    locale: data.locale as Locale,
    messages: redactedMessages,
    message_count: data.message_count,
    share_context: data.share_context as unknown as PublicShareContext,
    created_at: data.created_at,
  };
}
```

> 참고: `normalizeShareTickers`는 `message-share.ts:216`에 internal helper로 정의되어 있으나 export 여부 확인 필요. export되어 있지 않다면 Task 4 구현 시 해당 함수를 `session-share.ts`로 복사하거나 `message-share.ts`에 export를 추가. 단, "기존 코드 0줄 변경" 원칙을 지키려면 복사 선호. `redactSensitiveOutput`, `sanitizeAssistantContent`, `resolveShareContext`의 export 경로도 동일하게 확인 필요.

- [ ] **Step 2: import 경로 보정**

Run: `grep -n "export.*normalizeShareTickers\|export.*redactSensitiveOutput\|export.*sanitizeAssistantContent\|export.*resolveShareContext" src/lib/share/message-share.ts`
Expected: 각 함수의 export 여부 확인. export되어 있지 않은 함수가 있으면, `session-share.ts`에서 동일 로직을 직접 구현하거나 필요한 helper를 import 가능한 모듈(`@/lib/share/sensitive-output` 또는 유사)에서 가져오기.

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 0건. import 경로가 모두 해결됨.

- [ ] **Step 4: Commit**

```bash
git add src/lib/share/session-share.ts
git commit -m "feat(share): add session share repository"
```

---

## Task 5: 페이지 헬퍼 — `session-share-page.ts`

**Files:**
- Create: `src/lib/share/session-share-page.ts`

**Interfaces:**
- Consumes: `findPublicSessionShare`, `PublicSessionShare` from Task 4; `buildShareOgCopy`, `buildShareOgImageUrl`, `buildShareCanonicalUrl`, `SHARE_OG_IMAGE_SIZE` from `@/lib/share/share-og`; `tokenPattern` from `@/lib/share/share-page`; `SITE_NAME` from `@/lib/marketing/site`.
- Produces: `getPublicSessionShareForPage`, `buildPublicSessionShareMetadata`, `buildSessionSharePath`, `buildSessionShareOgImageUrl` 함수.

- [ ] **Step 1: 구현**

`src/lib/share/session-share-page.ts`:

```ts
import type { Metadata } from "next";
import type { Locale } from "@/i18n/config";
import { SITE_NAME, absoluteUrl } from "@/lib/marketing/site";
import {
  findPublicSessionShare,
  type PublicSessionShare,
} from "@/lib/share/session-share";
import { tokenPattern } from "@/lib/share/share-page";
import {
  SHARE_OG_IMAGE_SIZE,
  buildShareCanonicalUrl,
  buildShareOgCopy,
} from "@/lib/share/share-og";

export async function getPublicSessionShareForPage(token: string) {
  if (!tokenPattern.test(token)) return null;
  return findPublicSessionShare(token);
}

export function buildSessionSharePath(token: string, locale: Locale): string {
  const encoded = encodeURIComponent(token);
  return locale === "en" ? `/en/share/s/${encoded}` : `/share/s/${encoded}`;
}

export function buildSessionShareCanonicalUrl(
  token: string,
  locale: Locale,
): string {
  return absoluteUrl(buildSessionSharePath(token, locale));
}

export function buildSessionShareOgImagePath(token: string): string {
  return `/api/share/s/${encodeURIComponent(token)}/og`;
}

export function buildSessionShareOgImageUrl(token: string): string {
  return absoluteUrl(buildSessionShareOgImagePath(token));
}

export function buildPublicSessionShareMetadata(
  share: PublicSessionShare,
  locale: Locale,
): Metadata {
  // share-og.ts의 buildShareOgCopy는 PublicMessageShare를 입력받으므로
  // 호환되는 형태로 변환 (첫 assistant 답변을 answer_content로 사용)
  const firstAnswer =
    share.messages.find((m) => m.role === "assistant")?.content ?? "";
  const ogInput = {
    title: share.title,
    question_content: share.messages.find((m) => m.role === "user")?.content ?? null,
    answer_content: firstAnswer,
    tickers: share.tickers,
    share_context: share.share_context,
    locale: share.locale,
  } as Parameters<typeof buildShareOgCopy>[0];

  const ogCopy = buildShareOgCopy(ogInput);
  const pageTitle = `${ogCopy.title} | ${SITE_NAME}`;
  const imageUrl = buildSessionShareOgImageUrl(share.token);
  const pageUrl = buildSessionShareCanonicalUrl(share.token, locale);

  return {
    title: pageTitle,
    description: ogCopy.description,
    alternates: { canonical: pageUrl },
    openGraph: {
      title: pageTitle,
      description: ogCopy.description,
      url: pageUrl,
      siteName: SITE_NAME,
      type: "article",
      locale: locale === "en" ? "en_US" : "ko_KR",
      images: [
        {
          url: imageUrl,
          width: SHARE_OG_IMAGE_SIZE.width,
          height: SHARE_OG_IMAGE_SIZE.height,
          alt: ogCopy.alt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: pageTitle,
      description: ogCopy.description,
      images: [imageUrl],
    },
    robots: { index: false, follow: false },
  };
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 0건. `buildShareOgCopy`의 입력 타입 호환성 확인.

> 참고: `buildShareOgCopy`는 `PublicMessageShare` 타입을 받으나 구조적으로 필요한 필드만 사용하므로 구조적 타이핑으로 호환됨. 만약 TS 에러가 나면 `ogInput`에 더 많은 필드를 채우거나 타입 단언을 강화.

- [ ] **Step 3: Commit**

```bash
git add src/lib/share/session-share-page.ts
git commit -m "feat(share): add session share page helpers"
```

---

## Task 6: 생성 API — `POST /api/share/sessions/[sessionId]`

**Files:**
- Create: `src/app/api/share/sessions/[sessionId]/route.ts`

**Interfaces:**
- Consumes: `createSessionShare`, `findExistingActiveSessionShare` from Task 4; `getAuthUser`, `forbiddenError`, `handleAuthError` from `@/lib/auth`; `getSupabaseAdmin` from `@/lib/supabase/admin`; `isUuid` from `@/lib/api/validation`; `inferShareLocale`, `buildSharePath` from `@/lib/share/share-locale` (단일 공유 재사용 — 단 `/share/s/` 경로는 `buildSessionSharePath`로 덮어쓰기).
- Produces: POST 핸들러, `{ token, share_url, url }` 응답.

- [ ] **Step 1: 구현**

`src/app/api/share/sessions/[sessionId]/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { getAuthUser, forbiddenError, handleAuthError } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  createSessionShare,
  findExistingActiveSessionShare,
} from "@/lib/share/session-share";
import { buildSessionSharePath } from "@/lib/share/session-share-page";
import { inferShareLocale } from "@/lib/share/share-locale";
import { isUuid } from "@/lib/api/validation";
import type { ChatSessionRow, MessageRow } from "@/types/database";

export const runtime = "nodejs";

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  if (!isUuid(sessionId)) {
    return errorResponse(400, "validation_error", "잘못된 세션 ID입니다.");
  }

  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const admin = getSupabaseAdmin();

  // 세션 로드 + 소유권
  const { data: session, error: sessionError } = await admin
    .from("chat_sessions")
    .select(
      "id, user_id, title, claude_session_id, scope_type, default_tickers, default_document_types, created_at, updated_at",
    )
    .eq("id", sessionId)
    .is("deleted_at", null)
    .single<ChatSessionRow>();

  if (sessionError || !session) {
    return errorResponse(404, "not_found", "채팅을 찾지 못했습니다.");
  }
  if (session.user_id !== user.id) {
    return forbiddenError("이 대화를 공유할 권한이 없습니다.");
  }

  // 세션의 모든 메시지 로드 (created_at 오름차순)
  const { data: messages, error: messagesError } = await admin
    .from("messages")
    .select("id, session_id, role, content, status, created_at, updated_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .returns<MessageRow[]>();

  if (messagesError || !messages) {
    return errorResponse(500, "internal_error", "메시지를 불러오지 못했습니다.");
  }

  // completed assistant 답변이 1개 이상인지 확인
  const hasCompletedAnswer = messages.some(
    (m) => m.role === "assistant" && m.status === "completed",
  );
  if (!hasCompletedAnswer) {
    return errorResponse(
      400,
      "no_completed_answers",
      "공유할 완료된 답변이 없습니다.",
    );
  }

  try {
    const existing = await findExistingActiveSessionShare(session.id);
    const share =
      existing ??
      (await createSessionShare({
        userId: user.id,
        session,
        messages,
      }));

    // locale 추론 후 URL 생성
    const firstAnswer =
      messages.find((m) => m.role === "assistant" && m.status === "completed")
        ?.content ?? "";
    const shareLocale = inferShareLocale({ answerContent: firstAnswer });
    const shareUrl = buildSessionSharePath(share.token, shareLocale);

    await recordAnalyticsEventFromRequest(request, {
      eventName: "session_share_created",
      userId: user.id,
      sessionId: session.id,
      properties: {
        reused_existing_share: Boolean(existing),
        scope_type: session.scope_type,
        ticker: session.default_tickers?.[0] ?? null,
        tickers: session.default_tickers ?? [],
      },
    });

    return Response.json({
      token: share.token,
      share_url: shareUrl,
      url: new URL(shareUrl, request.url).toString(),
    });
  } catch (error) {
    console.error("[share] failed to create session share", error);
    return errorResponse(500, "internal_error", "공유 링크를 만들지 못했습니다.");
  }
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 0건.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/share/sessions/[sessionId]/route.ts
git commit -m "feat(share): add POST /api/share/sessions/[sessionId]"
```

---

## Task 7: 헤더 버튼 — `ChatSessionShareButton.tsx` + `ChatPageClient.tsx`

**Files:**
- Create: `src/components/ChatSessionShareButton.tsx`
- Modify: `src/app/chat/ChatPageClient.tsx` (line 774-787 근처 `actionSlot`)

**Interfaces:**
- Consumes: `sessionId: string` prop.
- Produces: 헤더 우측 버튼, `POST /api/share/sessions/[sessionId]` 호출.

- [ ] **Step 1: `ChatSessionShareButton.tsx` 작성**

`src/components/ChatSessionShareButton.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { copyTextToClipboard } from "@/lib/clipboard";

type ShareState =
  | "idle"
  | "sharing"
  | "shared"
  | "failed"
  | "auth_required";

class SessionShareCreationError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "SessionShareCreationError";
  }
}

async function createSessionShareUrl(sessionId: string): Promise<string> {
  const response = await fetch(
    `/api/share/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
  );

  if (!response.ok) {
    throw new SessionShareCreationError(
      response.status,
      `Session share failed: ${response.status}`,
    );
  }

  const data = (await response.json()) as {
    share_url?: string;
    url?: string;
  };
  return data.share_url ?? data.url ?? "";
}

export default function ChatSessionShareButton({
  sessionId,
}: {
  sessionId: string;
}) {
  const [shareState, setShareState] = useState<ShareState>("idle");

  useEffect(() => {
    if (
      shareState !== "shared" &&
      shareState !== "failed" &&
      shareState !== "auth_required"
    ) {
      return;
    }
    const timeoutId = window.setTimeout(() => setShareState("idle"), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [shareState]);

  const handleShare = useCallback(async () => {
    if (shareState === "sharing") return;

    setShareState("sharing");
    let shareUrl = "";

    try {
      shareUrl = await createSessionShareUrl(sessionId);
      const shareData: ShareData = { title: "KRW.O", url: shareUrl };
      const useNativeShare =
        Boolean(navigator.share) &&
        (!navigator.canShare || navigator.canShare(shareData));

      if (useNativeShare) {
        await navigator.share(shareData);
        setShareState("shared");
      } else {
        const copied = await copyTextToClipboard(shareUrl);
        setShareState(copied ? "shared" : "failed");
      }
    } catch (error) {
      if ((error as DOMException).name === "AbortError") {
        setShareState("idle");
        return;
      }
      if (
        error instanceof SessionShareCreationError &&
        error.status === 401
      ) {
        setShareState("auth_required");
        return;
      }
      const copied = shareUrl
        ? await copyTextToClipboard(shareUrl)
        : false;
      setShareState(copied ? "shared" : "failed");
    }
  }, [sessionId, shareState]);

  const iconName =
    shareState === "shared"
      ? "check"
      : shareState === "failed"
        ? "error"
        : shareState === "auth_required"
          ? "lock"
          : shareState === "sharing"
            ? "progress_activity"
            : "forum";
  const ariaLabel =
    shareState === "shared"
      ? "대화 공유 완료"
      : shareState === "failed"
        ? "대화 공유 실패"
        : shareState === "auth_required"
          ? "로그인이 필요합니다"
          : shareState === "sharing"
            ? "대화 공유 링크 생성 중"
            : "이 대화 공유";

  return (
    <button
      type="button"
      className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-70"
      aria-label={ariaLabel}
      disabled={shareState === "sharing"}
      onClick={handleShare}
    >
      <span
        aria-hidden="true"
        className={[
          "material-symbols-outlined text-[20px]",
          shareState === "sharing" ? "animate-spin" : "",
        ].join(" ")}
      >
        {iconName}
      </span>
    </button>
  );
}
```

> 참고: `copyTextToClipboard`의 정확한 import 경로 확인 필요. `ChatMessage.tsx`에서 사용하는 동일 경로(`@/lib/clipboard`)를 사용.

- [ ] **Step 2: `ChatPageClient.tsx` actionSlot 수정**

`src/app/chat/ChatPageClient.tsx`의 `actionSlot` prop (약 line 774-787):

기존:
```tsx
actionSlot={
  headerActionTicker ? (
    <ChatWatchlistHeaderActions
      ticker={headerActionTicker}
      showNotebookOnboarding={...}
      forceShowNotebookOnboarding={...}
    />
  ) : null
}
```

변경 후:
```tsx
actionSlot={
  headerActionTicker || sessionId ? (
    <div className="flex items-center gap-xs">
      {sessionId ? <ChatSessionShareButton sessionId={sessionId} /> : null}
      {headerActionTicker ? (
        <ChatWatchlistHeaderActions
          ticker={headerActionTicker}
          showNotebookOnboarding={...}
          forceShowNotebookOnboarding={...}
        />
      ) : null}
    </div>
  ) : null
}
```

그리고 파일 상단 import에 추가:
```tsx
import ChatSessionShareButton from "@/components/ChatSessionShareButton";
```

> 주의: `sessionId` 변수가 `ChatContent` 컴포넌트 스코프에서 유효한지 확인. `ChatPageClient.tsx`에서 `sessionId`가 `actionSlot` 렌더링 지점에서 접근 가능해야 함. (이미 헤더 actionSlot 근처에서 `headerActionTicker`와 함께 사용되므로 동일 스코프에 있을 것으로 예상.)

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 0건. `sessionId` 스코프 확인.

- [ ] **Step 4: 브라우저 수동 테스트**

Run: dev 서버 실행 후 채팅 페이지에서 헤더 우측에 포럼 아이콘 버튼 표시 확인.
Expected: 버튼 클릭 시 `sharing` 상태 → 링크 생성 → `shared` (클립보드 복사 토스트).

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatSessionShareButton.tsx src/app/chat/ChatPageClient.tsx
git commit -m "feat(share): add ChatSessionShareButton in chat header"
```

---

## Task 8: 페이지 라우트 — `/share/s/[token]`

**Files:**
- Create: `src/app/share/s/[token]/page.tsx`
- Create: `src/app/[locale]/share/s/[token]/page.tsx`

**Interfaces:**
- Consumes: `getPublicSessionShareForPage`, `buildPublicSessionShareMetadata` from Task 5; `SharedSessionPageContent` from Task 9 (이 태스크보다 Task 9가 먼저일 수도 있음 — 순서 조정 가능).
- Produces: 공개 세션 공유 페이지.

> 참고: Task 8과 Task 9는 순환 의존성이 있으므로 Task 9를 먼저 구현하거나, Task 8에서 임시 placeholder를 두고 Task 9에서 채우는 방식도 가능. 여기서는 Task 9를 먼저 완료했다고 가정.

- [ ] **Step 1: 한국어 기본 라우트**

`src/app/share/s/[token]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SharedSessionPageContent from "@/components/SharedSessionPageContent";
import {
  buildPublicSessionShareMetadata,
  getPublicSessionShareForPage,
} from "@/lib/share/session-share-page";
import { sharePageMetadataCopy } from "@/lib/share/share-page";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const share = await getPublicSessionShareForPage(token);

  if (!share) {
    return {
      title: sharePageMetadataCopy("ko").notFoundTitle,
      robots: { index: false, follow: false },
    };
  }

  return buildPublicSessionShareMetadata(share, share.locale);
}

export default async function SharedSessionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const share = await getPublicSessionShareForPage(token);

  if (!share) notFound();

  return <SharedSessionPageContent share={share} locale={share.locale} />;
}
```

- [ ] **Step 2: locale-prefixed 라우트**

`src/app/[locale]/share/s/[token]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SharedSessionPageContent from "@/components/SharedSessionPageContent";
import {
  buildPublicSessionShareMetadata,
  getPublicSessionShareForPage,
} from "@/lib/share/session-share-page";
import { sharePageMetadataCopy } from "@/lib/share/share-page";
import { isLocale, type Locale } from "@/i18n/config";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}): Promise<Metadata> {
  const { token, locale } = await params;
  if (!isLocale(locale)) {
    return {
      title: sharePageMetadataCopy("ko").notFoundTitle,
      robots: { index: false, follow: false },
    };
  }
  const share = await getPublicSessionShareForPage(token);
  if (!share) {
    return {
      title: sharePageMetadataCopy(locale as Locale).notFoundTitle,
      robots: { index: false, follow: false },
    };
  }
  return buildPublicSessionShareMetadata(share, locale as Locale);
}

export default async function SharedSessionPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { token, locale } = await params;
  if (!isLocale(locale)) notFound();
  const share = await getPublicSessionShareForPage(token);
  if (!share) notFound();
  return <SharedSessionPageContent share={share} locale={locale as Locale} />;
}
```

> 참고: `isLocale`의 import 경로는 `src/app/[locale]/share/[token]/page.tsx`(기존 단일 공유 locale 라우트)에서 확인하여 동일하게 사용.

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: `SharedSessionPageContent`가 아직 없으므로 에러 발생 (Task 9에서 해결). Task 9 완료 후 재확인.

- [ ] **Step 4: Commit (Task 9 완료 후)**

```bash
git add src/app/share/s/[token]/page.tsx src/app/[locale]/share/s/[token]/page.tsx
git commit -m "feat(share): add /share/s/[token] session share routes"
```

---

## Task 9: 페이지 콘텐츠 — `SharedSessionPageContent.tsx`

**Files:**
- Create: `src/components/SharedSessionPageContent.tsx`

**Interfaces:**
- Consumes: `PublicSessionShare` from Task 4; `KrwBrand`, `MessageAttachments`, `ResearchMarkdown`, `SharePageEvents`, `ShareStartLink` (기존 컴포넌트); `getGuruLens`, `getGuruLensDisplayName` from `@/lib/guru-lenses`.
- Produces: `SharedSessionPageContent` 컴포넌트 (Task 8이 의존).

- [ ] **Step 1: 컴포넌트 작성**

`src/components/SharedSessionPageContent.tsx`:

```tsx
import { KrwBrand } from "@/components/KrwBrand";
import ResearchMarkdown from "@/components/ResearchMarkdown";
import SharePageEvents from "@/components/SharePageEvents";
import ShareStartLink from "@/components/ShareStartLink";
import type { Locale } from "@/i18n/config";
import { getGuruLens, getGuruLensDisplayName } from "@/lib/guru-lenses";
import type { PublicSessionShare } from "@/lib/share/session-share";

type SessionSharePageCopy = {
  brandAria: string;
  footer: string;
  cta: string;
  conversationLabel: string;
  questionLabel: string;
  answerLabel: string;
  guruEyebrow: string;
  guruTitle: string;
  guruDescription: (lensName: string) => string;
  guruDisclaimer: string;
  guruCta: string;
};

const copy: Record<Locale, SessionSharePageCopy> = {
  ko: {
    brandAria: "회사 목록으로 이동",
    footer: "다른 회사나 뉴스도 공시 근거로 이어서 확인해보세요.",
    cta: "새 리서치 시작",
    conversationLabel: "대화",
    questionLabel: "질문",
    answerLabel: "답변",
    guruEyebrow: "관점별 분석",
    guruTitle: "관점별 분석 대화",
    guruDescription: (lensName: string) =>
      `${lensName} 관점으로 회사와 아이디어를 점검한 공유 리서치 대화입니다.`,
    guruDisclaimer:
      "실제 인물의 조언이 아니라, 공개적으로 알려진 투자 원칙을 바탕으로 만든 AI 렌즈입니다.",
    guruCta: "관점별 분석 시작",
  },
  en: {
    brandAria: "Go to companies",
    footer: "Continue with another stock, news item, or investment question.",
    cta: "Start new research",
    conversationLabel: "Conversation",
    questionLabel: "Question",
    answerLabel: "Answer",
    guruEyebrow: "Perspective analysis",
    guruTitle: "Perspective analysis conversation",
    guruDescription: (lensName: string) =>
      `A shared research conversation using the ${lensName} perspective.`,
    guruDisclaimer:
      "This is an AI lens based on publicly known investing principles, not advice from the real person.",
    guruCta: "Start perspective analysis",
  },
};

interface SharedSessionPageContentProps {
  share: PublicSessionShare;
  locale: Locale;
}

export default function SharedSessionPageContent({
  share,
  locale,
}: SharedSessionPageContentProps) {
  const strings = copy[locale];
  const isGuruShare = share.share_context.run_kind === "guru_advisor";
  const guruLens =
    isGuruShare && share.share_context.guru_lens
      ? getGuruLens(share.share_context.guru_lens)
      : null;
  const guruLensName = guruLens
    ? getGuruLensDisplayName(guruLens, locale)
    : locale === "en"
      ? "guru"
      : "구루";
  const startHref = isGuruShare ? "/guru" : "/";

  let turnIndex = 0;

  return (
    <div className="min-h-[100dvh] bg-canvas pb-[112px] text-on-surface">
      <header className="sticky top-0 z-40 border-b border-hairline bg-canvas/90 backdrop-blur-xl">
        <div className="mx-auto flex h-20 w-full max-w-7xl items-center px-base sm:px-xl lg:px-8">
          <KrwBrand compact href="/companies" ariaLabel={strings.brandAria} />
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto w-full max-w-5xl px-base py-xl sm:px-xl sm:py-xxl"
      >
        <div className="space-y-xxl">
          {isGuruShare ? (
            <section className="border-b border-hairline pb-lg">
              <div className="font-mono text-[12px] font-black uppercase leading-5 tracking-[0.16em] text-primary">
                {strings.guruEyebrow}
              </div>
              <h1 className="mt-xs text-[32px] font-black leading-[1.12] tracking-normal text-ink sm:text-[44px]">
                {strings.guruTitle}
              </h1>
              <p className="mt-sm max-w-3xl text-[17px] font-semibold leading-[1.65] text-body sm:text-[19px]">
                {strings.guruDescription(guruLensName)}
              </p>
              <p className="mt-xs max-w-3xl text-[13px] font-semibold leading-[1.55] text-muted">
                {strings.guruDisclaimer}
              </p>
            </section>
          ) : null}

          {share.messages.map((message, index) => {
            if (message.role === "user") {
              turnIndex += 1;
              return (
                <section
                  key={`msg-${index}`}
                  aria-label={strings.questionLabel}
                  className="grid gap-md sm:grid-cols-[96px_minmax(0,1fr)]"
                >
                  <div className="font-mono text-[12px] font-black uppercase leading-5 tracking-[0.16em] text-primary">
                    {String(turnIndex).padStart(2, "0")} {strings.questionLabel}
                  </div>
                  <div className="border-l-2 border-primary-container pl-md text-ink">
                    <p className="whitespace-pre-wrap break-words text-[18px] font-extrabold leading-[1.55] sm:text-[22px] sm:leading-[1.45]">
                      {message.content}
                    </p>
                  </div>
                </section>
              );
            }

            return (
              <section
                key={`msg-${index}`}
                aria-label={strings.answerLabel}
                className="grid gap-md sm:grid-cols-[96px_minmax(0,1fr)]"
              >
                <div className="font-mono text-[12px] font-black uppercase leading-5 tracking-[0.16em] text-primary">
                  {String(turnIndex).padStart(2, "0")} {strings.answerLabel}
                </div>
                <div className="min-w-0 text-body">
                  <ResearchMarkdown content={message.content} />
                </div>
              </section>
            );
          })}

          <SharePageEvents
            viewedEventName="session_share_viewed"
            readEventName="session_share_answer_read"
          />
        </div>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-canvas/95 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-sm px-base py-md sm:flex-row sm:items-center sm:justify-between sm:px-xl">
          <p className="text-[13px] font-semibold leading-tight text-muted">
            {strings.footer}
          </p>
          <ShareStartLink
            href={startHref}
            cta={isGuruShare ? strings.guruCta : strings.cta}
            eventName="session_share_cta_clicked"
            location="session_share"
          />
        </div>
      </footer>
    </div>
  );
}
```

> 참고 1: `SharePageEvents`와 `ShareStartLink` 컴포넌트가 이벤트명 prop을 받을 수 있는지 확인. 기존 컴포넌트가 hardcoded 이벤트명을 사용한다면 (a) prop을 추가하거나 (b) 세션 공유 전용 컴포넌트를 새로 만들어야 함. "기존 코드 0줄 변경" 원칙을 우선하면 (b) 선택 — `SessionSharePageEvents`, `SessionShareStartLink` 신규 컴포넌트 작성. 아래 Step 2에서 확인.

- [ ] **Step 2: `SharePageEvents`/`ShareStartLink` prop 호환성 확인**

Run: `cat src/components/SharePageEvents.tsx src/components/ShareStartLink.tsx`
Expected: 두 컴포넌트의 props 확인. 이벤트명을 외부에서 주입할 수 없다면 아래 보조 Step 2b 실행.

- [ ] **Step 2b (조건부): 세션 공유 전용 분석 컴포넌트 작성 (필요 시)**

기존 컴포넌트를 수정하지 않으려면 `src/components/SessionSharePageEvents.tsx`와 `src/components/SessionShareStartLink.tsx`를 `SharePageEvents.tsx`/`ShareStartLink.tsx`를 복사하여 이벤트명만 변경한 버전으로 작성. `SharedSessionPageContent.tsx`의 import를 이쪽으로 변경.

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 0건.

- [ ] **Step 4: Commit (Task 8 라우트와 함께)**

```bash
git add src/components/SharedSessionPageContent.tsx src/app/share/s/[token]/page.tsx src/app/[locale]/share/s/[token]/page.tsx
# Step 2b를 실행했다면 src/components/SessionSharePageEvents.tsx src/components/SessionShareStartLink.tsx도 추가
git commit -m "feat(share): add SharedSessionPageContent and /share/s routes"
```

---

## Task 10: OG 이미지 API — `/api/share/s/[token]/og`

**Files:**
- Create: `src/app/api/share/s/[token]/og/route.ts`

**Interfaces:**
- Consumes: `getPublicSessionShareForPage` from Task 5; `buildShareOgCopy` from `@/lib/share/share-og`; `ShareOgImage` 컴포넌트 (기존 `src/components/ShareOgImage.tsx`); `getIndexedCompany` (기존); `ImageResponse` from `next/og`.

- [ ] **Step 1: 기존 OG 라우트 패턴 확인**

Run: `cat src/app/api/share/[token]/og/route.ts`
Expected: 기존 구조 파악. 동일 패턴을 복제하되 `getPublicSessionShareForPage`를 사용.

- [ ] **Step 2: 구현**

`src/app/api/share/s/[token]/og/route.ts`:

```ts
import { ImageResponse } from "next/og";
import ShareOgImage from "@/components/ShareOgImage";
import { getIndexedCompany } from "@/lib/companies/indexed-companies";
import { getPublicSessionShareForPage } from "@/lib/share/session-share-page";
import { buildShareOgCopy } from "@/lib/share/share-og";
import { SHARE_OG_IMAGE_SIZE } from "@/lib/share/share-og";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const share = await getPublicSessionShareForPage(token);

  if (!share) {
    return new Response("Not found", { status: 404 });
  }

  const primaryTicker = share.tickers?.[0] ?? null;
  const company = primaryTicker
    ? await getIndexedCompany(primaryTicker)
    : null;
  const companyName = company?.name ?? null;

  // buildShareOgCopy 입력 호환 형태로 변환 (Task 5와 동일)
  const firstAnswer =
    share.messages.find((m) => m.role === "assistant")?.content ?? "";
  const ogInput = {
    title: share.title,
    question_content: share.messages.find((m) => m.role === "user")?.content ?? null,
    answer_content: firstAnswer,
    tickers: share.tickers,
    share_context: share.share_context,
    locale: share.locale,
  } as Parameters<typeof buildShareOgCopy>[0];

  const ogCopy = buildShareOgCopy(ogInput, companyName);

  return new ImageResponse(
    (
      <ShareOgImage copy={ogCopy} />
    ),
    {
      width: SHARE_OG_IMAGE_SIZE.width,
      height: SHARE_OG_IMAGE_SIZE.height,
      headers: {
        "Cache-Control":
          "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
```

> 참고: `getIndexedCompany`, `ShareOgImage`의 정확한 import 경로는 기존 `/api/share/[token]/og/route.ts`에서 확인하여 동일하게 사용.

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 0건.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/share/s/[token]/og/route.ts
git commit -m "feat(share): add session share OG image endpoint"
```

---

## Task 11: 전체 검증 — 타입체크 + 테스트 + 수동 E2E

**Files:**
- 검증만 (수정 없음)

- [ ] **Step 1: 전체 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 0건.

- [ ] **Step 2: 전체 테스트**

Run: `npx vitest run`
Expected: 기존 테스트 + Task 3의 신규 테스트 모두 통과. 기존 `message-share.test.ts` 영향 0 확인.

- [ ] **Step 3: E2E 수동 테스트**

1. 로그인 후 채팅 페이지에서 completed 답변이 있는 세션 열기
2. 헤더 우측 포럼 아이콘 버튼 클릭
3. 링크 생성 → 클립보드 복사 또는 네이티브 공유 시트
4. 복사된 URL (`/share/s/[token]`) 시크릿 창에서 열기
5. 모든 Q&A 타임라인 렌더링 확인
6. OG 미리보기 (Slack/KakaoTalk 등에 링크 붙여넣기) 확인

Expected:
- 세션 공유 페이지 정상 렌더링
- robots noindex
- OG 이미지 1200×630 정상
- 미인증 사용자도 조회 가능
- 세션 비소유자가 API 직접 호출 시 403
- completed 답변 0개 세션에서 버튼 클릭 시 400

- [ ] **Step 4: 기존 단일 공유 회귀 확인**

기존 `/share/[token]` 페이지가 여전히 정상 동작하는지 확인 (기존 공유 링크 하나 방문).
Expected: 단일 공유 시스템 영향 0.

- [ ] **Step 5: 최종 Commit (검증 결과 문서화)**

```bash
git commit --allow-empty -m "chore(share): verify session share E2E + regression"
```

---

## Self-Review

**1. Spec coverage:**

| Spec 섹션 | 구현 Task |
|-----------|-----------|
| 3. 아키텍처 (파일 매핑) | Task 1-10 전체 |
| 4. 데이터 모델 (`session_shares`) | Task 1 (DB), Task 2 (TS) |
| 4.2 `messages` JSONB + 필터링 규칙 | Task 3 (`buildSessionMessages`) |
| 5.1 `ChatSessionShareButton` | Task 7 |
| 5.2 `SharedSessionPageContent` | Task 9 |
| 5.3 OG 이미지 | Task 10 |
| 6.1 생성 플로우 | Task 6 |
| 6.2 검증 규칙 (401/403/400) | Task 6 |
| 6.3 조회 플로우 | Task 8 |
| 7. 에러 처리 | Task 6 (생성), Task 8 (조회 notFound) |
| 8. 접근 제어 | Task 1 (RLS), Task 6 (소유권) |
| 9. SEO/OG | Task 5 (metadata), Task 10 (OG 이미지) |
| 10. 테스트 | Task 3 (유닛), Task 11 (E2E) |
| 12. 구현 순서 | Task 1→11 순서가 spec 섹션 12와 일치 |

✅ 모든 spec 섹션이 Task로 커버됨.

**2. Placeholder scan:**
- ✅ TBD/TODO 없음
- ✅ 모든 코드 단계에 실제 코드 포함
- ✅ "적절히 처리" 등 모호 표현 없음
- ⚠️ Task 4/9에서 "import 경로 확인 필요"라는 조건부 단계가 있음 — 이는 기존 코드의 정확한 export 상태에 따라 분기하므로 불가피. 각 Task의 Step 2에서 `grep`으로 확인하도록 명시.

**3. Type consistency:**
- `SessionShareMessage`: Task 2 정의 → Task 3 사용 → Task 4 사용 → Task 9 사용 ✅ 일치
- `SessionShareRow`: Task 2 정의 → Task 4 사용 ✅ 일치
- `PublicSessionShare`: Task 4 정의 → Task 5 사용 → Task 8 사용 → Task 9 사용 ✅ 일치
- `buildSessionMessages`, `pickFirstAssistantAnswer`, `buildSessionShareTitle`: Task 3 정의 → Task 4 사용 ✅ 일치
- `getPublicSessionShareForPage`, `buildPublicSessionShareMetadata`, `buildSessionSharePath`: Task 5 정의 → Task 6/8 사용 ✅ 일치

이슈 없음.

---

## 실행 옵션

Plan complete and saved to `docs/superpowers/plans/2026-08-05-session-share.md`. Two execution options:

**1. Subagent-Driven (recommended)** - Task마다 fresh subagent를 dispatch하고, task 사이에 review하며 빠른 iteration.

**2. Inline Execution** - 이 세션에서 `executing-plans` 스킬로 batch execution (checkpoint마다 review).

어느 방식으로 진행할까요?
