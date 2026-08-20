# 관심=알림 통일 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관심 버튼 하나로 관심종목 + 공시·뉴스 알림 구독 + 뉴스 팔로우를 함께 켜고 끈다 (free 3 / 유료 무제한).

**Architecture:** 쓰기는 서버 통합 엔드포인트 `PUT/DELETE /api/companies/[ticker]/follow`로 모은다. 저장소 3개(user_company_marks / user_filing_subscriptions / market-issue follow)는 유지하고, 라우트 내부에서 순차 기록하되 부분 실패는 관용 처리한다. 클라이언트는 `useCompanyFollow` 훅으로 상태 조회·토글·푸시 권한 사다리를 공용화하고 5개 표면이 이를 쓴다. 기존 엔드포인트는 호환용으로 남긴다.

**Tech Stack:** Next.js App Router route handlers, Supabase admin client(서비스 역할), vitest + vi.mock 라우트 테스트 패턴(`src/app/api/watchlist/[ticker]/route.test.ts` 참조), supabase/migrations SQL.

**설계 스펙:** `docs/plans/2026-08-20-follow-unification-plan.md` (정책·배경·예외 근거)

## Global Constraints

- 커밋 메시지에 소스 파일명을 쓸 때는 heredoc 대신 메시지 파일 + `git commit -F` (mimosa 훅 오탐 회피)
- 분석 이벤트는 기존 이름만 재사용 (`company_followed`, `company_unfollowed`, `cta_clicked`, `filing_subscription_created`, `filing_subscription_removed`, `push_permission_prompted`, `push_subscribed`, `push_permission_denied`) — 신규 이벤트 금지
- 관심 한도: free 3 / 유료 무제한은 `setCompanyCoverageLevelWithEvent`의 기존 체계(`coverage/repository.ts:76`)가 그대로 좌우. `MAX_FILING_SUBSCRIPTIONS_PER_USER` 20 상수는 통합 플로우에서 사용 금지(기존 라우트 호환 유지용으로만 남김)
- 한국어 UI 카피는 짧고 직설적으로; 계산 불결과는 "해당 없음"류 짧은 라벨 + 작은 사유 라벨 스타일
- 테스트 실행: `npx vitest run <경로>`, 최종 게이트 `npm run typecheck && npm run lint && npx vitest run`
- 모든 뮤테이션 라우트는 `isExpectedMutationOrigin` 검사 후 `getAuthUser` 인증 후 `requireIndexedTicker` 순서를 지킨다

---

### Task 1: 구독 서비스 추출 (`subscription-service.ts`)

**Files:**
- Create: `src/lib/filing-notifications/subscription-service.ts`
- Modify: `src/app/api/filing-subscriptions/[ticker]/route.ts`
- Test: `src/lib/filing-notifications/subscription-service.test.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin`(`@/lib/supabase/admin`), `ensureSecCompanyIdentifier`(`@/lib/filing-notifications/company-identifiers`)
- Produces (Task 2가 소비):
  - `enableFilingSubscription(input: { userId: string; ticker: string }): Promise<{ status: "on" } | { status: "unsupported" } | { status: "error" }>` — "unsupported"는 SEC 식별자 없음(기존 422 케이스)
  - `disableFilingSubscription(input: { userId: string; ticker: string }): Promise<boolean>` — 해제 성공 여부. 이미 꺼져 있으면 true

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/lib/filing-notifications/subscription-service.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const upsert = vi.fn();
const update = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "user_filing_subscriptions")
        return { upsert, update };
      return { upsert };
    },
  }),
}));
vi.mock("@/lib/filing-notifications/company-identifiers", () => ({
  ensureSecCompanyIdentifier: vi.fn(),
  normalizeFilingTicker: vi.fn(),
}));

import { ensureSecCompanyIdentifier } from "@/lib/filing-notifications/company-identifiers";
import { enableFilingSubscription } from "./subscription-service";

