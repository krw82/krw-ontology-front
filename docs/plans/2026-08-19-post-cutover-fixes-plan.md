# 리서치 엔진 전환 후 잔존 결함 정리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2026-08-19 러스트 엔진 커트오버 감사(4개 병렬 에이전트 + tsc/eslint)에서 발견한 MEDIUM/LOW 잔존 결함을 제거한다 — 고아 하트비트 리더, 죽은 모듈, 은퇴 스크립트 잔재, 취소 폴백의 부정확한 성공 응답.

**Architecture:** 감사가 "실사용자 0명"을 확인한 모듈만 삭제한다. 읽는 주체가 사라진 `agent_worker_heartbeats` 체인(healthz 폴백, /internal/mcp-health, prod:status 검증)을 러스트 데몬 경로로 통합하거나 폐지하고, 취소 커널이 불가능할 때 legacy 스탬프로 넘어가며 `aborted:false` 성공을 반환하는 라우트를 503 오류로 정직화한다.

**Tech Stack:** Next.js(App Router) route handlers, vitest, esbuild 워커, docker-compose, bash 운영 스크립트.

**선행 완료:** 감사 HIGH(첨부/URL UI 비활성화)는 본 계획 외에서 이미 구현됨 — `src/lib/chat/attachment-support.ts`의 `CHAT_ATTACHMENT_CONTEXT_SUPPORTED = false` 플래그로 `ChatPageClient.tsx`의 `urlModeAvailable`/`fileModeAvailable`/`attachmentCoachmarkEnabled` 게이팅. 검증 완료(eslint 0 error, tsc 통과).

## Global Constraints

- **이전 계획 제약의 해제 범위:** `docs/plans/2026-08-19-legacy-research-engine-cleanup-plan.md`의 "공유 인프라는 절대 삭제하지 않는다" 목록 중 이번 감사로 실사용자 0명이 확인된 `worker-heartbeat`, `abort-manager`, `tool-call-cleanup`, `system-prompt` 만 이 계획이 해제한다. 나머지(`run-events`, `run-lifecycle`, `queue-state`, `run-event-listener`, `daemon-heartbeat`, `mcp-client`, `plugin-contract`, `parseLegacyResearchAgentOutput`)는 여전히 삭제 금지.
- **`ANTHROPIC_API_KEY`는 제거하지 않는다.** `src/lib/security/chat-safety.ts`·`sensitive-output.ts`가 출력 마스킹에 사용한다 (감사 1차 보고의 "무리더" 판정은 오류).
- **DB 테이블/마이그레이션은 drop 하지 않는다.** `agent_worker_heartbeats` 테이블은 히스토리 보존으로 남긴다(코드 리더만 제거).
- **커밋 시:** heredoc 커밋 메시지에 소스 파일명을 쓰면 mimosa hook이 오탐 차단한다. 메시지를 파일로 작성 후 `git commit -F` 사용 (기존 런북 관례).
- **빌드 검증:** 매 태스크 종료 시 `npx tsc -p tsconfig.typecheck.json --noEmit` 과 `npx eslint . --quiet` 에 새 오류가 없어야 한다. (baseline: `FilingInbox.tsx:365` set-state-in-effect 1건은 본 계획 범위 밖)
- **러스트 엔진 관련 env(`AGENT_V1_*`, `KRW_AGENT_*`)은 건드리지 않는다.**

---

### Task 1: `prod:status` 복구 — 죽은 하트비트 검증 제거

**Files:**
- Modify: `scripts/status-production-fast.sh:53`
- Delete: `scripts/verify-mac-worker-heartbeats.mjs`
- Modify: `src/lib/deploy-scripts.test.ts:702,838-841`

**Interfaces:**
- Consumes: 없음 (독립)
- Produces: `npm run prod:status`가 하트비트 검증 없이 MCP/filings 검증 + compose 상태만 보고. 이후 태스크가 이 스크립트를 더는 참조하지 않음.

- [ ] **Step 1: 기존 테스트 단언 제거 (먼저 실패 상태 확인용)**

`src/lib/deploy-scripts.test.ts`에서 아래를 찾아 삭제:
```ts
const verifyHeartbeats = read("scripts/verify-mac-worker-heartbeats.mjs");
```
```ts
expect(verifyHeartbeats).toContain("agent_worker_heartbeats");
expect(verifyHeartbeats).toContain("OK Mac supervisor heartbeat");
```
주변에 `verifyHeartbeats`를 참조하는 다른 단언이 남아있으면 함께 삭제한다 (`grep -n verifyHeartbeats src/lib/deploy-scripts.test.ts`로 0건 확인).

