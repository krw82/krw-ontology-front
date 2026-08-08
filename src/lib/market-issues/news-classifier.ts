/**
 * News event pre-filter for the web ingestion pipeline.
 *
 * Classifies whether a fetched web article represents an actual market-moving
 * news event, as opposed to IR page chrome, navigation, stock widgets, or
 * historical company background. This runs BEFORE the expensive enrichment
 * composition LLM, so non-news content is rejected at the source — avoiding
 * issue creation, media extraction, and the compose call entirely.
 *
 * Validated at 87.5% accuracy (7/8 fake rejected, 7/8 real passed, 0 errors)
 * against a prod-derived test set of IR-metadata pages vs real press releases.
 */

export type NewsClassification = {
  isNewsEvent: boolean;
  confidence: number;
  reason: string;
  eventType: string;
};

export type NewsClassifierConfig = {
  zaiBaseUrl: string;
  zaiApiKey: string;
  zaiModel: string;
  zaiTimeoutMs: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Prompt v2 — validated against prod data (87.5% accuracy, 0 errors)
// ─────────────────────────────────────────────────────────────────────────────

const NEWS_CLASSIFIER_PROMPT = `당신은 금융 뉴스 편집자입니다. 주어진 원문과 URL을 분석하여, 이것이 "현재 시장에 영향을 미치는 구체적인 뉴스 이벤트 보도"인지 판별하라.

【승인 조건 — 뉴스 이벤트】 (다음 중 하나 이상 해당)
1. 구체적 재무 실적 발표 (분기/연간 매출, EPS, 순이익 등 수치 동반)
2. M&A, 합병, 인수, 매각 완료 (거래 규모/대상 명시)
3. 신제품/신약 출시, FDA 승인, 임상시험 결과, 의료기기 허가
4. 경영진 변경 (CEO/CFO 교체 등), 대규모 감원, 구조조정 발표
5. 배당/자본정책/주식환매 변경 (구체적 금액/비율)
6. 규제 처분, 소송 판결, 법적 분쟁
7. 파트너십/협약/계약 체결 (구체적 대상/규모 동반)
8. 신규 서비스/플랫폼 론칭, 시장 진출, 채널 확대
9. 마일스톤 달성, 기념 보고서, 주요 임상/사업 성과 발표 (구체적 데이터 포함 시)

【거부 조건 — 뉴스가 아님】
A. IR/투자자 페이지의 네비게이션, 메뉴, 페이지 구조 자체
B. 경영진 소개, 이사회 명단, 조직도, 기업 개요/회사 소개서
C. 실시간 주가/시세/차트 데이터 (위젯/스크립트로 생성된 시세)
D. 회사 소개서, 제품 카탈로그, 브랜드 목록
E. 보고서/공시의 "다운로드 링크 목록" (실제 내용이 아닌 링크 나열)
F. "IR 페이지가 존재한다", "실적 발표 섹션이 있다" 같은 페이지 존재 여부
G. 과거에 발생한 역사적 사건의 설명 (예: "2012년에 분사했다", "2015년에 인수했다" 같은 회사 역사)
   — 현재 진행형이 아닌 과거형 서술 + 특정 과거 날짜가 있으면 거부
H. 페이지의 크롬(chrome) — 헤더/푸터/사이드바 메뉴, 언어 선택, 국가 선택

【URL 힌트】
다음 URL 패턴은 메타데이터 페이지일 가능성이 높다 (결정적 증거가 없으면 거부):
- /stock-quote, /stock, /share-price → 주가 페이지
- /leadership, /management, /board-of-directors, /governance → 조직 소개
- /investors/, /investor-relations, /ir/ → IR 랜딩 (개별 보도자료가 아닌 경우)
- /about/, /who-we-are, /company-overview → 회사 소개

반드시 아래 JSON만 출력하라 (마크다운/코드블록 없이):
{"is_news_event": true 또는 false, "confidence": 0.0~1.0, "reason": "판단 근거 한국어 한 줄", "event_type": "earnings|ma|product|regulatory|partnership|dividend|management_change|milestone|none"}`;

// ─────────────────────────────────────────────────────────────────────────────
// Cost-saving guards — skip the LLM call entirely for obvious cases
// ─────────────────────────────────────────────────────────────────────────────

const MIN_BODY_CHARS = 200;
const MAX_BODY_CHARS = 5000; // truncate before sending — keeps token usage bounded

/**
 * URL path patterns that are almost certainly non-news metadata pages.
 * If the URL matches, we still run the classifier but the prompt's URL hint
 * section handles it. This array is kept for documentation; the LLM does the
 * final decision so we don't hard-reject legitimate press releases that happen
 * to live under /investors/ (e.g. /investors/press-releases/2026-q1).
 */
export const METADATA_URL_PATTERNS: readonly RegExp[] = [
  /\/stock-quote\b/i,
  /\/stock\b(?!-)/i,
  /\/share-price\b/i,
  /\/leadership\b/i,
  /\/board-of-directors\b/i,
  /\/governance\b/i,
  /\/executive(-team|s)?\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// LLM call
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  return (value && typeof value === "object" ? value : {}) as Row;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function extractJson(text: string): Row | null {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Row;
  } catch {
    return null;
  }
}

/**
 * Classify whether the given article is a genuine news event.
 *
 * Returns `{ isNewsEvent: true }` on any error (fail-open) so that a classifier
 * outage never blocks the ingestion pipeline — the downstream enrichment
 * gates (`isEvergreenWebContext`, manual review) remain as backstops.
 *
 * Callers should pass the FULL article body; this function truncates internally.
 */
export async function classifyAsNewsEvent(
  config: NewsClassifierConfig,
  url: string,
  title: string,
  body: string,
): Promise<NewsClassification> {
  // Guard 1: too little content to classify meaningfully
  if (body.trim().length < MIN_BODY_CHARS) {
    return {
      isNewsEvent: false,
      confidence: 1,
      reason: "body_too_short_for_news_classification",
      eventType: "none",
    };
  }

  const snippet = body.slice(0, MAX_BODY_CHARS);

  try {
    const response = await fetch(config.zaiBaseUrl + "/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(config.zaiTimeoutMs),
      headers: {
        Authorization: "Bearer " + config.zaiApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.zaiModel,
        stream: false,
        max_tokens: 4096,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        temperature: 0.1,
        messages: [
          { role: "system", content: NEWS_CLASSIFIER_PROMPT },
          {
            role: "user",
            content: `URL: ${url}\n\n원문:\n${snippet}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      // Fail-open: don't block ingestion on classifier errors
      return {
        isNewsEvent: true,
        confidence: 0,
        reason: `classifier_http_${response.status}_fail_open`,
        eventType: "unknown",
      };
    }

    const payload = asRow(await response.json());
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const firstChoice = choices[0] as Row | undefined;
    const message = (firstChoice?.message ?? {}) as Row;
    const content = asString(message.content ?? "");
    const parsed = extractJson(content);

    if (!parsed) {
      return {
        isNewsEvent: true,
        confidence: 0,
        reason: "classifier_parse_fail_open",
        eventType: "unknown",
      };
    }

    return {
      isNewsEvent: parsed.is_news_event !== false,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      reason: asString(parsed.reason) || "classifier_no_reason",
      eventType: asString(parsed.event_type) || "unknown",
    };
  } catch (error) {
    // Network timeout, DNS, etc. — fail-open
    return {
      isNewsEvent: true,
      confidence: 0,
      reason: `classifier_error_fail_open:${error instanceof Error ? error.message : "unknown"}`,
      eventType: "unknown",
    };
  }
}
