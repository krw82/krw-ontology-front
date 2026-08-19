# Legacy Research Engine Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자 리서치 실행은 이미 100% Rust 엔진(krw-agnet)이지만, (1) 취소만 레거시 경로로 남아 있고 (2) Mac legacy agent-worker launchd가 아직 실행 중이며 (3) 죽은 레거시 코드가 방치된 상태 — 세 가지를 모두 정리한다.

**Architecture:** 취소는 공유 헬퍼 `cancelRustAgentRun`(`src/lib/api/chat/rust-cancel.ts`)에서 `getRustAgentRuntime().cancel()`(커널 `cancel_agent_v1_product_run` RPC → 데몬 실제 중단)을 호출하고, 실패 시 null을 반환해 라우트가 기존 레거시 스탬프 경로로 폴백한다. Mac legacy worker는 스크립트를 retired stub으로 전환하고 실행 중인 launchd 서비스를 제거한다(agent-worker uninstall 스크립트만 기능 유지). 죽은 모듈은 import 그래프 가드를 확인한 뒤 삭제하고, `AccumulatedRun` 타입만 새 파일로 추출한다.

**Tech Stack:** Next.js App Router route handlers, vitest (기존 route.test.ts mocking 스타일), @krw-agent/host pinned contract, sh 스크립트, launchd.

## Global Constraints

- 레거시 실행 컨테이너/번들은 더 이상 빌드되지 않음(`build:worker`에 agent-worker 없음). 이 계획은 웹 저장소(krw-ontology-front)와 이 Mac의 launchd 상태만 다룬다. Rust 엔진 저장소는 `~/krw-agnet`(사용자 표현 "krw-agent"와 동일 대상; `src/lib/agent-v1/runtime.ts`가 `homedir()/krw-agnet` 참조). **Rust 저장소 코드 수정은 없다.**
- DB 마이그레이션 불필요 (커널 취소 RPC `cancel_agent_v1_product_run`은 이미 마이그레이션 `20260802230000_agent_v1_product_projection.sql`에 존재).
- 공유 인프라는 절대 삭제하지 않는다: `run-events`, `run-lifecycle`, `abort-manager`, `tool-call-cleanup`, `queue-state`, `run-event-listener`, `daemon-heartbeat`(Rust 데몬 하트비트), `worker-heartbeat`(healthz 비프로드 폴백 + internal/mcp-health가 읽음), `mcp-client`(desktop 기능이 사용), `plugin-contract`(mcp-client가 import), `system-prompt`(fetch-history가 `MAX_PROMPT_HISTORY_MESSAGES` 사용), `parseLegacyResearchAgentOutput`(src/lib/artifacts/schema.ts — 과거 run 결과 렌더용 유지).
- `scripts/uninstall-mac-worker-launchd.sh`는 기능 유지(제거 단계에서 필요).
- `scripts/init-mac-worker-env.sh`와 `.env.mac-worker.production`은 건드리지 않는다(다른 Mac 워커들이 공유).
- 테스트: `npx vitest run <file>`, 타입검사: `npm run typecheck`, 전체: `npm run check`.
- 커밋 메시지: 저장소 관례(conventional commits, `feat(chat):` / `chore(ops):` / `refactor(agent):`).
- 커밋 시 heredoc에 소스파일명을 쓰지 않는다(Mimosa 훅 오탐 방지, 메시지 파일 작성 후 `git commit -F`).

---

### Task 0: 브랜치 생성

- [ ] **Step 1: main 기준 브랜치 생성**

```bash
cd ~/krw-ontology-front
git checkout main && git pull --ff-only
git checkout -b feat/legacy-research-engine-cleanup
```

---

### Task 1: 취소 라우트에 Rust 커널 cancel 연결 (공유 헬퍼)

**Files:**
- Create: `src/lib/api/chat/rust-cancel.ts`
- Test: `src/lib/api/chat/rust-cancel.test.ts`
- Modify: `src/app/api/chat/run/cancel/route.ts`
- Modify: `src/app/api/chat/[sessionId]/cancel/route.ts`
- Test: `src/app/api/chat/run/cancel/route.test.ts`
- Test: `src/app/api/chat/[sessionId]/cancel/route.test.ts`

**Interfaces:**
- Consumes: `getRustAgentRuntime(): Promise<RustAgentRuntime>` (from `@/lib/agent-v1/runtime`); `RustAgentCancelInput = { runId: string; userId: string; sessionId: string; reasonCode: "user_cancelled" }`; `RustAgentCancelResult = { runId: string; outcome: "cancelled" | "already_final" | "already_cancelled" | "already_failed" }` (runtime이 커널의 `cancel_requested`→`cancelled`, `already_terminal`→`already_final`로 정규화해 반환).
- Produces: `cancelRustAgentRun(params: { admin: ReturnType<typeof getSupabaseAdmin>; run: RustAgentCancelTarget; userId: string; sessionId: string }): Promise<RustAgentCancelOutcome | null>` — `RustAgentCancelTarget = { id: string; session_id: string; assistant_message_id: string | null; request_id: string | null }`, `RustAgentCancelOutcome = { kind: "cancelled" } | { kind: "already_terminal" }`. null 반환 = Rust 런타임 불가(레거시 폴백).