- [ ] **Step 2: 테스트 실행 — 스크립트 파일이 아직 있으므로 통과해야 함**

Run: `npx vitest run src/lib/deploy-scripts.test.ts`
Expected: PASS (단언만 제거한 상태)

- [ ] **Step 3: 검증 스크립트 호출 제거 + 파일 삭제**

`scripts/status-production-fast.sh`에서 이 줄 삭제:
```bash
node "$SCRIPT_DIR/verify-mac-worker-heartbeats.mjs" --env-file "$ENV_PATH" --timeout-ms 30000
```
그 후:
```bash
git rm scripts/verify-mac-worker-heartbeats.mjs
bash -n scripts/status-production-fast.sh
```
Expected: bash 문법 오류 없음

- [ ] **Step 4: 전체 검증**

Run: `npx vitest run src/lib/deploy-scripts.test.ts && npx eslint scripts/status-production-fast.sh 2>/dev/null; npx tsc -p tsconfig.typecheck.json --noEmit`
Expected: 전부 통과

- [ ] **Step 5: Commit**

```bash
printf 'fix(ops): stop verifying retired agent-worker heartbeats in prod status\n\nThe only writer of agent_worker_heartbeats was the retired agent-supervisor,\nso the check blocked 30s and exited 1 on every run.' > /tmp/krw-commit-msg.txt
git add scripts/status-production-fast.sh scripts/verify-mac-worker-heartbeats.mjs src/lib/deploy-scripts.test.ts
git commit -F /tmp/krw-commit-msg.txt
```

---

### Task 2: `healthz/deep` — 레거시 워커 MCP 폴백 제거, 러스트 데몬 단일 경로화

**Files:**
- Modify: `src/app/api/healthz/deep/route.ts:4-5,153-195,308-330`

**Interfaces:**
- Consumes: `checkRustAgentDaemon()` (이미 같은 파일에 존재)
- Produces: `/api/healthz/deep`의 `mcp` 체크가 항상 러스트 데몬 하트비트 기준. `checkWorkerMcp` 함수와 `@/lib/agent/worker-heartbeat` import 제거 (Task 3이 module 삭제의 전제).

- [ ] **Step 1: 폴백 분기 교체**

`src/app/api/healthz/deep/route.ts`에서 이 블록을:
```ts
  const agentV1Required =
    process.env.KRW_AGENT_BACKEND_MODE === "rust" ||
    process.env.KRW_RUNTIME_ENVIRONMENT === "prod";
  const agentV1Daemon = agentV1Required
    ? await checkRustAgentDaemon()
    : { ok: true, required: false };
  const mcp = agentV1Required
      ? {
        ok: agentV1Daemon.ok,
        required: agentV1Daemon.required,
        owner: "local_rust_agentd",
        error: agentV1Daemon.error,
      }
    : catalog.ok && typeof catalog.release_id === "string"
      ? await checkWorkerMcp(catalog.release_id)
      : {
          ok: false,
          error: "Cannot check worker MCP without an active catalog release",
        };
```
다음으로 교체 (러스트 엔진이 유일한 엔진이므로 상시 검사; 데몬 하트비트가 요구되지 않는 dev에선 `checkRustAgentDaemon`→`getReadyRustAgentDaemon`가 `{ok:true, required:false}`를 반환해 false-alarm 없음):
```ts
  const agentV1Daemon = await checkRustAgentDaemon();
  const mcp = {
    ok: agentV1Daemon.ok,
    required: agentV1Daemon.required,
    owner: "local_rust_agentd",
    error: agentV1Daemon.error,
  };
```

- [ ] **Step 2: 죽은 코드 제거**

같은 파일에서 `checkWorkerMcp` 함수 전체(약 153-195행)와 import 제거:
```ts
import {
  getReadyAgentWorker,
} from "@/lib/agent/worker-heartbeat";
```
`grep -n "checkWorkerMcp\|worker-heartbeat\|getReadyAgentWorker" src/app/api/healthz/deep/route.ts` → 0건 확인.

- [ ] **Step 3: 검증 (이 라우트엔 테스트 파일이 없어 tsc/eslint/수동 probe로 대체)**

Run: `npx tsc -p tsconfig.typecheck.json --noEmit && npx eslint src/app/api/healthz/deep/route.ts`
Expected: 오류 0건

- [ ] **Step 4: Commit**

```bash
printf 'refactor(health): deep healthcheck checks only the rust agent daemon\n\nThe worker-MCP fallback read agent_worker_heartbeats, whose writer was\nretired with the agent-supervisor; the branch could never report healthy.' > /tmp/krw-commit-msg.txt
git add src/app/api/healthz/deep/route.ts
git commit -F /tmp/krw-commit-msg.txt
```

