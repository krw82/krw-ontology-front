# UX 리얼라인먼트 — 근거원문 추적 제거 + 로그인 전 가치 증명 + 길찾기 정리 (구현 계획)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 답변→공시 원문 인용(근거원문 추적)을 제품에서 완전히 걷어내고, 그 자리를 "실제 답변 예시 + 매일 도착하는 리서치 피드" 스토리로 채워 랜딩·질문 페이지·탐색을 새 제품 스토리에 정렬한다.

**Architecture:** 3단계로 진행한다. (1) citations 관련 UI·API·상태를 사용처부터 역방향으로 제거(타입은 마지막에 삭제), (2) prod에서 선별한 실제 답변을 정적 콘텐츠로 만들어 질문 페이지에 먼저 붙인다, (3) 랜딩의 인용 홍보 위젯을 이 예시 카드로 교체하고 탐색(피드/뉴스 정문, 로고, CTA 한글화)을 정비한다. Phase 2가 Phase 3의 부품이므로 이 순서를 지킨다.

**Tech Stack:** Next.js(App Router) · TypeScript · Tailwind v4 토큰 · vitest(로직 전용, DOM 렌더 테스트 인프라 없음) · Playwright e2e(`test:e2e:public`)

## Global Constraints

- **근거원문 추적 제거 범위**: citations(답변→원문 문장 인용)만. toolCalls 표시·공시 요약(/filings 상세의 "공시 핵심 변화")·펄스 8-K 카드는 유지한다(별개 기능).
- **카피 원칙(frontend-design)**: 능동태, 제품 어휘 통일("관심"), "근거/단서/원문"이 문장 수준 보증으로 읽히는 카피 금지. "공시 기반 리서치" 수준의 표현은 허용.
- 테스트 인프라: 컴포넌트 DOM 렌더 테스트 불가(@testing-library 없음). 로직은 순수 함수 분리 + vitest, 화면은 `npm run test:e2e:public` + 수동 체크.
- 커밋 메시지에 소스 파일명 언급 금지(mimosa 훅 오탐) — 메시지 파일 작성 후 `git commit -F`.
- 배포 프로바이더는 deepseek 고정.
- 브랜치: `feat/ux-realignment-citation-removal` (main에서 생성).

## 배경 팩트 (구현자용)

- citations는 라이브에서 이미 공백: DB 미영속(writer 부재)이라 evidence API도 빈값. 제거는 기능 축소가 아니라 정직화.
- 인용 표면 7곳: `src/components/ChatMessage.tsx`(렌더+진행문구), `src/components/ResearchProgress.tsx`(프롭), `src/components/EvidenceGraphPreview.tsx`(삭제 대상), `src/hooks/useChat.ts`(상태·SSE 누적·evidence 페치), `src/app/api/chat/[sessionId]/evidence/route.ts`(+test, 삭제 대상), `src/lib/chat/evidence-graph.ts`(삭제 대상), `src/types/api-contracts.ts`(ChatCitation 등), `src/app/dev/components/DevComponentsGallery.tsx`(전시).
- 랜딩(`src/app/[locale]/(public)/page.tsx`): 히어로 subtext가 "단서" 약속, 우측 위젯 `HomeEvidenceCards`+`HomeTraceExplorer`(근거→연결→요약), `WorkflowSteps`(단서 찾기·근거 정리). 모바일 `browseLinks`에 /pulse·/news 없음. 헤더 로고 href="/companies".
- PulseCard CTA: "Research NOW"/"Researching..." (src/components/pulse/PulseCard.tsx L238 부근).
- 13F 타이틀 중복: `src/app/institutional-holdings/page.tsx` L14 metadata가 이미 "| KRW.O" 포함(루트 레이아웃 템플릿이 또 붙임).
- 관심 익명 링크 next=/watchlist/AAPL은 **유효 경로**임(`/watchlist/[ticker]` 존재) — 수정 불요(6번 항목에서 제외).

---

## Phase 1 — 인용(citations) 표면 제거