describe("enableFilingSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ensureSecCompanyIdentifier).mockResolvedValue({
      cik: "0000320193",
    } as never);
  });

  it("returns on after a successful upsert and poll-state sync", async () => {
    upsert.mockResolvedValue({ data: {}, error: null });
    const result = await enableFilingSubscription({ userId: "u1", ticker: "AAPL" });
    expect(result).toEqual({ status: "on" });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "u1",
        ticker: "AAPL",
        cik: "0000320193",
        enabled: true,
        disabled_at: null,
      }),
      { onConflict: "user_id,ticker" },
    );
  });

  it("returns unsupported when the SEC identifier is missing", async () => {
    vi.mocked(ensureSecCompanyIdentifier).mockResolvedValue(null as never);
    const result = await enableFilingSubscription({ userId: "u1", ticker: "XXXX" });
    expect(result).toEqual({ status: "unsupported" });
  });

  it("returns error when the upsert fails", async () => {
    upsert.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await enableFilingSubscription({ userId: "u1", ticker: "AAPL" });
    expect(result).toEqual({ status: "error" });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/filing-notifications/subscription-service.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// src/lib/filing-notifications/subscription-service.ts
import { ensureSecCompanyIdentifier } from "@/lib/filing-notifications/company-identifiers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type EnableFilingSubscriptionResult =
  | { status: "on" }
  | { status: "unsupported" }
  | { status: "error" };

/** 관심=알림 통일: 구독 생성은 개수 검사 없이 여기서만. 상한은 coverage 한도가 좌우한다. */
export async function enableFilingSubscription(input: {
  userId: string;
  ticker: string;
}): Promise<EnableFilingSubscriptionResult> {
  try {
    const admin = getSupabaseAdmin();
    const identifier = await ensureSecCompanyIdentifier(input.ticker);
    if (!identifier?.cik) return { status: "unsupported" };
    const now = new Date().toISOString();
    const { error } = await admin
      .from("user_filing_subscriptions")
      .upsert(
        {
          user_id: input.userId,
          ticker: input.ticker,
          cik: identifier.cik,
          enabled: true,
          subscribed_at: now,
          disabled_at: null,
        },
        { onConflict: "user_id,ticker" },
      );
    if (error) return { status: "error" };
    const [{ error: pollError }, { error: preferenceError }] = await Promise.all([
      admin
        .from("sec_filing_poll_state")
        .upsert({ cik: identifier.cik, enabled: true, next_poll_at: now }, { onConflict: "cik" }),
      admin
        .from("filing_notification_preferences")
        .upsert({ user_id: input.userId }, { onConflict: "user_id", ignoreDuplicates: true }),
    ]);
    if (pollError || preferenceError) return { status: "error" };
    return { status: "on" };
  } catch {
    return { status: "error" };
  }
}

export async function disableFilingSubscription(input: {
  userId: string;
  ticker: string;
}): Promise<boolean> {
  try {
    const admin = getSupabaseAdmin();
    const now = new Date().toISOString();
    const { error } = await admin
      .from("user_filing_subscriptions")
      .update({ enabled: false, disabled_at: now })
      .eq("user_id", input.userId)
      .eq("ticker", input.ticker)
      .eq("enabled", true);
    return !error;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/filing-notifications/subscription-service.test.ts`
Expected: PASS

- [ ] **Step 5: 기존 라우트 재배선 (동작 보존)**

`src/app/api/filing-subscriptions/[ticker]/route.ts` PUT 본문 중 `ensureSecCompanyIdentifier` ~ poll_state/preferences upsert 구간(route.ts:48-79)을 `enableFilingSubscription` 호출로 교체. 20개 카운트 검사와 409/422/503 매핑, 마일스톤은 라우트에 그대로 둔다:

```ts
const subscriptionResult = await enableFilingSubscription({ userId: auth.user.id, ticker });
if (subscriptionResult.status === "unsupported") {
  return Response.json({ error: { code: "unsupported_company", message: "SEC 공시 식별자를 찾지 못했습니다." } }, { status: 422 });
}
if (subscriptionResult.status === "error") {
  return Response.json({ error: { code: "service_unavailable", message: "공시 구독을 저장하지 못했습니다. 잠시 후 다시 시도해주세요." } }, { status: 503 });
}
```

(기존 응답의 `subscription` row 반환이 필요하므로 upsert 뒤 `.select("*").single()` 재조회를 라우트에서 수행하거나, 응답에서 row를 제거하는 경우 호출자가 없음을 먼저 확인할 것. 이 라우트의 live UI 호출자는 Task 5 이후 0명이다.)

DELETE 본문의 disable 로직(route.ts:107-122)도 `disableFilingSubscription` 사용으로 교체하되 poll_state disable(마지막 구독자일 때)은 라우트에 유지.

- [ ] **Step 6: 기존 라우트 테스트 + 커밋**

Run: `npx vitest run src/app/api/filing-subscriptions` (기존 테스트 없으면 통과 확인만)

```bash
git add src/lib/filing-notifications/subscription-service.ts src/lib/filing-notifications/subscription-service.test.ts "src/app/api/filing-subscriptions/[ticker]/route.ts"
git commit -m "refactor(filing-notifications): extract subscription enable/disable service"
```

---

### Task 2: follow 서비스 (`company-follow.ts`)

**Files:**
- Create: `src/lib/follow/company-follow.ts`
- Test: `src/lib/follow/company-follow.test.ts`

**Interfaces:**
- Consumes: `setCompanyCoverageLevelWithEvent`, `CoverageLimitError`(`@/lib/coverage/repository`), Task 1의 구독 서비스, `setMarketIssueCompanyFollow`(`@/lib/market-issues/repository`, 시그니처 `{db, userId, ticker, following}`), `getMarketIssueServiceClient`(`@/lib/market-issues/service`), `recordRetentionMilestone`(`@/lib/retention/milestones`)
- Produces (Task 3/10이 소비):
  - `type FollowAlertsStatus = "on" | "no_sec_id"`
  - `followCompanyServer(input: { userId: string; userEmail: string; ticker: string; source?: string }): Promise<FollowCompanyResult>`
  - `unfollowCompanyServer(input: { userId: string; userEmail: string; ticker: string }): Promise<{ ok: boolean }>`
  - `type FollowCompanyResult = { ok: true; mark: UserCompanyMark | null; alerts: FollowAlertsStatus; newsFollow: boolean; coverageResult: CompanyCoverageMutationResult } | { ok: false; reason: "limit_reached" | "error" }`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/lib/follow/company-follow.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/coverage/repository", () => ({
  CoverageLimitError: class CoverageLimitError extends Error {},
  setCompanyCoverageLevelWithEvent: vi.fn(),
}));
vi.mock("@/lib/filing-notifications/subscription-service", () => ({
  enableFilingSubscription: vi.fn(),
  disableFilingSubscription: vi.fn(),
}));
vi.mock("@/lib/market-issues/service", () => ({
  getMarketIssueServiceClient: vi.fn(() => ({ marker: "market-issue-db" })),
}));
vi.mock("@/lib/market-issues/repository", () => ({
  setMarketIssueCompanyFollow: vi.fn(),
}));
vi.mock("@/lib/retention/milestones", () => ({
  recordRetentionMilestone: vi.fn(),
}));

import { setCompanyCoverageLevelWithEvent } from "@/lib/coverage/repository";
import { enableFilingSubscription } from "@/lib/filing-notifications/subscription-service";
import { setMarketIssueCompanyFollow } from "@/lib/market-issues/repository";
import { recordRetentionMilestone } from "@/lib/retention/milestones";
import { followCompanyServer, unfollowCompanyServer } from "./company-follow";

const coverageResult = {
  mark: { ticker: "AAPL", coverage_level: "interest" },
  eventId: "e1",
  previousLevel: null,
  changed: true,
  idempotentReplay: false,
};

describe("followCompanyServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setCompanyCoverageLevelWithEvent).mockResolvedValue(coverageResult as never);
    vi.mocked(enableFilingSubscription).mockResolvedValue({ status: "on" });
    vi.mocked(setMarketIssueCompanyFollow).mockResolvedValue(undefined as never);
  });

  it("marks coverage, enables alerts and news follow together", async () => {
    const result = await followCompanyServer({ userId: "u1", userEmail: "u@t", ticker: "AAPL" });
    expect(result).toMatchObject({ ok: true, alerts: "on", newsFollow: true });
    expect(setCompanyCoverageLevelWithEvent).toHaveBeenCalledWith(
      expect.objectContaining({ coverageLevel: "interest", ticker: "AAPL" }),
    );
    expect(setMarketIssueCompanyFollow).toHaveBeenCalledWith(
      expect.objectContaining({ following: true }),
    );
    expect(recordRetentionMilestone).toHaveBeenCalledWith("u1", "first_company_followed", { ticker: "AAPL" });
    expect(recordRetentionMilestone).toHaveBeenCalledWith("u1", "first_filing_subscription", { ticker: "AAPL" });
  });

  it("degrades alerts to no_sec_id without failing the follow", async () => {
    vi.mocked(enableFilingSubscription).mockResolvedValue({ status: "unsupported" });
    const result = await followCompanyServer({ userId: "u1", userEmail: "u@t", ticker: "XXXX" });
    expect(result).toMatchObject({ ok: true, alerts: "no_sec_id" });
    expect(recordRetentionMilestone).not.toHaveBeenCalledWith("u1", "first_filing_subscription", expect.anything());
  });

  it("reports limit_reached without touching subscriptions", async () => {
    vi.mocked(setCompanyCoverageLevelWithEvent).mockRejectedValue(new (vi.mocked(await import("@/lib/coverage/repository")).CoverageLimitError as never as new () => Error)());
    const result = await followCompanyServer({ userId: "u1", userEmail: "u@t", ticker: "AAPL" });
    expect(result).toEqual({ ok: false, reason: "limit_reached" });
    expect(enableFilingSubscription).not.toHaveBeenCalled();
  });

  it("survives a news-follow failure", async () => {
    vi.mocked(setMarketIssueCompanyFollow).mockRejectedValue(new Error("db down"));
    const result = await followCompanyServer({ userId: "u1", userEmail: "u@t", ticker: "AAPL" });
    expect(result).toMatchObject({ ok: true, newsFollow: false });
  });
});

describe("unfollowCompanyServer", () => {
  it("clears coverage, disables alerts, unfollows news", async () => {
    vi.mocked(setCompanyCoverageLevelWithEvent).mockResolvedValue({ ...coverageResult, mark: { ticker: "AAPL", coverage_level: null } } as never);
    vi.mocked(disableFilingSubscription).mockResolvedValue(true);
    const result = await unfollowCompanyServer({ userId: "u1", userEmail: "u@t", ticker: "AAPL" });
    expect(result).toEqual({ ok: true });
    expect(setCompanyCoverageLevelWithEvent).toHaveBeenCalledWith(expect.objectContaining({ coverageLevel: null }));
    expect(disableFilingSubscription).toHaveBeenCalledWith({ userId: "u1", ticker: "AAPL" });
    expect(setMarketIssueCompanyFollow).toHaveBeenCalledWith(expect.objectContaining({ following: false }));
  });
});
```

(import of disableFilingSubscription 임포트 누락 주의: 상단 mock import 블록에 추가.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/follow/company-follow.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// src/lib/follow/company-follow.ts
import {
  CoverageLimitError,
  setCompanyCoverageLevelWithEvent,
  type CompanyCoverageMutationResult,
} from "@/lib/coverage/repository";
import {
  disableFilingSubscription,
  enableFilingSubscription,
} from "@/lib/filing-notifications/subscription-service";
import { setMarketIssueCompanyFollow } from "@/lib/market-issues/repository";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";
import { recordRetentionMilestone } from "@/lib/retention/milestones";
import type { UserCompanyMark } from "@/types/api-contracts";

export type FollowAlertsStatus = "on" | "no_sec_id";

export type FollowCompanyResult =
  | {
      ok: true;
      mark: UserCompanyMark | null;
      alerts: FollowAlertsStatus;
      newsFollow: boolean;
      coverageResult: CompanyCoverageMutationResult;
    }
  | { ok: false; reason: "limit_reached" | "error" };

export async function followCompanyServer(input: {
  userId: string;
  userEmail: string;
  ticker: string;
  source?: string;
}): Promise<FollowCompanyResult> {
  try {
    let coverageResult: CompanyCoverageMutationResult;
    try {
      coverageResult = await setCompanyCoverageLevelWithEvent({
        userId: input.userId,
        userEmail: input.userEmail,
        ticker: input.ticker,
        coverageLevel: "interest",
        source: input.source ?? "company_follow",
      });
    } catch (error) {
      if (error instanceof CoverageLimitError) {
        return { ok: false, reason: "limit_reached" };
      }
      throw error;
    }
    if (coverageResult.changed && !coverageResult.idempotentReplay && coverageResult.previousLevel === null) {
      await recordRetentionMilestone(input.userId, "first_company_followed", {
        ticker: input.ticker,
      });
    }
    const [alerts, newsFollow] = await Promise.all([
      enableFilingSubscription({ userId: input.userId, ticker: input.ticker }),
      setMarketIssueCompanyFollow({
        db: getMarketIssueServiceClient(),
        userId: input.userId,
        ticker: input.ticker,
        following: true,
      })
        .then(() => true)
        .catch(() => false),
    ]);
    if (alerts.status === "on") {
      await recordRetentionMilestone(input.userId, "first_filing_subscription", {
        ticker: input.ticker,
      });
    }
    return {
      ok: true,
      mark: coverageResult.mark,
      alerts: alerts.status === "on" ? "on" : "no_sec_id",
      newsFollow,
      coverageResult,
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function unfollowCompanyServer(input: {
  userId: string;
  userEmail: string;
  ticker: string;
}): Promise<{ ok: boolean }> {
  try {
    await setCompanyCoverageLevelWithEvent({
      userId: input.userId,
      userEmail: input.userEmail,
      ticker: input.ticker,
      coverageLevel: null,
      source: "company_unfollow",
    });
    await disableFilingSubscription({ userId: input.userId, ticker: input.ticker }).catch(
      () => null,
    );
    await setMarketIssueCompanyFollow({
      db: getMarketIssueServiceClient(),
      userId: input.userId,
      ticker: input.ticker,
      following: false,
    }).catch(() => null);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
```

- [ ] **Step 4: 테스트 통과 + 커밋**

Run: `npx vitest run src/lib/follow/company-follow.test.ts` → PASS

```bash
git add src/lib/follow/company-follow.ts src/lib/follow/company-follow.test.ts
git commit -m "feat(follow): add unified company follow service"
```

---

### Task 3: 통합 라우트

**Files:**
- Create: `src/app/api/companies/[ticker]/follow/route.ts`
- Test: `src/app/api/companies/[ticker]/follow/route.test.ts`

**Interfaces:**
- Consumes: Task 2 `followCompanyServer`/`unfollowCompanyServer`, `recordCoverageMutationAnalytics(request, userId, result, "watchlist")`(`@/lib/coverage/analytics`)
- Produces (Task 4 훅이 소비):
  - `PUT /api/companies/[ticker]/follow` → 200 `{ mark, alerts: "on"|"no_sec_id", news_follow }` / 409 `{error:{code:"coverage_limit_reached", message}}` / 401 / 503
  - `DELETE /api/companies/[ticker]/follow` → 200 `{ ok: true }` / 401 / 503

- [ ] **Step 1: 실패 테스트 작성** (mock 패턴은 `src/app/api/watchlist/[ticker]/route.test.ts` 참조)

```ts
// src/app/api/companies/[ticker]/follow/route.test.ts
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  handleAuthError: vi.fn(() => Response.json({ error: { code: "auth_required" } }, { status: 401 })),
}));
vi.mock("@/lib/coverage/analytics", () => ({ recordCoverageMutationAnalytics: vi.fn() }));
vi.mock("@/lib/follow/company-follow", () => ({
  followCompanyServer: vi.fn(),
  unfollowCompanyServer: vi.fn(),
}));
vi.mock("@/lib/filing-notifications/request", () => ({
  isExpectedMutationOrigin: vi.fn(() => true),
  invalidOriginResponse: vi.fn(() => Response.json({ error: { code: "forbidden" } }, { status: 403 })),
}));
vi.mock("@/lib/watchlist/api", () => ({
  errorResponse: vi.fn((status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
  ),
  requireIndexedTicker: vi.fn(async () => ({ ok: true, ticker: "AAPL" })),
}));

import { getAuthUser } from "@/lib/auth";
import { followCompanyServer } from "@/lib/follow/company-follow";
import { PUT, DELETE } from "./route";

const params = Promise.resolve({ ticker: "AAPL" });

describe("company follow route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({ id: "u1", email: "u@t" } as never);
  });

  it("returns the unified follow payload", async () => {
    vi.mocked(followCompanyServer).mockResolvedValue({
      ok: true, mark: { ticker: "AAPL" }, alerts: "on", newsFollow: true,
      coverageResult: {} as never,
    } as never);
    const response = await PUT(new NextRequest("http://localhost/api/companies/AAPL/follow", { method: "PUT" }), { params });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ mark: { ticker: "AAPL" }, alerts: "on", news_follow: true });
  });

  it("maps limit_reached to 409 coverage_limit_reached", async () => {
    vi.mocked(followCompanyServer).mockResolvedValue({ ok: false, reason: "limit_reached" } as never);
    const response = await PUT(new NextRequest("http://localhost/api/companies/AAPL/follow", { method: "PUT" }), { params });
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error.code).toBe("coverage_limit_reached");
  });

  it("requires auth", async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null as never);
    const response = await PUT(new NextRequest("http://localhost/api/companies/AAPL/follow", { method: "PUT" }), { params });
    expect(response.status).toBe(401);
  });
});
```

DELETE 케이스도 동일 구조로 2개(성공/503) 추가.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/app/api/companies` → FAIL