---

### Task 3: `/internal/mcp-health` 폐지 + `worker-heartbeat` 모듈 삭제

**Files:**
- Delete: `src/app/internal/mcp-health/route.ts` (디렉터리째)
- Delete: `src/lib/agent/worker-heartbeat.ts`, `src/lib/agent/worker-heartbeat.test.ts`
- Modify: `src/types/api-contracts.ts:1611` 부근

**Interfaces:**
- Consumes: Task 2 완료 (마지막 외부 리더 제거됨)
- Produces: `@/lib/agent/worker-heartbeat` 심볼 소멸. `agent_worker_heartbeats` 테이블을 읽는 애플리케이션 코드 0건.

근거: 이 라우트의 호출자를 repo 전역(scripts/ops/docs/Caddyfile)에서 확인했으나 없음 — desktop-live 스택이 검사하는 `KRW_ONTOLOGY_MCP_HEALTH_URL`은 별개의 ontology MCP 서버(uv-run) 헬스 체크이고, Caddyfile은 `/internal/*`을 외부 노출하지 않는다. 응답 타입만 `api-contracts.ts`에 남는다.

- [ ] **Step 1: 리더 0건 재확인**

Run: `grep -rn "getReadyAgentWorker\|worker-heartbeat" src/ --include="*.ts" | grep -v "worker-heartbeat"`
Expected: 0건 (Task 2 완료 후여야 함)

- [ ] **Step 2: 삭제**

```bash
git rm -r src/app/internal/mcp-health
git rm src/lib/agent/worker-heartbeat.ts src/lib/agent/worker-heartbeat.test.ts
```

- [ ] **Step 3: api-contracts 타입 제거**

`src/types/api-contracts.ts`에서 `/** GET /internal/mcp-health response */` 주석과 그 아래의 응답 인터페이스 블록 전체를 삭제한다 (인터페이스명은 `grep -n "mcp-health" src/types/api-contracts.ts`로 확인 — 보통 `InternalMcpHealthResponse`류의 이름이며, 다른 곳에서 import 하고 있으면 그 import도 함께 제거).

- [ ] **Step 4: 검증**

Run: `npx tsc -p tsconfig.typecheck.json --noEmit && npx vitest run src/lib/agent && npx eslint . --quiet`
Expected: 전부 통과 (FilingInbox baseline 1건 제외 새 오류 없음)

- [ ] **Step 5: Commit**

```bash
printf 'refactor(agent): retire the internal mcp-health route and worker heartbeat module\n\nNo caller exists and the heartbeat table has no writer since the supervisor\nretirement; the rust daemon writes its own heartbeat table.' > /tmp/krw-commit-msg.txt
git add -A src/app/internal src/lib/agent src/types/api-contracts.ts
git commit -F /tmp/krw-commit-msg.txt
```

---

### Task 4: 취소 폴백 정직화 — 커널 불가 시 503, legacy 스탬프는 레거시 행 전용

**Files:**
- Modify: `src/lib/api/chat/rust-cancel.ts` (+ `rust-cancel.test.ts`)
- Modify: `src/app/api/chat/run/cancel/route.ts` (+ `route.test.ts`)
- Modify: `src/app/api/chat/[sessionId]/cancel/route.ts` (+ `route.test.ts`)

**Interfaces:**
- Consumes: 기존 `cancelRustAgentRun(params): Promise<RustAgentCancelOutcome | null>`
- Produces: `RustAgentCancelOutcome`에 `kind: "kernel_unavailable"` 추가, 반환 타입에서 `null` 제거. 라우트는 rust run 취소 채널 장애 시 `503 { success:false, error:{ code:"cancel_channel_unavailable" } }` 반환. 레거시(비 rust) run의 `requestAgentRunCancel` 폴백은 그대로 유지.

- [ ] **Step 1: 실패하는 테스트 먼저 수정 — rust-cancel.test.ts**

`cancelRustAgentRun`이 커널 장애 시 `null` 대신 `{ kind: "kernel_unavailable" }`을 반환한다고 단언하도록 기존 null 관련 단언 수정. `runtime.cancel`이 throw하는 케이스를 mock하는 기존 테스트가 있다면:
```ts
  expect(await cancelRustAgentRun(params)).toEqual({ kind: "kernel_unavailable" });
```

- [ ] **Step 2: 라우트 테스트 수정 — rust run + 커널 장애 → 503**