### Task 1: useChat에서 citations 상태·evidence 페치 제거

**Files:**
- Modify: `src/hooks/useChat.ts` (L97 ChatState.citations 선언, L126 초기값, L665 SSE 누적, L975~1003 evidence 페치 블록, L933/L1406/L1596 리셋 3곳)
- Modify: `src/types/api-contracts.ts` (GetChatEvidenceResponse — Task 4에서 최종 삭제, 이 태스크에선 useChat import만 제거)

**Interfaces:**
- Produces: ChatState에서 `citations` 필드 소멸. ChatMessage로 citations를 넘기는 호출부(Task 2)와 ResearchProgress 프롭(Task 3)이 이를 따른다.

- [ ] **Step 1: 현재 동작 확인(수정 기준선)**

Run: `npx vitest run 2>&1 | tail -3` — 전량 통과 기록.

- [ ] **Step 2: citations 상태·증분·리셋 제거**

L97 `citations: ChatCitation[];` 삭제, L126/933/1406/1596 `citations: [],` 삭제, L665 누적 `citations: [...prev.citations, d],` 삭제(SSE 이벤트 파싱에서 citations 페이로드는 무시하고 toolCalls 파싱은 그대로 유지).

- [ ] **Step 3: evidence 페치 블록 전체 제거**

L975~1003의 `void fetch(\`/api/chat/${...}/evidence?...\`)` 블록 전체 삭제. 주석 `// Evidence is supplemental; the session itself has already loaded.`도 함께. toolCalls 재수화 손실을 감수한다(감사 결과 미영속 — SSE tool_calls는 유지됨). 이 시점 evidence 라우트는 죽은 코드가 되지만 파일 삭제는 Task 4에서.

- [ ] **Step 4: 타입체크로 파급 확인**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: ChatMessage.tsx / ResearchProgress.tsx에서 citations 참조 오과 (Task 2·3에서 해결). 이 오류 목록이 곧 수정 체크리스트.

- [ ] **Step 5: Commit**

```
refactor(chat): stop tracking citations in chat state
```

### Task 2: ChatMessage에서 인용 렌더링 제거 + 진행 문구 중성화

**Files:**
- Modify: `src/components/ChatMessage.tsx` (L6 import, L42 프롭, L471 구조분해, L543/553~555/563 렌더, activityLabel L342~366)
- Test: `src/components/ChatMessage.activityLabel.test.ts` (신규)

**Interfaces:**
- Consumes: Task 1의 ChatState 변화.
- Produces: `export function activityLabel(activity?: ResearchActivityUpdate | null): string` — 파일에서 export로 변경(테스트용).

- [ ] **Step 1: 실패 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { activityLabel } from "./ChatMessage";