**동작 규칙:**
1. run 조회 select에 `executor_type`, `assistant_message_id`(그리고 sessionId 라우트는 `request_id`도) 추가.
2. `executor_type === "rust_agent"`면 헬퍼 호출. `kind: "cancelled"`면 성공 응답(종결 처리는 헬퍼가 수행), `kind: "already_terminal"`면 종결 없는 성공 응답, `null`이면 기존 레거시 경로(`requestAgentRunCancel` 스탬프 + 종결 처리)로 폴백 — 오늘 동작과 동일하므로 회귀 없음.
3. `executor_type`이 `"claude_agent"`/null(전환 전 잔여 run)은 기존 레거시 경로 그대로.
4. `abortRun(run.id)`는 모든 경로에서 호출(기존과 동일).
5. HTTP 응답 형태 변경 없음.

- [ ] **Step 1: 헬퍼 failing test 작성**

`src/lib/api/chat/rust-cancel.test.ts` 생성:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agent-v1/runtime", () => ({
  getRustAgentRuntime: vi.fn(),
}));
vi.mock("@/lib/agent/run-lifecycle", () => ({
  markAgentRunTerminal: vi.fn(),
}));
vi.mock("@/lib/agent/run-events", () => ({
  appendAgentRunEvent: vi.fn().mockResolvedValue(1),
}));
vi.mock("@/lib/concurrency/execution-budget", () => ({
  releaseExecutionBudget: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getRustAgentRuntime } from "@/lib/agent-v1/runtime";
import { markAgentRunTerminal } from "@/lib/agent/run-lifecycle";
import { appendAgentRunEvent } from "@/lib/agent/run-events";
import { releaseExecutionBudget } from "@/lib/concurrency/execution-budget";
import { cancelRustAgentRun } from "./rust-cancel";

const RUN = {
  id: "11111111-1111-4111-8111-111111111111",
  session_id: "session-1",
  assistant_message_id: "assistant-message-1",
  request_id: "request-1",
};

function createAdmin() {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    admin: {
      from(table: string) {
        return {
          update(payload: Record<string, unknown>) {
            updates.push({ table, payload });
            const query = {
              eq() {
                return Promise.resolve({ data: null, error: null });
              },
            };
            return query;
          },
        };
      },
    } as unknown as ReturnType<
      typeof import("@/lib/supabase/admin").getSupabaseAdmin
    >,
  };
}

describe("cancelRustAgentRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels through the kernel and finalizes the product rows", async () => {
    const fake = createAdmin();
    const cancel = vi.fn().mockResolvedValue({ runId: RUN.id, outcome: "cancelled" });
    vi.mocked(getRustAgentRuntime).mockResolvedValue({
      enqueue: vi.fn(),
      cancel,
    } as unknown as Awaited<ReturnType<typeof getRustAgentRuntime>>);

    const outcome = await cancelRustAgentRun({
      admin: fake.admin,
      run: RUN,
      userId: "user-1",
      sessionId: "session-1",
    });

    expect(outcome).toEqual({ kind: "cancelled" });
    expect(cancel).toHaveBeenCalledWith({
      runId: RUN.id,
      userId: "user-1",
      sessionId: "session-1",
      reasonCode: "user_cancelled",
    });
    expect(markAgentRunTerminal).toHaveBeenCalledWith(
      fake.admin,
      RUN.id,
      expect.objectContaining({
        status: "cancelled",
        assistantMessageId: "assistant-message-1",
        errorCode: "cancelled",
      }),
    );
    expect(fake.updates).toEqual([
      expect.objectContaining({
        table: "messages",
        payload: expect.objectContaining({ status: "cancelled" }),
      }),
    ]);
    expect(releaseExecutionBudget).toHaveBeenCalledWith(
      "user-1",
      "request-1",
      RUN.id,
      "cancelled",
    );
    expect(appendAgentRunEvent).toHaveBeenCalledWith(
      fake.admin,
      RUN.id,
      "cancelled",
      { run_id: RUN.id, message_id: "assistant-message-1" },
    );
  });

  it("returns already_terminal without finalizing when the kernel finished first", async () => {
    const fake = createAdmin();
    vi.mocked(getRustAgentRuntime).mockResolvedValue({
      enqueue: vi.fn(),
      cancel: vi.fn().mockResolvedValue({ runId: RUN.id, outcome: "already_final" }),
    } as unknown as Awaited<ReturnType<typeof getRustAgentRuntime>>);

    const outcome = await cancelRustAgentRun({
      admin: fake.admin,
      run: RUN,
      userId: "user-1",
      sessionId: "session-1",
    });

    expect(outcome).toEqual({ kind: "already_terminal" });
    expect(markAgentRunTerminal).not.toHaveBeenCalled();
    expect(appendAgentRunEvent).not.toHaveBeenCalled();
  });

  it("returns null so callers fall back to the legacy stamp when the runtime is unavailable", async () => {
    const fake = createAdmin();
    vi.mocked(getRustAgentRuntime).mockRejectedValue(new Error("agent_v1_release_pin_missing"));

    const outcome = await cancelRustAgentRun({
      admin: fake.admin,
      run: RUN,
      userId: "user-1",
      sessionId: "session-1",
    });

    expect(outcome).toBeNull();
    expect(markAgentRunTerminal).not.toHaveBeenCalled();
  });

  it("skips optional finalization steps when message or request ids are null", async () => {
    const fake = createAdmin();
    vi.mocked(getRustAgentRuntime).mockResolvedValue({
      enqueue: vi.fn(),
      cancel: vi.fn().mockResolvedValue({ runId: RUN.id, outcome: "cancelled" }),
    } as unknown as Awaited<ReturnType<typeof getRustAgentRuntime>>);

    const outcome = await cancelRustAgentRun({
      admin: fake.admin,
      run: { ...RUN, assistant_message_id: null, request_id: null },
      userId: "user-1",
      sessionId: "session-1",
    });

    expect(outcome).toEqual({ kind: "cancelled" });
    expect(fake.updates).toHaveLength(0);
    expect(releaseExecutionBudget).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: failing 확인**

```bash
npx vitest run src/lib/api/chat/rust-cancel.test.ts
```

Expected: FAIL — `./rust-cancel` 모듈 없음.

- [ ] **Step 3: 헬퍼 구현**

`src/lib/api/chat/rust-cancel.ts` 생성:

```ts
import { getRustAgentRuntime } from "@/lib/agent-v1/runtime";
import { appendAgentRunEvent } from "@/lib/agent/run-events";
import { markAgentRunTerminal } from "@/lib/agent/run-lifecycle";
import { releaseExecutionBudget } from "@/lib/concurrency/execution-budget";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { CANCELLED_ASSISTANT_MESSAGE } from "@/lib/chat/message-status";

export interface RustAgentCancelTarget {
  readonly id: string;
  readonly session_id: string;
  readonly assistant_message_id: string | null;
  readonly request_id: string | null;
}

export type RustAgentCancelOutcome =
  | { kind: "cancelled" }
  | { kind: "already_terminal" };

/**
 * Cancel a rust_agent run through the kernel queue — the only cancel channel
 * the Rust daemon honors — and finalize the product rows. Returns null when
 * the Rust runtime is unavailable; callers fall back to the legacy cancel
 * stamp, which is the pre-cutover behavior (no regression).
 */
export async function cancelRustAgentRun(params: {
  admin: ReturnType<typeof getSupabaseAdmin>;
  run: RustAgentCancelTarget;
  userId: string;
  sessionId: string;
}): Promise<RustAgentCancelOutcome | null> {
  const { admin, run } = params;
  try {
    const runtime = await getRustAgentRuntime();
    const result = await runtime.cancel({
      runId: run.id,
      userId: params.userId,
      sessionId: params.sessionId,
      reasonCode: "user_cancelled",
    });
    if (result.outcome !== "cancelled") {
      return { kind: "already_terminal" };
    }
  } catch (error) {
    console.warn("[chat-cancel] rust kernel cancel unavailable; using legacy cancel stamp", {
      runId: run.id,
      code: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }

  await markAgentRunTerminal(admin, run.id, {
    status: "cancelled",
    finishedAt: new Date().toISOString(),
    assistantMessageId: run.assistant_message_id ?? undefined,
    errorCode: "cancelled",
    openToolErrorMessage: "Run was cancelled before tool result was received",
  });
  if (run.assistant_message_id) {
    await admin
      .from("messages")
      .update({
        status: "cancelled",
        content: CANCELLED_ASSISTANT_MESSAGE,
      })
      .eq("id", run.assistant_message_id);
  }
  if (run.request_id) {
    await releaseExecutionBudget(params.userId, run.request_id, run.id, "cancelled");
  }
  await appendAgentRunEvent(admin, run.id, "cancelled", {
    run_id: run.id,
    message_id: run.assistant_message_id,
  });
  return { kind: "cancelled" };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/api/chat/rust-cancel.test.ts
```

Expected: PASS (4개).

- [ ] **Step 5: run/cancel 라우트 failing test 작성**

`src/app/api/chat/run/cancel/route.test.ts`. mock 블록에 추가(헬퍼를 mock — 라우트 테스트는 wiring만 검증):

```ts
vi.mock("@/lib/api/chat/rust-cancel", () => ({
  cancelRustAgentRun: vi.fn(),
}));
```

import부:

```ts
import { cancelRustAgentRun } from "@/lib/api/chat/rust-cancel";
```

`createAdmin()`의 `agent_runs` single() fixture에 필드 추가:

```ts
executor_type: "claude_agent",
assistant_message_id: "assistant-message-1",
```

`beforeEach`에 기본값:

```ts
vi.mocked(cancelRustAgentRun).mockResolvedValue(null);
```

(기존 첫 테스트 "stores queued assistant placeholders as cancelled"는 `executor_type: "claude_agent"` + 헬퍼 null → 레거시 경로 그대로 통과.)

신규 describe:

```ts
describe("rust agent runs", () => {
  function rustFake(outcome: "cancelled" | "already_terminal") {
    const fake = createAdmin();
    // agent_runs single() fixture를 rust run으로 교체
    fake.admin.from = ((table: string) => {
      if (table !== "agent_runs") {
        // chat_sessions 등 기존 동작 유지를 위해 원본 로직 재현:
        return {
          select() {
            const query = {
              eq() { return query; },
              is() { return query; },
              single() {
                return Promise.resolve({
                  data: { id: "session-1", user_id: "user-1" },
                  error: null,
                });
              },
            };
            return query;
          },
        };
      }
      const query = {
        eq() { return query; },
        is() { return query; },
        order() { return query; },
        limit() { return query; },
        single() {
          return Promise.resolve({
            data: {
              id: RUN_ID,
              session_id: "session-1",
              status: "running",
              request_id: "request-1",
              executor_type: "rust_agent",
              assistant_message_id: "assistant-message-1",
            },
            error: null,
          });
        },
      };
      return { select: () => query };
    }) as unknown as typeof fake.admin.from;
    vi.mocked(cancelRustAgentRun).mockResolvedValue({ kind: outcome });
    return fake;
  }

  it("cancel through the shared helper and report aborted", async () => {
    const fake = rustFake("cancelled");
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(cancelRustAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({ id: RUN_ID, executor_type: "rust_agent" }),
        userId: "user-1",
        sessionId: "session-1",
      }),
    );
    expect(requestAgentRunCancel).not.toHaveBeenCalled();
    expect(body).toEqual({
      success: true,
      run_id: RUN_ID,
      request_id: "request-1",
      aborted: true,
    });
  });

  it("report not-aborted when the kernel already reached a terminal outcome", async () => {
    const fake = rustFake("already_terminal");
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      run_id: RUN_ID,
      status: "running",
      aborted: false,
    });
    expect(requestAgentRunCancel).not.toHaveBeenCalled();
  });

  it("fall back to the legacy stamp when the helper returns null", async () => {
    const fake = rustFake("cancelled");
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);
    vi.mocked(cancelRustAgentRun).mockResolvedValue(null);

    await POST(request());

    expect(requestAgentRunCancel).toHaveBeenCalledWith(RUN_ID);
  });

  it("never call the helper for claude_agent runs", async () => {
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    await POST(request());

    expect(cancelRustAgentRun).not.toHaveBeenCalled();
    expect(requestAgentRunCancel).toHaveBeenCalledWith(RUN_ID);
  });
});
```

(주: rustFake의 admin.from 재구성은 해당 테스트 파일 mock 구조에 맞게 조정 가능 — 핵심은 agent_runs 조회가 `executor_type: "rust_agent"` row를 반환하게 하는 것.)

- [ ] **Step 6: failing 확인**

```bash
npx vitest run src/app/api/chat/run/cancel/route.test.ts
```

Expected: FAIL — 라우트가 아직 헬퍼를 호출하지 않음.

- [ ] **Step 7: run/cancel 라우트 구현**

`src/app/api/chat/run/cancel/route.ts` 수정.

import 추가:

```ts
import { cancelRustAgentRun } from "@/lib/api/chat/rust-cancel";
```

`CancelRunRow` 타입 확장:

```ts
type CancelRunRow = Pick<
  AgentRunRow,
  "id" | "session_id" | "status" | "request_id" | "executor_type" | "assistant_message_id"
> &
  Record<string, unknown>;
```

`findRun`의 select 2곳을 `"id, session_id, status, request_id, executor_type, assistant_message_id"`로 교체.

상태 게이트(`run.status !== "pending" && ...` 조기 반환) **뒤**, `requestAgentRunCancel` 호출 **앞**에 삽입:

```ts
if (run.executor_type === "rust_agent") {
  const outcome = await cancelRustAgentRun({
    admin,
    run,
    userId: user.id,
    sessionId: run.session_id,
  });
  if (outcome) {
    abortRun(run.id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (outcome.kind === "cancelled") {
      return Response.json({
        success: true,
        run_id: run.id,
        request_id: run.request_id,
        aborted: true,
      });
    }
    return Response.json({
      success: true,
      run_id: run.id,
      status: run.status,
      aborted: false,
    });
  }
}
```

기존 레거시 본문(`requestAgentRunCancel` 이하)은 그대로 유지.

- [ ] **Step 8: 테스트 통과 확인**

```bash
npx vitest run src/app/api/chat/run/cancel/route.test.ts
```

Expected: PASS (기존 1개 + 신규 4개).

- [ ] **Step 9: [sessionId]/cancel 라우트 — 동일 사이클**

`src/app/api/chat/[sessionId]/cancel/route.test.ts`: 동일하게 `vi.mock("@/lib/api/chat/rust-cancel", ...)` + import, active run fixture(`.returns()` 반환)에 `executor_type: "rust_agent"`, `assistant_message_id: "assistant-message-1"`, `request_id: "request-1"` 필드를 갖는 케이스와 `executor_type: "claude_agent"` 케이스 추가. 신규 테스트:

```ts
it("cancels rust_agent runs through the shared helper", async () => {
  // fixture executor_type: "rust_agent", cancelRustAgentRun → { kind: "cancelled" }
  // 단얍: cancelRustAgentRun 호출(objectContaining run.id/userId/sessionId),
  //       requestAgentRunCancel 미호출, 응답 { success: true, run_id }
});

it("keeps the legacy stamp path for non-rust runs", async () => {
  // fixture executor_type: "claude_agent", cancelRustAgentRun → null이어도 호출 안 됨
  // 단얍: requestAgentRunCancel 호출
});
```

failing 확인 후 `src/app/api/chat/[sessionId]/cancel/route.ts` 구현:

- active run select를 `("id, status, executor_type, assistant_message_id, request_id")`로 확장.
- `const run = activeRuns[0];` 뒤, `requestAgentRunCancel(run.id)` 앞에:

```ts
if (run.executor_type === "rust_agent") {
  const outcome = await cancelRustAgentRun({
    admin,
    run,
    userId: user.id,
    sessionId,
  });
  if (outcome) {
    abortRun(run.id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return Response.json({ success: true, run_id: run.id });
  }
}
```

import 추가: `import { cancelRustAgentRun } from "@/lib/api/chat/rust-cancel";`

테스트 통과 확인:

```bash
npx vitest run "src/app/api/chat/[sessionId]/cancel"
```

- [ ] **Step 10: 타입검사 후 커밋**

```bash
npm run typecheck
printf 'feat(chat): cancel rust agent runs through the kernel\n' > /tmp/krw-commit-msg.txt
git add src/app/api/chat src/lib/api/chat
git commit -F /tmp/krw-commit-msg.txt
```

- [ ] **Step 11: 로컬 E2E 스모크(수동)**

```bash
npm run dev
```

브라우저에서 임의 채팅방에 리서치 질문 전송 → 진행 중 취소 버튼 클릭 → (a) UI가 즉시 취소 상태, (b) run 이벤트 스트림 종료 확인, (c) DB에서 `select status, cancel_requested_at, finished_at from agent_runs order by started_at desc limit 1;` → status `cancelled`. 실패 시 헬퍼 warn 메시지(`[chat-cancel] rust kernel cancel unavailable`)로 원인 구분.

---

### Task 2: Mac legacy agent-worker 퇴역

**Files:**
- Modify→retired stub: `scripts/install-mac-worker-launchd.sh`
- Modify→retired stub: `scripts/start-mac-worker-production.sh`
- Modify→retired stub: `scripts/mac-worker-preflight.sh`
- Modify→retired stub: `scripts/deploy-worker-production.sh`
- Delete: `ops/launchd/com.krwontology.agent-worker.plist.template`
- Modify: `ops/mac-worker/README.md`
- Modify: `scripts/status-production-workers.sh`
- Test: `src/lib/deploy-scripts.test.ts`

**Interfaces:**
- Consumes: 기존 retired-stub 패턴(`scripts/deploy-plugin-worker-production.sh` — 안내 출력 후 `exit 2`).
- Produces: `scripts/uninstall-mac-worker-launchd.sh`는 변경 없이 기능 유지(퇴역 실행에 사용).

**주의:** `scripts/verify-mac-runtime-target.sh`는 MCP 서버 start 스크립트들이 공유하므로 건드리지 않는다. `scripts/init-mac-worker-env.sh`도 건드리지 않는다.

- [ ] **Step 1: deploy-scripts.test.ts를 먼저 수정(TDD — 스텁 전환을 강제)**

`src/lib/deploy-scripts.test.ts`의 Mac worker 블록(변수 정의 `preflight`/`installLaunchd`/`uninstallLaunchd`/`deployWorker` 근처, 약 765-925 라인)에서:

1. `installLaunchd`, `preflight`, `deployWorker`, `scripts/start-mac-worker-production.sh` read 변수, `ops/launchd/com.krwontology.agent-worker.plist.template` read에 대한 **기존 내용 단얍들 전부 삭제**(`expect(installLaunchd).toContain(...)`, template 단얍, `wait_for_worker_id_to_stop`, `legacy_worker_id`, `launchctl bootstrap/kickstart` 등).
2. 다음 단얍으로 교체:

```ts
for (const retiredScript of [preflight, installLaunchd, deployWorker]) {
  expect(retiredScript).toContain("has been retired.");
  expect(retiredScript).toContain("scripts/uninstall-mac-worker-launchd.sh");
}
const startMacWorker = read("scripts/start-mac-worker-production.sh");
expect(startMacWorker).toContain("has been retired.");
expect(startMacWorker).not.toContain(".worker/agent-worker.mjs");
// uninstall은 퇴역 실행에 계속 필요하므로 기능 유지를 단얍
expect(uninstallLaunchd).toContain("launchctl bootout");
expect(uninstallLaunchd).toContain("com.krwontology.agent-worker*.plist");
```

3. template 파일 삭제 단얍은 제거하고(파일 자체 삭제), 템플릿 read 라인 제거.
4. `initEnv` 관련 단얍(AGENT_SUPERVISOR_* 등)은 그대로 유지 — init 스크립트는 변경하지 않음.

- [ ] **Step 2: failing 확인**

```bash
npx vitest run src/lib/deploy-scripts.test.ts
```

Expected: FAIL (스크립트가 아직 스텁이 아님).

- [ ] **Step 3: 4개 스크립트를 retired stub으로 전환**

`scripts/deploy-plugin-worker-production.sh` 패턴 그대로. 각 파일 전체를 아래 내용으로 교체(문구만 스크립트별로 다름):

`scripts/install-mac-worker-launchd.sh`:

```sh
#!/bin/sh
set -eu

cat >&2 <<'EOF'
The Mac legacy agent-worker launchd install path has been retired.
The frontend now uses the Rust krw-agent release and the Supabase queue.
To remove an installed worker, run: scripts/uninstall-mac-worker-launchd.sh
EOF
exit 2
```

`scripts/start-mac-worker-production.sh`:

```sh
#!/bin/sh
set -eu

cat >&2 <<'EOF'
The Mac legacy agent supervisor start path has been retired.
The frontend now uses the Rust krw-agent release and the Supabase queue.
To remove an installed worker, run: scripts/uninstall-mac-worker-launchd.sh
EOF
exit 2
```

`scripts/mac-worker-preflight.sh`:

```sh
#!/bin/sh
set -eu

cat >&2 <<'EOF'
The Mac legacy agent supervisor preflight path has been retired.
The frontend now uses the Rust krw-agent release and the Supabase queue.
To remove an installed worker, run: scripts/uninstall-mac-worker-launchd.sh
EOF
exit 2
```

`scripts/deploy-worker-production.sh`:

```sh
#!/bin/sh
set -eu

cat >&2 <<'EOF'
The Mac legacy agent supervisor deployment path has been retired.
The frontend now uses the Rust krw-agent release and the Supabase queue.
For full production deploys, use: npm run prod:deploy:full
To remove an installed worker, run: scripts/uninstall-mac-worker-launchd.sh
EOF
exit 2
```

- [ ] **Step 4: template 삭제 + README/상태 스크립트 정리**

```bash
git rm ops/launchd/com.krwontology.agent-worker.plist.template
```

`ops/mac-worker/README.md` 상단에 퇴역 안내 추가(기존 내용 앞에):

```markdown
# Mac worker (legacy agent supervisor) — RETIRED 2026-08-19

리서치 실행은 Rust 엔진(`~/krw-agnet`, launchd `com.krw.agentd`)으로 완전히 이전되었습니다.
레거시 agent-worker 설치/기동 스크립트는 retired stub입니다.
제거: `scripts/uninstall-mac-worker-launchd.sh`. 아래 내용은 역사적 참고용입니다.
```

`scripts/status-production-workers.sh`에서 `.worker/agent-worker.mjs` 프로세스를 검색하는 블록(약 59라인의 `ps … agent-worker.mjs` awk 패턴과 이를 사용하는 함수/출력)을 삭제하고, 해당 출력 라인을 제거(스크립트 나머지는 다른 워커 상태 그대로).

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run src/lib/deploy-scripts.test.ts
```

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
printf 'chore(ops): retire the Mac legacy agent-worker scripts\n' > /tmp/krw-commit-msg.txt
git add scripts ops src/lib/deploy-scripts.test.ts
git commit -F /tmp/krw-commit-msg.txt
```

- [ ] **Step 7: 실행 중인 launchd 서비스 제거(이 Mac, 수동)**

```bash
cd ~/krw-ontology-front
sh scripts/uninstall-mac-worker-launchd.sh
rmdir /tmp/krw-ontology-agent-worker-mac-supervisor-jwc.lock 2>/dev/null || true
launchctl list | grep -c com.krwontology.agent-worker || echo "agent-worker gone"
launchctl list | grep com.krw.agentd   # Rust 데몬 여전히 실행 중 확인
```

Expected: "agent-worker gone" 출력 + `com.krw.agentd` 항목 존재(PID 있음).

- [ ] **Step 8: 프로덕션 스모크(수동)**

운영 채팅에서 질문 1건 실행 → 정상 응답(agent-worker 제거가 리서치에 영향 없음 확인). deep 헬스체크는 prod에서 Rust 데몬만 보므로 별도 조치 불필요.

---

### Task 3: 죽은 레거시 코드 제거

**Files:**
- Create: `src/lib/agent/accumulated-run.ts`
- Modify: `src/lib/artifacts/build-research-artifact.ts:10`
- Modify: `src/lib/chat-artifacts/news-event-selection.ts:1`
- Modify: `src/lib/agent/job-queue.ts`, `src/lib/agent/job-queue.test.ts`
- Delete: 아래 삭제 목록 전체

**Interfaces:**
- Produces: `src/lib/agent/accumulated-run.ts`가 `export interface AccumulatedRun`과 `export type AccumulatedToolCall`을 제공(기존 stream-handler와 동일 형상).

**삭제 목록(각 `.test.ts` 동반 파일 포함, 있는 경우):**

```
src/lib/agent/workflow.ts
src/lib/agent/stream-handler.ts
src/lib/agent/failure-diagnostics.ts + failure-diagnostics.test.ts
src/lib/agent/filing-tool-persistence.ts + filing-tool-persistence.test.ts
src/lib/agent/research-evidence-policy.ts + research-evidence-policy.test.ts
src/lib/agent/guru-final-output-policy.ts + guru-final-output-policy.test.ts
src/lib/agent/guru-investigation-contracts.ts + guru-investigation-contracts.test.ts
src/lib/agent/tool-input-policy.ts + tool-input-policy.test.ts
src/lib/agent/sdk-freeze.ts + sdk-freeze.test.ts
src/lib/agent/claude-agent-cwd.ts
src/lib/agent/model.ts
src/lib/agent/postgres-queue-listener.ts + postgres-queue-listener.test.ts
src/lib/agent/run-cancel-listener.ts + run-cancel-listener.test.ts
src/lib/agent/env.ts + env.test.ts
src/worker/agent-supervisor.ts + src/worker/agent-supervisor.test.ts
```

**유지(공유 인프라, Global Constraints 참조):** run-events, run-lifecycle, abort-manager, tool-call-cleanup, queue-state, run-event-listener, daemon-heartbeat, worker-heartbeat, mcp-client, plugin-contract, system-prompt, artifacts/schema.ts의 parseLegacyResearchAgentOutput.

- [ ] **Step 1: 삭제 가드 — import 그래프 재확인**

```bash
for m in workflow stream-handler failure-diagnostics filing-tool-persistence research-evidence-policy guru-final-output-policy guru-investigation-contracts tool-input-policy sdk-freeze claude-agent-cwd model postgres-queue-listener run-cancel-listener agent/env agent-supervisor; do
  echo "== $m =="; grep -rn "agent/$m\"\|\"\\./$m\"\|\"\\./$(basename $m)\"" src --include=*.ts --include=*.tsx | grep -v ".test." | grep -v "src/lib/agent/$(basename $m)" | grep -v "src/worker/agent-supervisor" || true
done
```

`stream-handler`는 `type { AccumulatedRun }` import 2건(build-research-artifact, news-event-selection)만, 나머지는 0건이어야 함. 하나라도 예상 밖 import가 있으면 해당 모듈은 삭제 목록에서 빼고 계획에 기록.

- [ ] **Step 2: AccumulatedRun 타입 추출**

`src/lib/agent/accumulated-run.ts` 생성:

```ts
import type {
  StreamingCitation,
  MCPToolName,
} from "@/types/api-contracts";

/**
 * A run's accumulated stream state. Historically built by the legacy
 * Claude-agent stream handler; now the shape of persisted run events that
 * artifact builders read back.
 */
export interface AccumulatedRun {
  fullText: string;
  structuredOutput: unknown;
  researchSynthesisOutput: unknown;
  researchSynthesisText: string | null;
  displayPlanOutput: unknown;
  toolCalls: Array<{
    id: string;
    toolName: MCPToolName;
    argumentsJson: string;
    resultSummary: string | null;
    resultJson: unknown;
    resultText: string | null;
    startedAt: string;
    finishedAt: string | null;
    errorMessage: string | null;
  }>;
  citations: StreamingCitation[];
  inputTokens: number;
  outputTokens: number;
  cacheHitInputTokens: number;
  cacheMissInputTokens: number;
}

export type AccumulatedToolCall = AccumulatedRun["toolCalls"][number];
```

importer 2곳 교체:

```ts
// src/lib/artifacts/build-research-artifact.ts
import type { AccumulatedRun } from "@/lib/agent/accumulated-run";

// src/lib/chat-artifacts/news-event-selection.ts
import type { AccumulatedRun } from "@/lib/agent/accumulated-run";
```

- [ ] **Step 3: job-queue.ts 트림**

`src/lib/agent/job-queue.ts`에서 제거: `enqueueAgentRun`, `EnqueueAgentRunResult`, `AgentRunRoutingMode`, `releaseSnapshot`, `claimNextAgentRun`, `heartbeatAgentRun`, 상수 `GLOBAL_CONCURRENT_LIMIT`, `LEASE_TIMEOUT_SECONDS`.

제거 후 import는 다음만 남기고 전부 삭제:

```ts
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AgentRunRow } from "@/types/database";
import type { RunStatus } from "@/types/api-contracts";
```

남는 export: `findRunByRequestId`, `requestAgentRunCancel`.

- [ ] **Step 4: job-queue.test.ts 트림**

`enqueueAgentRun`/`claimNextAgentRun`/`heartbeatAgentRun`을 다루는 describe/it 전부 삭제("enqueues a run…", "persists explicit research…", "persists an explicit response locale…", "returns an existing run…", "cleans up the assistant placeholder…", "claims and heartbeats runs…"). 유지: "marks active queued or running runs as cancel requested" 및 `findRunByRequestId` 관련 테스트가 있다면 그대로. 삭제된 import/mock(`appendAgentRunEvent` 등)도 정리.

- [ ] **Step 5: 모듈 삭제**

```bash
git rm src/lib/agent/workflow.ts src/lib/agent/stream-handler.ts \
  src/lib/agent/failure-diagnostics.ts src/lib/agent/failure-diagnostics.test.ts \
  src/lib/agent/filing-tool-persistence.ts src/lib/agent/filing-tool-persistence.test.ts \
  src/lib/agent/research-evidence-policy.ts src/lib/agent/research-evidence-policy.test.ts \
  src/lib/agent/guru-final-output-policy.ts src/lib/agent/guru-final-output-policy.test.ts \
  src/lib/agent/guru-investigation-contracts.ts src/lib/agent/guru-investigation-contracts.test.ts \
  src/lib/agent/tool-input-policy.ts src/lib/agent/tool-input-policy.test.ts \
  src/lib/agent/sdk-freeze.ts src/lib/agent/sdk-freeze.test.ts \
  src/lib/agent/claude-agent-cwd.ts src/lib/agent/model.ts \
  src/lib/agent/postgres-queue-listener.ts src/lib/agent/postgres-queue-listener.test.ts \
  src/lib/agent/run-cancel-listener.ts src/lib/agent/run-cancel-listener.test.ts \
  src/lib/agent/env.ts src/lib/agent/env.test.ts \
  src/worker/agent-supervisor.ts src/worker/agent-supervisor.test.ts
```

(Step 1 가드에서 제외된 모듈이 있으면 해당 행 제거.)

- [ ] **Step 6: 전체 검증**

```bash
npm run typecheck
npx vitest run
```

Expected: 타입 오류 0, 유닛테스트 전체 PASS. `mcp-deployment-contract.test.ts` 등이 삭제 모듈을 import하고 있으면 해당 테스트도 삭제 대상에 포함(가드에서 발견된 경우).

- [ ] **Step 7: 커밋**

```bash
printf 'refactor(agent): remove dead legacy research engine modules\n' > /tmp/krw-commit-msg.txt
git add -A src
git commit -F /tmp/krw-commit-msg.txt
```

---

### Task 4: 최종 검증 및 배포

- [ ] **Step 1: 전체 체크**

```bash
npm run check   # typecheck + lint + test:unit + build
```

- [ ] **Step 2: 로컬 E2E 재확인**

`npm run dev` → 채팅 질문 실행/취소 정상, Pulse 카드 → 추천 질문 → 리서치 정상.

- [ ] **Step 3: 배포(기존 prod 런북)**

`npm run prod:deploy:full`은 GCP 웹 VM 재빌드 포함. 이 변경은 서버 전용 로직이므로 일반 배포면 충분. 배포 후 prod 채팅에서 1건 질문+취소 스모크. agent-worker launchd 제거(Task 2 Step 7)는 이 Mac에서 이미 완료된 상태(VM 무관 — 워커는 Mac에서만 실행됨).

---

## Self-Review 결과

- 스펙 커버: 감사 항목 1(취소)→Task 1, 2(launchd/스크립트)→Task 2, 3(죽은 코드)→Task 3. 간극 없음.
- 타입 일관성: `RustAgentCancelInput` 필드명(runId/userId/sessionId/reasonCode), outcome 정규화(cancel_requested→cancelled)는 `src/lib/agent-v1/runtime.ts` 실제 시그니처와 대조 완료.
- 폴백 설계: Rust 런타임 실패 시 기존 동작과 동일하므로 회귀 없음.
- 리스크 노트: Task 1은 커널 취소가 데몬에 전달되는 유일한 채널(`agent_v1.request_cancel`, `~/krw-agnet/crates/persistence/src/agent_v1.rs`)임을 krw-agnet 소스에서 확인함.
- 2026-08-19 사용자 결정: Task 1은 인라인 중복 대신 공유 헬퍼(`src/lib/api/chat/rust-cancel.ts`) 추출.