`src/app/api/chat/run/cancel/route.test.ts`에 (없으면 신규):
```ts
  it("rust run cancel returns 503 when the kernel channel is unavailable", async () => {
    // executor_type "rust_agent", status "running"인 run을 준비하고
    // cancelRustAgentRun mock이 { kind: "kernel_unavailable" }을 반환하도록 설정
    const res = await POST(cancelRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("cancel_channel_unavailable");
  });
```
`[sessionId]/cancel/route.test.ts`에도 동일 단언 추가.

Run: `npx vitest run src/lib/api/chat/rust-cancel.test.ts src/app/api/chat/run/cancel/route.test.ts "src/app/api/chat/[sessionId]/cancel/route.test.ts"`
Expected: FAIL (아직 구현 전)

- [ ] **Step 3: rust-cancel.ts 구현**

반환 타입에서 `| null` 제거, doc comment 갱신, catch 블록의 `return null`을:
```ts
    return { kind: "kernel_unavailable" };
```
로 교체. outcome 타입에 `"kernel_unavailable"` 추가.

- [ ] **Step 4: 두 라우트에 503 분기 추가**

`run/cancel/route.ts`의 `if (outcome) {` 블록 첫머리에:
```ts
    if (outcome) {
      if (outcome.kind === "kernel_unavailable") {
        return Response.json(
          {
            success: false,
            error: {
              code: "cancel_channel_unavailable",
              message:
                "리서치 엔진 취소 채널에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.",
            },
          },
          { status: 503 },
        );
      }
      abortRun(run.id);
```
`[sessionId]/cancel/route.ts`의 대응 블록에도 동일 분기 추가. (legacy run용 `requestAgentRunCancel` 폴백 경로는 그대로 둔다 — 과거 레거시 행 drain용.)

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/lib/api/chat/rust-cancel.test.ts src/app/api/chat/run/cancel/route.test.ts "src/app/api/chat/[sessionId]/cancel/route.test.ts"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
printf 'fix(chat): surface cancel channel failures instead of silent legacy stamp\n\nWhen the rust cancel kernel is unavailable the routes now return 503 so the\nclient can retry, instead of stamping a column the daemon never reads and\nreporting a no-op success.' > /tmp/krw-commit-msg.txt
git add src/lib/api/chat/rust-cancel.ts src/lib/api/chat/rust-cancel.test.ts src/app/api/chat/run/cancel src/app/api/chat/[sessionId]/cancel
git commit -F /tmp/krw-commit-msg.txt
```

---

### Task 5: `lease.ts`·`tool-call-cleanup.ts` 삭제 + 죽은 lease env 제거

**Files:**
- Delete: `src/lib/concurrency/lease.ts` (+ 테스트가 있으면 함께), `src/lib/agent/tool-call-cleanup.ts`, `src/lib/agent/tool-call-cleanup.test.ts`
- Modify: `docker-compose.yml:124-125`, `docker-compose.e2-standard-4-4w.yml:12-13`
- Modify: `src/types/api-contracts.ts` (`LEASE_TIMEOUT_MINUTES`, `AGENT_RUN_HARD_TIMEOUT_MINUTES` 타입 행)

**Interfaces:**
- Consumes: 없음 — `lease.ts`는 테스트만 import, `tool-call-cleanup.ts`의 유일 import가 `lease.ts` (감사 확인).
- Produces: `@/lib/concurrency/lease`·`@/lib/agent/tool-call-cleanup` 심볼 소멸. `GLOBAL_CONCURRENT_RUN_LIMIT`(`src/lib/agent/queue-state.ts:8`가 읽음)은 계속 유효 — compose에서 절대 제거하지 않는다.

- [ ] **Step 1: 리더 재확인**

Run: `grep -rn "concurrency/lease\|tool-call-cleanup" src/ --include="*.ts" | grep -v "lease.ts\|tool-call-cleanup"`
Expected: 테스트 파일만 남거나 0건 (테스트도 함께 삭제)

- [ ] **Step 2: 삭제**

```bash
git rm src/lib/concurrency/lease.ts src/lib/agent/tool-call-cleanup.ts src/lib/agent/tool-call-cleanup.test.ts
# lease.test.ts가 존재하면: git rm src/lib/concurrency/lease.test.ts
```

- [ ] **Step 3: compose env 제거**

`docker-compose.yml`에서 두 줄 삭제:
```yaml
      - AGENT_RUN_HARD_TIMEOUT_MINUTES=${AGENT_RUN_HARD_TIMEOUT_MINUTES:-10}
      - LEASE_TIMEOUT_MINUTES=${LEASE_TIMEOUT_MINUTES:-10}