describe("activityLabel", () => {
  it("uses source-neutral progress copy for every stage", () => {
    expect(activityLabel({ stage: "checking_evidence" } as never)).toBe("자료 확인 중");
    expect(activityLabel({ stage: "researching" } as never)).toBe("자료 확인 중");
    expect(activityLabel(null)).toBe("자료 확인 중");
    expect(activityLabel({ stage: "composing" } as never)).toBe("답변 작성 중");
  });
});
```

- [ ] **Step 2: RED 확인**

Run: `npx vitest run src/components/ChatMessage.activityLabel.test.ts`
Expected: FAIL — activityLabel 미export이면 import 오류, export만 하면 "근거 확인 중" 불일치로 실패.

- [ ] **Step 3: 구현 — export + 문구 교체 + 렌더링 제거**

- activityLabel을 export하고 문구 교체: `"근거 정리 중"`→`"자료 확인 중"`, default `"근거 확인 중"`→`"자료 확인 중"` (queued/composing 등 기존 문구 유지).
- L6 EvidenceGraphPreview import 삭제, L42/L471 citations 프롭 삭제.
- 스트리밍 블록에서 `<EvidenceGraphPreview ... />` 삭제, 조건 `!toolCalls?.length && !citations?.length` → `!toolCalls?.length`.
- ResearchProgress 호출에서 `citations={citations}` 제거.

- [ ] **Step 4: GREEN 확인**

Run: `npx vitest run src/components/ChatMessage.activityLabel.test.ts` → PASS

- [ ] **Step 5: Commit**

```
refactor(chat): drop citation rendering and neutralize progress copy
```

### Task 3: ResearchProgress에서 citations 프롭 제거

**Files:**
- Modify: `src/components/ResearchProgress.tsx` (ChatCitation import, citations 프롭 선언·사용부 전부)

- [ ] **Step 1: 프롭·렌더 제거** — citations 관련 prop/분기만 삭제. toolCalls 기반 진행 표시는 유지.
- [ ] **Step 2: 검증** — `npx tsc --noEmit` 클린, `npx vitest run` 전량 통과.
- [ ] **Step 3: Commit** — `refactor(chat): research progress no longer consumes citations`

### Task 4: 인용 전용 파일·타입 삭제

**Files:**
- Delete: `src/components/EvidenceGraphPreview.tsx`
- Delete: `src/lib/chat/evidence-graph.ts` (+ 동반 test 파일 존재 시)
- Delete: `src/app/api/chat/[sessionId]/evidence/route.ts`, `route.test.ts`
- Modify: `src/app/dev/components/DevComponentsGallery.tsx` (전시 섹션 제거)
- Modify: `src/types/api-contracts.ts` (ChatCitation, GetChatEvidenceResponse — 사용처 0 확인 후)
- Modify: 필요 시 `src/types/database.ts` (DB 뷰 타입 중 evidence 전용이면)

- [ ] **Step 1: 사용처 재확인** — `grep -rn "ChatCitation\|EvidenceGraphPreview\|evidence-graph" src --include="*.ts*" | grep -v 삭제대상` → 0건 확인.
- [ ] **Step 2: 파일 삭제·정리** — `git rm` 위 4~5개 파일, Gallery에서 해당 전시 블록 제거, 타입 정의 삭제.
- [ ] **Step 3: 검증** — `npx tsc --noEmit` 클린 + `npm run test:unit` 전량 통과 + `npm run test:e2e:public` 통과.
- [ ] **Step 4: Commit** — `refactor(chat): remove evidence endpoint and citation-only modules`

## Phase 2 — 실제 답변 예시 (로그인 전 가치 증명)

### Task 5: 완성 답변 선별 → 정적 콘텐츠 파일

**Files:**
- Create: `src/content/sample-research-answer.ko.ts`

**Interfaces:**
- Produces: `SampleResearchAnswer` 타입과 `SAMPLE_RESEARCH_ANSWERS: SampleResearchAnswer[]` (Task 6·7가 소비). 구조:

```ts
export interface SampleResearchAnswer {
  id: string;            // "aapl-revenue-2026q2"
  ticker: string;        // "AAPL"
  question: string;      // 사용자가 던진 원문 질문
  askedAtLabel: string;  // "2026년 8월" — 표시용
  sections: { heading: string; body: string }[]; // 2~4개, 답변 원문 발췌
  sourceRunLabel: string;// "실제 리서치 답변 발췌" 배지용
}
```

- [ ] **Step 1: prod에서 후보 답변 조회** — pooler 접속(비밀번호는 `.env.mac-worker.production` postgres URL) 후:

```sql
SELECT m.id, s.ticker, left(m.content, 300) AS head, m.created_at
FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id
WHERE m.role = 'assistant' AND m.status = 'completed'
  AND length(m.content) BETWEEN 1200 AND 4000
