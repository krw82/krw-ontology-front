# Output Contract

## Opening

Start with one filing-supported scenario judgment before any heading.

Example:

```text
현재 공시 기준으로는 수요 둔화보다 투자 부담이 현금흐름으로 얼마나 오래 이어지는지가 더 중요한 변수입니다.
```

## Required Structure

Use:

```text
## 현재 기준점
## 시나리오 지도
## 핵심 민감도
## 하방과 유동성
## 판단이 바뀌는 조건
## 최종 해석
### 이어서 볼 질문
```

Do not add a separate generic limitation section.

## Scenario Table

Prefer:

```text
| 시나리오 | 발생 조건 | 실적 연결 | 투자 해석 |
```

Keep it interpretation-first. Include exact figures only when they materially change the judgment.

## Assumption Labels

Explain assumption origin naturally:

```text
회사가 공시한 기준
공시 흐름에서 도출한 조건
사용자가 제시한 가정
조건부 해석
```

Do not expose internal object or schema labels.

## Follow-Ups

End with exactly three short same-company prompts the user can send immediately.

Use this pattern:

```text
- 이 판단이 강해지는 회사 코멘트만 정리해줘.
- 하방 시나리오에서 현금이 먼저 압박받는 경로를 더 자세히 봐줘.
- 다음 공시에서 가정 파기 신호만 확인해줘.
```