```
`docker-compose.e2-standard-4-4w.yml`에서 두 줄 삭제:
```yaml
      - AGENT_RUN_HARD_TIMEOUT_MINUTES=8
      - LEASE_TIMEOUT_MINUTES=12
```
(`GLOBAL_CONCURRENT_RUN_LIMIT` 줄은 유지)

- [ ] **Step 4: api-contracts 타입 행 제거**

`src/types/api-contracts.ts`에서 `LEASE_TIMEOUT_MINUTES: string; // "10"` 행과 `AGENT_RUN_HARD_TIMEOUT_MINUTES` 타입 행 삭제.

- [ ] **Step 5: 검증**

Run: `npx tsc -p tsconfig.typecheck.json --noEmit && npx vitest run src/lib/concurrency src/lib/agent && docker compose -f docker-compose.yml config -q`
Expected: 전부 통과

- [ ] **Step 6: Commit**

```bash
printf 'refactor(agent): delete the dead run-lease module and its env\n\nThe lease path lost its only consumer when the legacy engine was removed;\nthe rust daemon owns run timeouts now.' > /tmp/krw-commit-msg.txt
git add -A src/lib/concurrency src/lib/agent docker-compose.yml docker-compose.e2-standard-4-4w.yml src/types/api-contracts.ts
git commit -F /tmp/krw-commit-msg.txt
```

---

### Task 6: `system-prompt.ts` 폐기 — 사용 중 상수만 `fetch-history.ts`로 이동

**Files:**
- Delete: `src/lib/agent/system-prompt.ts`, `src/lib/agent/system-prompt.test.ts`
- Modify: `src/lib/api/chat/fetch-history.ts:2`

**Interfaces:**
- Consumes: 감사 확인 — live import는 `MAX_PROMPT_HISTORY_MESSAGES` 상수 하나 (`fetch-history.ts:2`). `buildSystemPrompt`·`sanitizePromptHistory`는 테스트만 참조.
- Produces: `@/lib/agent/system-prompt` 심볼 소멸. 프롬프트는 러스트 엔진 소관.

- [ ] **Step 1: fetch-history가 실제로 쓰는 상수 확인**

Run: `grep -n "MAX_PROMPT_HISTORY" src/lib/api/chat/fetch-history.ts src/lib/agent/system-prompt.ts`
`fetch-history.ts`가 import해 *코드에서 사용하는* 상수만 다음 단계에서 이동한다 (선언만 import하고 안 쓰면 import째 삭제).

- [ ] **Step 2: 상수 이동 + import 정리**

`fetch-history.ts` 상단에 (기존 import 제거 후) 상수를 직접 선언:
```ts
/** 히스토리 프롬프트 구성 상한 — 러스트 엔진 커트오버 이전 레거시 프롬프트 빌더의 값 유지 */
export const MAX_PROMPT_HISTORY_MESSAGES = 20; // system-prompt.ts의 기존 값을 그대로 복사
```
(값은 반드시 기존 `system-prompt.ts`의 값을 복사한다. 다른 상수를 쓰고 있었다면 그 값도 동일 방식으로 이동.)
`fetch-history.ts`가 다른 모듈에 이 상수를 재수출하지 않는지 grep으로 확인 후, export 키워드는 내부 사용이면 붙이지 않는다.

- [ ] **Step 3: 삭제**

```bash
git rm src/lib/agent/system-prompt.ts src/lib/agent/system-prompt.test.ts
grep -rn "agent/system-prompt" src/ --include="*.ts" --include="*.tsx"
```
Expected: grep 0건

- [ ] **Step 4: 검증 + Commit**

Run: `npx tsc -p tsconfig.typecheck.json --noEmit && npx vitest run src/lib/api/chat`
```bash
printf 'refactor(agent): inline the last prompt-history constant, drop system-prompt\n\nThe rust engine owns prompt construction; only the history cap constant had\na live consumer.' > /tmp/krw-commit-msg.txt
git add -A src/lib/agent src/lib/api/chat
git commit -F /tmp/krw-commit-msg.txt
```

---

### Task 7: `abort-manager` 삭제 — 항상 빈 레지스트리

**Files:**
- Delete: `src/lib/agent/abort-manager.ts` (+ 테스트가 있으면 함께)
- Modify: `src/app/api/chat/run/cancel/route.ts:2,146,166`, `src/app/api/chat/[sessionId]/cancel/route.ts:5,84,91`

**Interfaces:**
- Consumes: Task 4 완료 후의 라우트 상태.
- Produces: `abortRun()` 호출 소멸. 동작 변화 없음 — `registerRun` 호출자가 없어 레지스트리가 항상 비어 `abortRun()`은 항상 `false`를 반환했음 (감사 확인).

