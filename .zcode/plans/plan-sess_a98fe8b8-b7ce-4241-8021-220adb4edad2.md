## 시간 가중 점수 (time-decayed score) 설계

### 핵심 아이디어

과거의 큰 이슈가 현재 작은 이슈를 밀어내는 문제를, **Hacker News / Reddit 스타일 시간 감쇠**로 해결. 뉴스의 본질(지금 무슨 일)을 점수에 반영.

---

### 변경 1: DB 쿼리 정렬을 시간 우선으로 (`news.ts:54-56`)

**현재:**
```ts
.order("market_score", { ascending: false })       // 1순위: 점수
.order("last_published_at", { ascending: false })  // 2순위: 시간
.order("updated_at", { ascending: false })
.limit(100)
```

**변경:**
```ts
.order("last_published_at", { ascending: false, nullsFirst: false })  // 1순위: 시간
.order("market_score", { ascending: false })                          // 2순위: 점수
.order("updated_at", { ascending: false })
.limit(100)
```

**효과**: 최신 뉴스가 무조건 후보 풀에 들어옴. 점수는 동점일 때만 의미.

### 변경 2: 보관 기간 14일 → 5일 (`news.ts:12`)

```ts
const NEWS_RETENTION_MS = 5 * DAY_MS;  // 14 → 5
```

**효과**: 5일 넘은 뉴스 후보 제거. 뉴스의 유통기한 단축. 5일이면 freshnessScore에서 ≤72h=9점, 4일차엔 4점으로 자연 감쇠하다 만료.

### 변경 3: 시간 가중 점수 함수 신규 추가 (`ranking.ts`)

`newsEvidenceScore`를 대체하는 `newsTimeDecayedScore` 함수 추가:

```ts
function newsTimeDecayedScore(candidate: PulseCandidate, now: Date): number {
  const marketScore = numericMetadata(candidate, "market_issue_market_score");
  const sources = numericMetadata(candidate, "market_issue_source_count");
  const official = numericMetadata(candidate, "market_issue_official_source_count");

  // 정적 근거 점수 (기존 newsEvidenceScore와 동일, 0~8점)
  const evidenceBase = Math.min(3, sources) + Math.min(2, official) + Math.min(3, Math.floor(marketScore / 35));

  // 시간 감쇠 가중치 (지수 감소, half-life = 24시간)
  // 0h=1.0, 12h=0.71, 24h=0.5, 48h=0.25, 72h=0.125, 5d=0.03
  const ageHours = Math.max(0, now.getTime() - Date.parse(candidate.occurred_at)) / HOUR_MS;
  const NEWS_HALF_LIFE_HOURS = 24;
  const decayWeight = Math.pow(0.5, ageHours / NEWS_HALF_LIFE_HOURS);

  // 감쇠된 점수: evidenceBase * decayWeight, 범위 0~8 유지
  return Math.min(8, evidenceBase * decayWeight);
}
```

**계산 예시** (현재 데이터 기준):

| 뉴스 | market_score | 나이 | evidenceBase | decayWeight | 최종 점수 |
|---|---|---|---|---|---|
| Gemini Robotics 2 (오늘) | 1637 | 1h | 8 | 0.97 | **7.8** |
| NVIDIA 오픈 웨이트 (오늘) | 932 | 0h | 8 | 1.0 | **8.0** |
| 마셔블 Jimothy (4.7일 전) | 1387 | 113h | 8 | 0.04 | **0.3** |
| 구글 어스 AI (4일 전) | 556 | 100h | 5 | 0.06 | **0.3** |

→ 오늘 뉴스(7~8점)가 4일 전 뉴스(0.3점)를 압도.

### 변경 4: `getRankScore`에서 news evidence 호출 교체 (`ranking.ts:376`)

**현재:**
```ts
: candidate.kind === "news" ? newsEvidenceScore(candidate) : 0;
```

**변경:**
```ts
: candidate.kind === "news" ? newsTimeDecayedScore(candidate, now) : 0;
```

**주의**: `getRankScore`는 이미 `now` 파라미터를 받고 있어 시그니처 변경 불필요.

### 변경 5: `news.ts`의 `compareNewsCandidates`도 시간 우선으로 (`news.ts:189-203`)

소스 내부 정렬도 시간을 더 앞으로:

```ts
function compareNewsCandidates(left: PulseCandidate, right: PulseCandidate): number {
  // 개인화 우선은 유지 (관심 기업 뉴스를 먼저)
  const personal = Number(right.metadata.market_issue_personal_match === true)
    - Number(left.metadata.market_issue_personal_match === true);
  if (personal !== 0) return personal;
  const followed = Number(right.metadata.market_issue_followed_match === true)
    - Number(left.metadata.market_issue_followed_match === true);
  if (followed !== 0) return followed;

  // === 시간을 priority/score보다 앞으로 ===
  const occurred = Date.parse(right.occurred_at) - Date.parse(left.occurred_at);
  if (occurred !== 0) return occurred;

  const priority = priorityWeight(right.priority) - priorityWeight(left.priority);
  if (priority !== 0) return priority;
  const score = numberMetadata(right, "market_issue_market_score") - numberMetadata(left, "market_issue_market_score");
  if (score !== 0) return score;
  return left.item_key.localeCompare(right.item_key);
}
```

---

### 설계 근거: half-life 24시간 선택 이유

| half-life | 1일 후 | 3일 후 | 5일 후 | 특징 |
|---|---|---|---|---|
| 12h | 0.5 | 0.125 | 0.03 | 너무 가파름 — 어제 뉴스가 반값 |
| **24h** | **0.5** | **0.125** | **0.03** | **균형 — 하루 지나면 반, 3일이면 12.5%** |
| 48h | 0.71 | 0.35 | 0.17 | 너무 완만 — 3일 전도 35% |

24시간 half-life의 의미:
- **오늘(≤6h)**: 거의 감쇠 없음 (0.86~1.0) — freshnessScore(18점)와 시너지
- **어제(24h)**: 절반 (0.5) — 여전히 경쟁력
- **3일 전**: 12.5% — 거의 사라짐, freshnessScore(9점)로 보완
- **5일 전**: 3% — 사실상 제거 (보관 기간 만료 직전)

이게 랭킹의 다른 신호(개인화 +15, 연속성 등)와 균형을 이룸. freshnessScore(계단식 18→14→9→4→0)는 그대로 두고, evidence 점수에만 감쇠를 적용해서 **이중 시간 패널티** 효과.

---

### 파일 변경 요약

| 파일 | 변경 |
|---|---|
| `src/lib/pulse/sources/news.ts` | DB 쿼리 정렬 시간 우선, 보관 5일, `compareNewsCandidates` 시간 우선 |
| `src/lib/pulse/ranking.ts` | `newsTimeDecayedScore` 함수 추가, `newsEvidenceScore` 대체 |
| `src/lib/pulse/sources/news.test.ts` | 시간 정렬 기대값 업데이트 |
| `src/lib/pulse/ranking.test.ts` | 시간 감쇠 점수 케이스 추가 |

### 기존 `newsEvidenceScore` 처리

제거하지 않고 **deprecated 주석**만 추가하고 `newsTimeDecayedScore`로 교체. 다른 종류(filing/question)는 시간 감쇠가 의미 없으므로 건드리지 않음.

### 영향 범위

- 뉴스 점수만 변경 — 공시/분석/질문 등 다른 소스는 영향 없음
- freshnessScore(계단식)는 그대로 — 이중 시간 패널티로 의도적 설계
- ETag/리비전 시스템 영향 없음
- 기존 테스트 2개 업데이트 필요 (정렬 순서 변경 반영)