ORDER BY m.created_at DESC LIMIT 10;
```

대형주(AAPL/NVDA/MSFT 등) 1건, 일반 사용자가 흥미롭게 읽을 질문 우선. 원문을 그대로 발췌(창작 금지 — 신뢰가 핵심).

- [ ] **Step 2: 데이터 파일 작성** — 발췌 원문을 위 인터페이스로 1~2건 입력. 하단 고정 문구 포함: "실제 리서치 답변에서 발췌했습니다. 가입하면 이런 답변을 바로 받아볼 수 있습니다."
- [ ] **Step 3: Commit** — `feat(content): curated sample research answer snapshots`

### Task 6: SampleResearchAnswerCard 컴포넌트 + 질문 페이지 배치

**Files:**
- Create: `src/lib/content/sample-answer-display.ts` (순수 로직)
- Test: `src/lib/content/sample-answer-display.test.ts`
- Create: `src/components/public/SampleResearchAnswerCard.tsx` (서버 컴포넌트)
- Modify: `src/app/[locale]/(public)/questions/page.tsx` (신규 섹션)

**Interfaces:**
- Consumes: Task 5의 `SAMPLE_RESEARCH_ANSWERS`.
- Produces: `<SampleResearchAnswerCard answer={SampleResearchAnswer} ctaHref={string} />`, `sampleAnswerCtaHref(answer): string` → `/chat/new?query=<질문>&ticker=<티커>` (chat 시작 파라미터 규격과 동일).

- [ ] **Step 1: 실패 테스트**

```ts
import { describe, expect, it } from "vitest";
import { sampleAnswerCtaHref, estimatedReadMinutes } from "./sample-answer-display";