- [ ] **Step 1: 호출부 제거**

두 라우트에서 import 라인과 `abortRun(run.id);` 호출 4곳 삭제. 주변 로직은 건드리지 않는다 (`await new Promise(...100ms)` 지연 등 Task 4에서 이미 정리된 구조 유지).

- [ ] **Step 2: 삭제 + 확인**

```bash
git rm src/lib/agent/abort-manager.ts   # abort-manager.test.ts 존재 시 함께
grep -rn "abort-manager\|abortRun" src/ --include="*.ts" --include="*.tsx"
```
Expected: grep 0건

- [ ] **Step 3: 검증 + Commit**

Run: `npx tsc -p tsconfig.typecheck.json --noEmit && npx vitest run src/app/api/chat "src/app/api/chat/[sessionId]" src/lib/agent`
```bash
printf 'refactor(agent): remove the always-empty run abort registry\n\nNothing registers runs anymore; abortRun always returned false, so the\ncancel routes lose a no-op call.' > /tmp/krw-commit-msg.txt
git add -A src/lib/agent src/app/api/chat
git commit -F /tmp/krw-commit-msg.txt
```

---

### Task 8: 은퇴 alias·문서·죽은 env 일괄 정리

**Files:**
- Modify: `package.json:77-79` (3줄 삭제), `package.json:8` (`dev:content`의 `KRW_DEV_SKIP_AGENT_WORKER=1` 제거)
- Modify: `src/lib/deploy-scripts.test.ts:846` 부근 (`worker:mac:preflight` 등 alias 핀)
- Modify: `docs/DEPLOY_COMMANDS.md:36-38,185-189,298-305`
- Modify: `scripts/status-production-workers.sh:64-74`, `scripts/run-prod-chat-e2e.mjs:156`, `scripts/run-production-release-gates.sh:102-104`
- Modify: `docker-compose.e2-standard-4-4w.yml:15-16` (`AGENT_MAX_TOOL_CALLS`, `AGENT_MAX_TOOL_RESULT_CHARS`), `src/types/api-contracts.ts:1769-1770` 대응 행
- Modify: `src/lib/agent/accumulated-run.ts:35` (`AccumulatedToolCall` 미사용 export 삭제), `src/lib/agent/run-events.ts:82` (`createAgentRunEventWriter` — 테스트만 사용 시 export 삭제와 함께 테스트 정리)

**Interfaces:**
- Consumes: Task 1-7 완료 (테스트 핀이 참조하는 대상과 충돌하지 않도록 마지막에 실행).
- Produces: `worker:mac:preflight`/`worker:mac:start`/`worker:mac:launchd:install` npm 스크립트 소멸 (`worker:mac:init-env`, `worker:mac:launchd:uninstall` 유지).

- [ ] **Step 1: package.json 정리**

삭제:
```json
    "worker:mac:preflight": "scripts/mac-worker-preflight.sh",
    "worker:mac:start": "scripts/start-mac-worker-production.sh",
    "worker:mac:launchd:install": "scripts/install-mac-worker-launchd.sh",
```
`dev:content` 행에서 `KRW_DEV_SKIP_AGENT_WORKER=1 ` 접두어만 제거 (`KRW_DEV_SKIP_DOCUMENT_WORKER=1` 유지).

- [ ] **Step 2: 테스트 핀 갱신**

`grep -n "worker:mac" src/lib/deploy-scripts.test.ts` — 삭제한 3 alias를 참조하는 `expect(packageJson).toContain("worker:mac:...")` 단언 삭제. `uninstall`/`init-env` 핀은 유지.
Run: `npx vitest run src/lib/deploy-scripts.test.ts` → PASS 확인.

- [ ] **Step 3: 문서 갱신**

`docs/DEPLOY_COMMANDS.md`:
- 298-305행 "prod Mac worker" 섹션을 은퇴 안내로 교체:
```markdown
### Mac agent worker (RETIRED)

`worker:mac:preflight` / `worker:mac:start` / `worker:mac:launchd:install`은
2026-08-19 레거시 엔진 은퇴와 함께 제거되었다. 남은 명령: 언인스톨은
`npm run worker:mac:launchd:uninstall`, env 초기화는 `npm run worker:mac:init-env`,
운영 상태는 `npm run prod:status`.
```
- 36-38행("Mac agent worker bundle/processes")과 185-189행("Mac supervisor heartbeat") 서술을 러스트 데몬(launchd `com.krw.agentd`) 토폴로지로 갱신.

- [ ] **Step 4: 스크립트 주석·출력 정리**