- [ ] **Step 3: 구현**

```ts
// src/app/api/companies/[ticker]/follow/route.ts
import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { recordCoverageMutationAnalytics } from "@/lib/coverage/analytics";
import { followCompanyServer, unfollowCompanyServer } from "@/lib/follow/company-follow";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { errorResponse, requireIndexedTicker } from "@/lib/watchlist/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT_MESSAGE =
  "관심 기업은 무료 플랜에서 3개까지예요. 무제한 관심·알림은 유료 플랜에서 만날 수 있어요.";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const tickerResult = await requireIndexedTicker((await params).ticker);
  if (!tickerResult.ok) return tickerResult.response;

  const result = await followCompanyServer({
    userId: user.id,
    userEmail: user.email,
    ticker: tickerResult.ticker,
    source: "company_follow_api",
  });
  if (result.ok) {
    await recordCoverageMutationAnalytics(request, user.id, result.coverageResult, "watchlist");
    return Response.json({
      mark: result.mark,
      alerts: result.alerts,
      news_follow: result.newsFollow,
    });
  }
  if (result.reason === "limit_reached") {
    return errorResponse(409, "coverage_limit_reached", LIMIT_MESSAGE);
  }
  return errorResponse(503, "service_unavailable", "관심 상태를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.");
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const tickerResult = await requireIndexedTicker((await params).ticker);
  if (!tickerResult.ok) return tickerResult.response;

  const result = await unfollowCompanyServer({
    userId: user.id,
    userEmail: user.email,
    ticker: tickerResult.ticker,
  });
  if (result.ok) return Response.json({ ok: true });
  return errorResponse(503, "service_unavailable", "관심 상태를 해제하지 못했습니다. 잠시 후 다시 시도해주세요.");
}
```