describe("sample answer display", () => {
  it("builds a chat starter href with the original question", () => {
    expect(sampleAnswerCtaHref({ id: "x", ticker: "aapl", question: "애플 매출이 궁금해", askedAtLabel: "", sections: [], sourceRunLabel: "" }))
      .toBe("/chat/new?query=" + encodeURIComponent("애플 매출이 궁금해") + "&ticker=AAPL");
  });
  it("estimates read minutes from section bodies", () => {
    const body = "가".repeat(1800); // ~900자/분 가정
    expect(estimatedReadMinutes({ sections: [{ heading: "h", body }] })).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: RED 확인** — `npx vitest run src/lib/content/sample-answer-display.test.ts` → 모듈 없음 실패.
- [ ] **Step 3: 구현** — 로직 파일 + 카드 컴포넌트(질문 헤더·티커 배지·섹션 발췌·"답변 예시" 배지·CTA 링크). questions 페이지 "GRAPH LIBRARY" 위에 "실제 답변 예시" 섹션으로 1건 배치.
- [ ] **Step 4: GREEN + 화면 확인** — 단위 통과 + `npm run test:e2e:public` + 로컬 dev에서 /ko/questions 육안 확인.
- [ ] **Step 5: Commit** — `feat(questions): show a real research answer example`

## Phase 3 — 랜딩 재작성 + 길찾기

### Task 7: 랜딩 카피·우측 위젯 교체

**Files:**
- Modify: `src/app/[locale]/(public)/page.tsx` (ko/en copy 오브젝트 전체, JSX 우측 컬럼)

**카피 방향(구체 안):**
- subtext(ko): "회사 보고서에는 뉴스와 주가만으로는 보이지 않는 단서가..." → **"매일 공시·뉴스·기관 보유·내부자 거래를 한 곳으로 모아, 오늘 확인할 리서치 거리를 골라줍니다."**
- workflowSteps: `["회사 질문","단서 찾기","근거 정리"]` → `["질문 고르기","리서치 실행","매일 이어서 보기"]`
- 우측 위젯: `HomeEvidenceCards`+`HomeTraceExplorer` 제거 → `<SampleResearchAnswerCard>` (Task 6 재사용) + 그 아래 미니 스트립 "공시·뉴스·13F·내부자 거래 · 355개 기업" (기업 페이지 실제 콘텐츠 근거).
- en 카피도 동일 톤으로 대응 번역. `previewEyebrow`/`previewTitle` → "REAL ANSWER" / "실제 답변 예시".
- OG/meta(description)에 "단서" 문구 있으면 교체 (`src/lib/og/page-og.ts` 확인).

- [ ] **Step 1: 카피 오브젝트 수정(ko/en)** — `evidenceCards`, `traceNodes` 오브젝트 삭제, 위 안으로 교체.
- [ ] **Step 2: JSX 위젯 교체** — TraceCard 카드 프레임은 재활용하고 내용물만 SampleResearchAnswerCard+스트립으로.
- [ ] **Step 3: 검증** — `npm run test:e2e:public` + 로컬에서 랜딩 모바일 390px·데스크톱 육안(5초 테스트: "매일 리서치 거리" 메시지 읽히는지).
- [ ] **Step 4: Commit** — `feat(landing): replace citation preview with real answer example`

### Task 8: 랜딩 탐색 정비 (길찾기)

**Files:**
- Modify: `src/app/[locale]/(public)/page.tsx` (browseLinks, KrwBrand href)
- Modify: `src/components/pulse/PulseCard.tsx` (L238 CTA 문구)

**구체 변경:**
- browseLinks(ko/en): `[{피드,/pulse},{뉴스,/news},{질문 예시,/questions},{13F 보유,/ko/13f},{가격,/pricing}]` — 피드를 01로(가장 살아있는 화면이 정문).
- 헤더 `KrwBrand href="/companies"` → `href="/pulse"`, ariaLabel "펄스로 이동"(앱 헤더와 통일).
- 히어로 질문 링크("이 종목 지금 살만한가?") → `/ko/questions#sample-answer`(Task 6 앵커)로, 클릭 기대(답 보기)와 목적지 일치.
- PulseCard L238: `"Research NOW"`→`"리서치 시작"`, `"Researching..."`→`"분석 중…"`.

- [ ] **Step 1: 변경 적용** (위 4건)
- [ ] **Step 2: 검증** — `npx vitest run` + `npm run test:e2e:public` + /pulse 공개 페이지에서 CTA 문구 확인.
- [ ] **Step 3: Commit** — `feat(nav): landing routes to the live feed and localizes research cta`

### Task 9: 배포·프로드 검증

- [ ] **Step 1: 전체 게이트** — `npm run test:unit` && `npx tsc --noEmit` && `npm run test:e2e:public` 전량 통과.
- [ ] **Step 2: 병합·배포** — main 병합 후 `npm run prod:deploy:full -- --agent-provider deepseek` (작업 트리 클린 필수).
- [ ] **Step 3: 프로드 체크리스트** — ① 랜딩에서 "단서/근거" 문구 부재·샘플 답변 렌더 ② 채팅 스트리밍에 "근거 확인 중" 부재 ③ /ko/questions 예시 섹션 ④ 펄스 CTA "리서치 시작" ⑤ 랜딩 헤더 로고→/pulse.
- [ ] **Step 4: 메모리 업데이트** — citation-tracing-removal-decision.md를 "COMPLETE"로, ux-review-findings에서 해당 항목 정리.

---

## 별도 후속 (6번 잔손질 — 이 계획 범위 밖, 조사 완료된 사실만)

- 13F 타이틀 중복: `src/app/institutional-holdings/page.tsx` L14 `title: "기관 13F 보유 공시 | KRW.O"`에서 `" | KRW.O"` 제거(루트 레이아웃 템플릿이 suffix 추가).
- muted 토큰 대비: `src/app/globals.css` L109 `--color-muted: #7c828a`(3.88:1) → `#6d737b`(4.79:1, AA 통과, 미세한 차이).
- 데스크톱 랜딩 와이드 레이아웃(별도 디자인 작업).
- 관심 익명 next=/watchlist/<ticker> — 유효 경로 확인됨, 조치 불요.

## Self-Review 결과

- 스펙 커버: 재분석 3번(Phase 1+3/Task 7), 4번(Phase 2), 5번(Task 8) 대응. 6번은 범위 밖 부록으로.
- 타입 일관: SampleResearchAnswer를 Task 5 정의 → 6·7 소비. activityLabel export는 Task 2에서만 정의.
- 리스크 노트: Task 1의 toolCalls 재수화 손실은 의도적(SSE 유지, evidence는 본래 공백). 채팅 수동 스모크 권장.