- `scripts/status-production-workers.sh` 64-74행에서 `AGENT_SUPERVISOR_*`, `AGENT_QUEUE_LISTEN_ENABLED`, `AGENT_QUEUE_RECONCILE_INTERVAL_MS`, `AGENT_RUN_CANCEL_LISTEN_ENABLED`, `AGENT_RUN_CANCEL_LISTEN_RECONCILE_INTERVAL_MS` echo 라인 삭제.
- `scripts/run-prod-chat-e2e.mjs:156` 주석 "production agent-worker executes the run" → "production rust agent daemon executes the run"으로 수정.
- `scripts/run-production-release-gates.sh:102-104` 주석에서 "production launchd supervisor" 문구를 현재 GCP compose 워커 실체에 맞게 수정.
- `deploy-scripts.test.ts`가 위 echo/주석을 핀하고 있으면 (`grep -n "AGENT_SUPERVISOR\|AGENT_QUEUE_LISTEN" src/lib/deploy-scripts.test.ts`) 단언 함께 삭제.

- [ ] **Step 5: e2 compose 죽은 env + api-contracts + 죽은 export**

- `docker-compose.e2-standard-4-4w.yml`에서 `AGENT_MAX_TOOL_CALLS=24`, `AGENT_MAX_TOOL_RESULT_CHARS=80000` 두 줄 삭제.
- `src/types/api-contracts.ts`에서 두 env 타입 행과 `KRW_CHAT_ROUTER_MODE`(리더 없음, 감사 확인) 타입 행 삭제.
- `src/lib/agent/accumulated-run.ts`에서 `export type AccumulatedToolCall` alias 삭제.
- `grep -rn "createAgentRunEventWriter" src/ --include="*.ts" | grep -v run-events.ts` — 테스트만 남으면 export와 테스트 케이스를 함께 삭제 (run-events.ts 본체와 다른 export는 절대 건드리지 않는다).

- [ ] **Step 6: 전체 검증 + Commit**

Run: `npx tsc -p tsconfig.typecheck.json --noEmit && npx eslint . --quiet && npx vitest run src/lib/deploy-scripts.test.ts src/lib/agent && docker compose -f docker-compose.e2-standard-4-4w.yml config -q`
```bash
printf 'chore(ops): prune retired worker aliases, dead env keys, stale docs\n\nPost-cutover audit follow-up: npm aliases for retired stubs, tool-limit env\nwhose consumers were deleted, and runbooks describing the retired topology.' > /tmp/krw-commit-msg.txt
git add -A package.json package-lock.json src/lib/deploy-scripts.test.ts docs/DEPLOY_COMMANDS.md scripts src/lib/agent src/types/api-contracts.ts docker-compose.e2-standard-4-4w.yml
git commit -F /tmp/krw-commit-msg.txt
```

---

### Task 9: 로컬 위생 — 낡은 빌드 산출물·로그 정리 (커밋 없음, 로컬 작업)

**Files:**
- 로컬 삭제: `.worker/agent-worker.mjs`, `logs/` 내 `mac-agent-worker*`, `launchd-agent-worker*`, `dev-with-worker.pid`

**Interfaces:**
- Consumes: 없음.
- Produces: 낡은 launchd 서비스가 삭제된 supervisor 바이너리를 실행할 소지 제거.

- [ ] **Step 1: Mac launchd 언인스톨 확인**

```bash
launchctl list | grep -i agent-worker || echo "no agent-worker service loaded"
```
로드되어 있으면 `npm run worker:mac:launchd:uninstall` 실행 (이 스크립트는 은퇴 후에도 기능 유지가 계획된 유일한 예외).

- [ ] **Step 2: 산출물·로그 삭제**

```bash
rm -f .worker/agent-worker.mjs logs/mac-agent-worker* logs/launchd-agent-worker* logs/dev-with-worker.pid
```

- [ ] **Step 3: 결과 기록**

본 파일 말미에 실행 날짜와 결과 한 줄 추가 (커밋하지 않아도 됨).

---

### Task 10: 조사 — 완료 후 evidence 패널 데이터 지속성 (prod DB probe)

**Files:**
- 조회만: prod Supabase (접속은 prod pooler 런북 — `.env.mac-worker.production`의 postgres URL, `aws-1-ap-northeast-2` pooler)
- 결과 기록: 본 파일 말미

**Interfaces:**
- Consumes: 없음.
- Produces: 러스트 데몬이 `tool_calls`/`citations`를 DB에 영속하는지의 사실. 미영속이면 krw-agnet 저장소에 후속 이슈로 넘긴다 (본 repo 수정 아님).