- [ ] **Step 4: 테스트 통과 + 커밋**

Run: `npx vitest run src/app/api/companies` → PASS

```bash
git add "src/app/api/companies/[ticker]/follow"
git commit -m "feat(follow): unified company follow endpoint"
```

---

### Task 4: 클라이언트 훅 + 순수 푸시 사다리

**Files:**
- Create: `src/lib/follow/use-company-follow.ts`
- Test: `src/lib/follow/push-plan.test.ts` (훅 파일에서 `planPushEnable`을 export)

**Interfaces:**
- Consumes: `normalizeTicker`(`@/lib/ontology/ticker`), `trackClientEventSilently`(`@/lib/analytics/client`), `isIOSBrowser`/`isStandaloneDisplayMode`/`isWebPushSupported`(`@/lib/filing-notifications/client`), `getCurrentDevicePushSubscription`/`subscribeCurrentDevice`(`@/lib/filing-notifications/push-subscription-client`), `signalPwaInstallEngagement`(`@/components/pwa/lifecycle`), VAPID `process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- Produces (Task 5/6/7이 소비):
  - `planPushEnable(input: { pushReady: boolean; webPushSupported: boolean; vapidKey: string; permission: NotificationPermission | "unsupported"; iOS: boolean; standalone: boolean }): "already" | "prompt" | "install" | "denied" | "skipped"` (순수 함수)
  - `useCompanyFollow(ticker: string, options?: { surface?: string }): CompanyFollowState`
  - `type CompanyFollowState = { loading: boolean; following: boolean; alerts: "on" | "no_sec_id" | null; limitReached: boolean; error: boolean; follow: () => Promise<{ ok: boolean }>; unfollow: () => Promise<{ ok: boolean }>; reload: () => Promise<void> }`

- [ ] **Step 1: 순수 함수 실패 테스트**

```ts
// src/lib/follow/push-plan.test.ts
import { describe, expect, it } from "vitest";
import { planPushEnable } from "./use-company-follow";