배경: 감사에서 "SSE로는 정상이지만 대화 재방문 시 `/api/chat/[sessionId]/evidence` 패널이 비어 있을 가능성"을 배제하지 못했다.

- [ ] **Step 1: 최근 완료 run의 evidence 행 확인**

```sql
select r.id, r.status, r.created_at,
       (select count(*) from tool_calls tc where tc.run_id = r.id) as tool_calls,
       (select count(*) from citations c where c.run_id = r.id) as citations
from agent_runs r
where r.status = 'completed' and r.created_at > now() - interval '3 days'
order by r.created_at desc
limit 10;
```
(실제 테이블·컬럼명은 `supabase/migrations`의 evidence projection 스키마를 먼저 확인해 맞춘다.)

- [ ] **Step 2: 판정**

- 최근 run의 count > 0 → 이상 없음. 본 파일에 "확인일 + 정상" 기록.
- count = 0 → SSE로만 내려오고 DB 미영속. 본 파일에 증상 기록 후 krw-agnet 저장소(outbox projection에 tool_calls/citations 반영)로 이관할 후속 항목을 적는다.

---

## Self-Review

- **감사 항목 커버:** M1 하트비트 리더 3종(Task 1,2,3) / M2 lease(Task 5) / M3 system-prompt(Task 6) / M4 activate 스크립트 → **누락 발견, 아래 Task 11 추가** / M5 cancel 폴백(Task 4) / L 전반(Task 8,9) / evidence 조사(Task 10).
- **ANTHROPIC_API_KEY, init-mac-worker-env.sh, agent_worker_heartbeats 테이블, keep-list 공유 모듈(run-events 본체 등)** — 의도적으로 미수정 범위로 명시됨.
- **타입 일치:** Task 4의 `kernel_unavailable` outcome이 Task 7의 라우트 정리 전제와 충돌 없음(서로 다른 블록). Task 3은 Task 2 완료 후에만 실행 가능(의존성 명시됨).

---

### Task 11 (self-review에서 추가): `activate-prepared-mac-runtime.sh` 삭제

**Files:**
- Delete: `scripts/activate-prepared-mac-runtime.sh`
- Modify: `src/lib/deploy-scripts.test.ts` (이 스크립트를 읽는 단언이 있으면)

**Interfaces:**
- Consumes: 없음. 호출자가 repo 전역에서 0건(감사 확인 — `deploy-worker-production.sh --use-prebuilt` stub을 `set -eu`로 호출해 실행 시 중단되는 고아 스크립트).
- Produces: 없음.

- [ ] **Step 1: 핀 확인 후 삭제**

```bash
grep -n "activate-prepared-mac-runtime" src/lib/deploy-scripts.test.ts scripts/*.sh ops -r
git rm scripts/activate-prepared-mac-runtime.sh
```
테스트 단언이 있으면 함께 삭제.

- [ ] **Step 2: 검증 + Commit**

Run: `npx vitest run src/lib/deploy-scripts.test.ts && npx tsc -p tsconfig.typecheck.json --noEmit`
```bash
printf 'chore(ops): delete the orphaned prepared-runtime activation script\n\nIts only action called a retired stub that exits 2; no caller exists.' > /tmp/krw-commit-msg.txt
git add -A scripts src/lib/deploy-scripts.test.ts
git commit -F /tmp/krw-commit-msg.txt
```
 - Task 9 실행: 2026-08-19, launchd=none loaded, 삭제: .worker/agent-worker.mjs + 로그 31개(mac-agent-worker* 10, launchd-agent-worker* 20, dev-with-worker.pid 1)
 - Task 10 실행: 2026-08-19, **판정: SSE-only — DB 미영속 확정**. 최근 3일 completed rust_agent run 10개 전부 tool_calls=0, citations=0 (agent_run_events에는 activity_update/done만 존재, tool_call 계열 이벤트도 없음). `tool_calls` 마지막 기록 2026-08-11 16:22 UTC = 구 claude_agent 실행기 마지막(732 run, 7,463행), `citations`는 0행(단 한 번도 기록 없음). 누구도 쓰지 않음: 프론트 repo insert 0건, outbox projection v1/v2 모두 messages+agent_run_events+정산만 기록, krw-agnet repo에 tool_calls/citations INSERT SQL 0건. 후속 항목(이관): krw-agnet 엔진 — outbox projection(`apply_agent_v1_product_outbox*` 확장 또는 daemon persist)에 tool_calls/citations 반영. 상세: `.superpowers/sdd/2026-08-19-post-cutover-fixes-plan/task-10-report.md`