const base = {
  pushReady: false,
  webPushSupported: true,
  vapidKey: "key",
  permission: "default" as NotificationPermission,
  iOS: false,
  standalone: false,
};

describe("planPushEnable", () => {
  it("already on when the device subscription exists", () => {
    expect(planPushEnable({ ...base, pushReady: true })).toBe("already");
  });
  it("install on iOS without standalone", () => {
    expect(planPushEnable({ ...base, iOS: true })).toBe("install");
  });
  it("denied when the browser permission is denied", () => {
    expect(planPushEnable({ ...base, permission: "denied" })).toBe("denied");
  });
  it("skipped when web push or vapid is missing", () => {
    expect(planPushEnable({ ...base, webPushSupported: false })).toBe("skipped");
    expect(planPushEnable({ ...base, vapidKey: "" })).toBe("skipped");
  });
  it("prompt otherwise", () => {
    expect(planPushEnable(base)).toBe("prompt");
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/follow/push-plan.test.ts` → FAIL

- [ ] **Step 3: 훅 구현**

```ts
// src/lib/follow/use-company-follow.ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { signalPwaInstallEngagement } from "@/components/pwa/lifecycle";
import { trackClientEventSilently } from "@/lib/analytics/client";
import {
  isIOSBrowser,
  isStandaloneDisplayMode,
  isWebPushSupported,
} from "@/lib/filing-notifications/client";
import {
  getCurrentDevicePushSubscription,
  subscribeCurrentDevice,
} from "@/lib/filing-notifications/push-subscription-client";
import { normalizeTicker } from "@/lib/ontology/ticker";

export type PushPlan = "already" | "prompt" | "install" | "denied" | "skipped";

export function planPushEnable(input: {
  pushReady: boolean;
  webPushSupported: boolean;
  vapidKey: string;
  permission: NotificationPermission | "unsupported";
  iOS: boolean;
  standalone: boolean;
}): PushPlan {
  if (input.pushReady) return "already";
  if (input.iOS && !input.standalone) return "install";
  if (input.permission === "denied") return "denied";
  if (!input.webPushSupported || !input.vapidKey || input.permission === "unsupported") return "skipped";
  return "prompt";
}

export type CompanyFollowState = {
  loading: boolean;
  following: boolean;
  alerts: "on" | "no_sec_id" | null;
  limitReached: boolean;
  error: boolean;
  follow: () => Promise<{ ok: boolean }>;
  unfollow: () => Promise<{ ok: boolean }>;
  reload: () => Promise<void>;
};

/** 관심 = 알림. 토글 하나가 관심종목 + 공시 구독 + 뉴스 팔로우를 함께 처리한다. */
export function useCompanyFollow(
  ticker: string,
  options?: { surface?: string },
): CompanyFollowState {
  const normalizedTicker = normalizeTicker(ticker);
  const surface = options?.surface ?? "company_follow";
  const [loading, setLoading] = useState(Boolean(normalizedTicker));
  const [following, setFollowing] = useState(false);
  const [alerts, setAlerts] = useState<"on" | "no_sec_id" | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    if (!normalizedTicker) return;
    try {
      const response = await fetch(
        `/api/watchlist/${encodeURIComponent(normalizedTicker)}/coverage-level`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const payload = (await response.json()) as { mark?: { coverage_level?: string | null } | null };
      setFollowing(Boolean(payload.mark?.coverage_level));
    } catch {
      // 조회 실패는 조용히 둔다(표면별 안내에 맡김).
    } finally {
      setLoading(false);
    }
  }, [normalizedTicker]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const ensurePush = useCallback(async (): Promise<PushPlan> => {
    const subscription = await getCurrentDevicePushSubscription().catch(() => null);
    const permission: NotificationPermission | "unsupported" =
      typeof Notification === "undefined" ? "unsupported" : Notification.permission;
    const plan = planPushEnable({
      pushReady: Boolean(subscription),
      webPushSupported: isWebPushSupported(),
      vapidKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "",
      permission,
      iOS: isIOSBrowser(),
      standalone: isStandaloneDisplayMode(),
    });
    if (plan === "install") {
      signalPwaInstallEngagement("install_requested", surface);
      return plan;
    }
    if (plan !== "prompt") return plan;
    trackClientEventSilently("push_permission_prompted", { surface });
    const outcome = await subscribeCurrentDevice(
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "",
    ).catch(() => null);
    trackClientEventSilently(
      outcome === "granted" ? "push_subscribed" : "push_permission_denied",
      { surface },
    );
    return outcome === "granted" ? "already" : outcome === "denied" ? "denied" : "skipped";
  }, [surface]);

  const follow = useCallback(async () => {
    if (!normalizedTicker) return { ok: false };
    setError(false);
    try {
      const response = await fetch(
        `/api/companies/${encodeURIComponent(normalizedTicker)}/follow`,
        { method: "PUT" },
      );
      if (response.status === 409) {
        setLimitReached(true);
        return { ok: false };
      }
      if (!response.ok) throw new Error("follow_failed");
      const payload = (await response.json()) as { alerts?: "on" | "no_sec_id" };
      setFollowing(true);
      setAlerts(payload.alerts ?? null);
      trackClientEventSilently("company_followed", { surface, ticker: normalizedTicker });
      trackClientEventSilently("filing_subscription_created", { surface, ticker: normalizedTicker });
      await ensurePush();
      return { ok: true };
    } catch {
      setError(true);
      return { ok: false };
    }
  }, [ensurePush, normalizedTicker, surface]);

  const unfollow = useCallback(async () => {
    if (!normalizedTicker) return { ok: false };
    setError(false);
    try {
      const response = await fetch(
        `/api/companies/${encodeURIComponent(normalizedTicker)}/follow`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("unfollow_failed");
      setFollowing(false);
      setAlerts(null);
      trackClientEventSilently("company_unfollowed", { surface, ticker: normalizedTicker });
      trackClientEventSilently("filing_subscription_removed", { surface, ticker: normalizedTicker });
      return { ok: true };
    } catch {
      setError(true);
      return { ok: false };
    }
  }, [normalizedTicker, surface]);

  return { loading, following, alerts, limitReached, error, follow, unfollow, reload };
}
```

주의: `filing_subscription_created`는 알림이 실제로 켜진 경우에만(`alerts === "on"`) 발화하도록 follow 내부에서 조건을 걸 것(`no_sec_id`면 스킵 — 서버가 milestone을 건너뛰는 것과 정렬).

- [ ] **Step 4: 테스트 통과 + 커밋**

Run: `npx vitest run src/lib/follow` → PASS

```bash
git add src/lib/follow/use-company-follow.ts src/lib/follow/push-plan.test.ts
git commit -m "feat(follow): useCompanyFollow hook with shared push ladder"
```

---

### Task 5: 챗 답변 CTA 리팩터 + 한도 초과 업그레이드 UX

**Files:**
- Modify: `src/components/chat/ChatAnswerFollowCta.tsx`

**Interfaces:**
- Consumes: Task 4 `useCompanyFollow(ticker, { surface: "chat_answer" })`
- Produces: 동일 렌더링 계약(`data-answer-follow-cta` 속성, done/idle/failed 상태 카피) + 신규 `limit` 상태

- [ ] **Step 1: 기존 인라인 로직 제거 및 훅 적용**

`handleFollow`의 3중 fetch(watchlist PATCH / filing-subscriptions PUT / news follow PUT)와 푸시 사다리를 훅 호출로 교체:

```tsx
const followState = useCompanyFollow(normalizedTicker, { surface: "chat_answer" });

const handleFollow = useCallback(async () => {
  if (state === "working" || state === "done") return;
  setState("working");
  trackClientEventSilently("cta_clicked", { cta_id: "answer_follow_cta", surface: "chat_answer", ticker: normalizedTicker });
  const result = await followState.follow();
  if (result.ok) {
    setDigestLimited(followState.alerts === "no_sec_id");
    // pushOutcome은 훅이 처리하므로 여기선 granted/skipped 요약만: followState.alerts 기반 문구 선택
    setPushOutcome("granted");
    setState("done");
  } else if (followState.limitReached) {
    setState("idle"); // limit UI는 별도 상태로 렌더
  } else {
    setState("failed");
  }
}, [followState, normalizedTicker, state]);
```

로드/숨김 로직(`loadState`: coverage-level GET + push 구독 확인 → `hidden = followed && pushReady`)은 훅의 `following` + `getCurrentDevicePushSubscription`으로 재구성해 동일하게 유지한다.

- [ ] **Step 2: 한도 초과 UI 추가**

`DONE_MESSAGE` 아래에 신규 문구와 /pricing 링크:

```tsx
const LIMIT_BLOCK = (
  <div data-answer-follow-cta="limit" className="mx-auto mt-xs flex w-full max-w-4xl flex-wrap items-center gap-x-sm gap-y-xs rounded-[10px] border border-hairline bg-surface-soft px-sm py-sm">
    <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-primary">lock</span>
    <p className="min-w-0 flex-1 text-[13px] font-extrabold leading-[1.4] text-ink">
      관심 기업이 가득 찼어요 · 무료 플랜은 3개까지
      <span className="ml-xs text-[12px] font-medium text-muted">무제한 관심·알림은 유료 플랜</span>
    </p>
    <Link href="/pricing" className="text-[12px] font-bold text-primary underline-offset-2 hover:underline">플랜 보기</Link>
  </div>
);
```

- [ ] **Step 3: 수동 검증 + 커밋**

Run: `npm run lint && npx vitest run src/components/chat` (기존 CTA 테스트 없음 → 타입/린트 게이트)

```bash
git add src/components/chat/ChatAnswerFollowCta.tsx
git commit -m "refactor(chat): answer CTA rides useCompanyFollow with limit upsell"
```

---

### Task 6: 챗 헤더 + 기업 페이지 진입점 교체

**Files:**
- Modify: `src/components/chat/ChatWatchlistHeaderActions.tsx` (saveCoverageLevel, 109-131행)
- Modify: `src/components/CompanyWatchlistActions.tsx` (saveCoverageLevel, 66-110행)

**Interfaces:**
- Consumes: Task 4 훅 (surface: "chat_header", "company_hero")

- [ ] **Step 1: ChatWatchlistHeaderActions 교체**

`saveCoverageLevel`의 PATCH fetch를 다음으로 교체 (노트북 onboarding 로직은 불변):

```ts
async function saveCoverageLevel(nextLevel: CoverageLevel) {
  if (!normalizedTicker || pendingLevel) return;
  const currentLevel = coverageLevelOf(mark);
  if (currentLevel === nextLevel) return; // 토글 OFF
  setPendingLevel(nextLevel);
  try {
    const result = nextLevel === "interest"
      ? await followState.follow()
      : await followState.unfollow();
    if (!result.ok) throw new Error("Failed to save watchlist mark");
    await followState.reload();
  } finally {
    setPendingLevel(null);
  }
}
```

409(한도) 시 안내: `followState.limitReached`이면 기존 에러 영역 대신 "관심 기업은 무료 플랜 3개까지예요" 짧은 문구 + /pricing 링크 표시.

- [ ] **Step 2: CompanyWatchlistActions 교체**

`saveCoverageLevel`의 PATCH를 동일 구조로 교체. 기존 `cta_clicked(company_coverage_level_changed)` 분석과 `signalPwaInstallEngagement("watch_added", "company_hero")`, `company_followed` 이벤트는 유지하되 `company_followed`는 훅이 발화하므로 중복 발사 제거. 실패 시 기존 `labels.error` 대신 409면 한도 문구.

- [ ] **Step 3: 린트/타입체크 + 커밋**

Run: `npm run typecheck && npm run lint`

```bash
git add src/components/chat/ChatWatchlistHeaderActions.tsx src/components/CompanyWatchlistActions.tsx
git commit -m "feat(follow): chat header and company hero follow buttons drive alerts"
```

---

### Task 7: 워크스페이스 + 온보딩 교체, 고아 삭제

**Files:**
- Modify: `src/components/watchlist/WatchlistWorkspaceClient.tsx` (updateCoverageLevel, 228-248행)
- Modify: `src/components/onboarding/FirstValueFilingActions.tsx` (PATCH 호출, 27행 부근)
- Delete: `src/components/filings/CompanyFilingSubscriptionControl.tsx`, `src/components/filings/FilingSubscriptionList.tsx`

- [ ] **Step 1: WorkspaceClient 교체**

`updateCoverageLevel(coverageLevel)` 내부: `null`이면 `DELETE /api/companies/{ticker}/follow`, `"interest"`면 `PUT`. 응답 `mark` 갱신 로직은 유지(PUT 응답에 mark 있음).

- [ ] **Step 2: FirstValueFilingActions 교체**

PATCH `/api/watchlist/...`를 PUT `/api/companies/.../follow`로 교체. 바디/분석 이벤트 불변.

- [ ] **Step 3: 고아 삭제 + 참조 확인**

```bash
grep -rn "CompanyFilingSubscriptionControl\|FilingSubscriptionList" src --include="*.tsx" --include="*.ts" | grep -v "components/filings/CompanyFilingSubscriptionControl\|components/filings/FilingSubscriptionList"
# 결과가 0개(자기 자신/테스트 제외) 확인 후
git rm src/components/filings/CompanyFilingSubscriptionControl.tsx src/components/filings/FilingSubscriptionList.tsx
```

(각자 `.test.ts`가 있으면 함께 삭제)

- [ ] **Step 4: 게이트 + 커밋**

Run: `npm run typecheck && npm run lint && npx vitest run src/components/watchlist src/components/onboarding`

```bash
git add -A src/components/watchlist/WatchlistWorkspaceClient.tsx src/components/onboarding/FirstValueFilingActions.tsx src/components/filings
git commit -m "refactor(follow): workspace/onboarding ride unified follow; drop orphaned subscription UI"
```

---

### Task 8: reconcile 마이그레이션 (강등 시 구독 해제)

**Files:**
- Create: `supabase/migrations/20260820120000_follow_unification_reconcile_disables_alerts.sql`

**Interfaces:**
- Consumes: `20260721000000_unify_company_coverage_interest.sql`의 `reconcile_user_company_coverage_limit` 전체 본문(복사 기반 재정의)
- Produces: 강등 루프 내 monitoring_rules disable 직후 구독 해제

- [ ] **Step 1: 마이그레이션 작성**

기존 함수 본문을 통째로 복사해 `create or replace` 하고, demotion 루프의 `update public.user_company_monitoring_rules ...` 바로 뒤에 추가:

```sql
-- 관심=알림 통일: 강등으로 관심이 해제되면 공시·뉴스 알림 구독도 함께 끈다.
-- (이전에는 구독이 남아 관심목록에서 사라진 종목의 알림이 계속 갔다 — 좀비 알림.)
update public.user_filing_subscriptions sub
set enabled = false,
    disabled_at = now()
where sub.user_id = p_user_id
  and sub.ticker = v_mark.ticker
  and sub.enabled;
```

파일 상단 주석에 목적/근거(스펙 문서 링크) 기입.

- [ ] **Step 2: 로컬 검증**

```bash
supabase migration up --local   # 또는 dev 런북의 migration 흐름(supabase migration up)
# 로컬 DB에서 수동 검증:
# 1) 테스트 사용자에 active 마크 4개 + enabled 구독 4개 세팅
# 2) reconcile_user_company_coverage_limit(user, 3, NULL) 호출
# 3) user_company_marks 4번째가 null, user_filing_subscriptions 해당 ticker enabled=false 확인
```

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/20260820120000_follow_unification_reconcile_disables_alerts.sql
git commit -m "fix(coverage): reconcile disables filing subscriptions on demotion"
```

---

### Task 9: pricing 카피

**Files:**
- Modify: `src/app/[locale]/(public)/pricing/page.tsx` (피처 라벨 ~80행, free 카피 ~277행 + en 대응)

- [ ] **Step 1: 카피 수정**

- ko 피처 라벨: `관심 기업 저장` → `관심 기업 저장 · 새 소식 알림`
- ko free 카피: `모든 리서치 모드와 공시 기반 분석을 시작하고 관심 기업 3개를 저장할 수 있습니다.` → `...관심 기업 3개를 저장하고 새 소식 알림을 받을 수 있습니다.`
- en 대응 라벨/카피 동일 수정 (파일 내 en 블록에서 `Save companies`/`Save 3 companies`류 문구 확인 후 알림 언급 추가)

- [ ] **Step 2: 게이트 + 커밋**

Run: `npm run typecheck && npm run lint`

```bash
git add "src/app/[locale]/(public)/pricing/page.tsx"
git commit -m "docs(pricing): follow feature copy now includes alerts"
```

---

### Task 10: 백필 스크립트

**Files:**
- Create: `scripts/follow-unification-backfill.mjs`

**Interfaces:**
- Consumes: `scripts/backfill-active-catalog-sec-identifiers.mjs`의 부트스트랩 패턴(`.env.production` + `--env-file` 로딩 → `SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`)
- Produces: prod 직접 실행 스크립트. `--dry-run`(기본 on), `--apply`

- [ ] **Step 1: 스크립트 작성**

```js
#!/usr/bin/env node
// 관심=알림 통일 백필: 기존 유저의 갈라진 상태를 치유한다.
// 1) 구독만 있고 관심 없음 → 관심 마킹 (free는 최신 3개까지만, `set_user_company_coverage_level` RPC가 3 초과 시 예외이므로 subscribed_at 내림차순 3개만 시도)
// 2) 관심만 있고 구독 없음 → 구독 생성 (enabled=false 이력 있으면 스킵, SEC 식별자 없으면 스킵)
// 3) 위 대상 전부 뉴스 팔로우 ON은 이 스크립트 범위 밖(별도 DB) — 문서로만 기록
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");

function loadEnvFile(filePath, { override = false } = {}) {
  if (!filePath || !existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (override || !process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(path.join(repoRoot, ".env.production"));
loadEnvFile(path.join(repoRoot, ".env"), { override: true });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

const plan = { markFromSubscription: [], subscribeFromMark: [], skippedDisabled: [], skippedNoSec: [] };

// 1) 구독만 있는 유저: 마킹할 ticker 후보
{
  const { data: subs, error } = await db.from("user_filing_subscriptions").select("user_id, ticker, enabled, subscribed_at").eq("enabled", true);
  if (error) throw new Error(error.message);
  const { data: marks, error: markError } = await db.from("user_company_marks").select("user_id, ticker, coverage_level");
  if (markError) throw new Error(markError.message);
  const marked = new Set(marks.filter((m) => m.coverage_level !== null).map((m) => `${m.user_id}:${m.ticker}`));
  for (const sub of subs ?? []) {
    if (marked.has(`${sub.user_id}:${sub.ticker}`)) continue;
    plan.markFromSubscription.push(sub);
  }
}

// 2) 관심만 있는 유저: 구독 후보 (enabled=false 이력 스킵)
{
  const { data: marks } = await db.from("user_company_marks").select("user_id, ticker, coverage_level").eq("coverage_level", "interest");
  const { data: subs } = await db.from("user_filing_subscriptions").select("user_id, ticker, enabled, cik");
  const activeOrHistoric = new Map((subs ?? []).map((s) => [`${s.user_id}:${s.ticker}`, s]));
  for (const mark of marks ?? []) {
    const key = `${mark.user_id}:${mark.ticker}`;
    const existing = activeOrHistoric.get(key);
    if (existing?.enabled) continue;
    if (existing && !existing.enabled) { plan.skippedDisabled.push(mark); continue; }
    if (!existing?.cik) { plan.skippedNoSec.push(mark); continue; } // cik 없으면 재시도 대상에서 제외(정책: 마킹만)
    plan.subscribeFromMark.push(mark);
  }
}

console.log(JSON.stringify({
  apply,
  markFromSubscription: plan.markFromSubscription.length,
  subscribeFromMark: plan.subscribeFromMark.length,
  skippedDisabledHistory: plan.skippedDisabled.length,
  skippedNoCik: plan.skippedNoSec.length,
}, null, 2));

if (!apply) {
  console.log("Dry run. Re-run with --apply after review. free 유저 3개 초과 마킹은 subscribed_at 내림차순 3개만 시도한다.");
  process.exit(0);
}

// 1) 적용: free 여부와 무관하게 RPC가 한도를 강제한다. user_filing_entitlement는 앱 런타임 값이라
//    스크립트는 3개 가정 하에 최신순 시도하고, coverage_limit_reached는 예외 무시.
const perUser = new Map();
for (const sub of [...plan.markFromSubscription].sort((a, b) => b.subscribed_at.localeCompare(a.subscribed_at))) {
  const list = perUser.get(sub.user_id) ?? [];
  list.push(sub);
  perUser.set(sub.user_id, list);
}
for (const [userId, list] of perUser) {
  for (const sub of list.slice(0, 3)) {
    const { error } = await db.rpc("set_user_company_coverage_level", {
      p_user_id: userId, p_ticker: sub.ticker, p_coverage_level: "interest",
      p_idempotency_key: `follow-backfill:${userId}:${sub.ticker}`, p_source: "follow_backfill",
    });
    if (error) console.warn(`mark ${userId} ${sub.ticker}: ${error.message}`);
  }
}
// 2) 적용: 구독 upsert (poll_state/Preferences는 파이프라인이 보강)
for (const mark of plan.subscribeFromMark) {
  const { error } = await db.from("user_filing_subscriptions").upsert(
    { user_id: mark.user_id, ticker: mark.ticker, cik: activeCikOf(mark), enabled: true, subscribed_at: new Date().toISOString(), disabled_at: null },
    { onConflict: "user_id,ticker" },
  );
  if (error) console.warn(`sub ${mark.user_id} ${mark.ticker}: ${error.message}`);
}
function activeCikOf(mark) {
  const s = activeOrHistoricMapStub.get(`${mark.user_id}:${mark.ticker}`);
  return s?.cik ?? null;
}
```

주의: 위 `activeCikOf`의 맵 참조는 Step 2 조회 결과(`subs`)를 모듈 스코프에 저장한 맵으로 연결해 구현할 것(플레이스홀더 금지 — 실행 시점에 실제 변수명으로 완성). 또한 구독 upsert에 cik이 필요하므로 `plan.subscribeFromMark`에는 ticker와 함께 cik을 싣는다. 백필 실행 전 prod pooler 접근 런북(memories/prod-db-pooler-access)대로 접속하고, 실행 결과 리포트를 스펙 문서에 추가한다.

- [ ] **Step 2: dry-run 검증 (dev DB) + 커밋**

Run: `node scripts/follow-unification-backfill.mjs --env-file .env` (dev) → 요약 JSON 확인

```bash
git add scripts/follow-unification-backfill.mjs
git commit -m "feat(ops): follow unification backfill script"
```

---

### Task 11: 최종 검증

- [ ] `npm run typecheck && npm run lint && npx vitest run` 전체 통과
- [ ] `npm run dev` 로컬 기동 후 수동 E2E: 챗 답변 CTA 관심 ON → 관심종목 페이지·공지함·settings 카드 수 일치, 관심 해제 → 알림 꺼짐, free 4개째 → 409 업그레이드 UI
- [ ] 스펙 문서(`docs/plans/2026-08-20-follow-unification-plan.md`) 말미에 실행 결과 기록 후 커밋

## Self-Review 기록

- 스펙 커버리: 정책(한도/409 UX)→T3/T5, 엔드포인트→T2/T3, 훅→T4, 진입점 5곳(스펙 4곳+온보딩 발견분)→T5/T6/T7, 고아 삭제→T7, reconcile→T8, pricing→T9, 백필→T10, delivery_mode "끔"은 스펙 '제외(2차)'대로 미포함
- 타입 일관성: `FollowCompanyResult`/`CompanyFollowState`/`planPushEnable` 시그니처가 T2/T3/T4/T5에서 동일하게 사용됨
