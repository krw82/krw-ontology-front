import "server-only";

import { spawn } from "node:child_process";
import path from "node:path";
import type { AtomicNewsEventCard, SourcePreview } from "@/types/api-contracts";

export type NewsTextTranslator = (texts: string[]) => Promise<string[]>;

export interface NewsCardTranslationResult {
  cards: AtomicNewsEventCard[];
  translation: {
    attempted: boolean;
    translated: boolean;
    provider: "py-googletrans" | "none";
    text_count: number;
    latency_ms: number;
    error?: string;
  };
}

const DEFAULT_TRANSLATION_TIMEOUT_MS = 7000;
const DEFAULT_MAX_TRANSLATED_TEXTS = 10;

export async function translateFallbackNewsCards(
  cards: AtomicNewsEventCard[],
  options: {
    translateTexts?: NewsTextTranslator;
  } = {},
): Promise<NewsCardTranslationResult> {
  const startedAt = Date.now();
  const requests = collectTranslationRequests(cards);
  if (requests.length === 0 || translationDisabled()) {
    return {
      cards,
      translation: {
        attempted: false,
        translated: false,
        provider: "none",
        text_count: 0,
        latency_ms: Date.now() - startedAt,
      },
    };
  }

  try {
    const translateTexts =
      options.translateTexts ?? translateTextsWithGoogletrans;
    const translations = await translateTexts(
      requests.map((request) => request.text),
    );
    const byKey = new Map<string, string>();

    requests.forEach((request, index) => {
      const translated = normalizeKoreanTranslation(translations[index]);
      if (translated) byKey.set(request.key, translated);
    });

    if (byKey.size === 0) {
      return {
        cards,
        translation: {
          attempted: true,
          translated: false,
          provider: "py-googletrans",
          text_count: requests.length,
          latency_ms: Date.now() - startedAt,
          error: "empty_or_non_korean_translation",
        },
      };
    }

    return {
      cards: applyTranslations(cards, byKey),
      translation: {
        attempted: true,
        translated: true,
        provider: "py-googletrans",
        text_count: byKey.size,
        latency_ms: Date.now() - startedAt,
      },
    };
  } catch (error) {
    return {
      cards,
      translation: {
        attempted: true,
        translated: false,
        provider: "py-googletrans",
        text_count: requests.length,
        latency_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function translateTextsWithGoogletrans(
  texts: string[],
): Promise<string[]> {
  if (texts.length === 0) return [];

  const python = process.env.NEWS_TRANSLATION_PYTHON || "python3";
  const script =
    process.env.NEWS_TRANSLATION_GOOGLETRANS_SCRIPT ||
    path.join(process.cwd(), "scripts", "translate-news-googletrans.py");
  const timeoutMs = readPositiveInt(
    process.env.NEWS_TRANSLATION_TIMEOUT_MS,
    DEFAULT_TRANSLATION_TIMEOUT_MS,
  );

  const payload = JSON.stringify({ src: "en", dest: "ko", texts });
  const result = await runPythonTranslator({
    python,
    script,
    payload,
    timeoutMs,
  });
  if (!result.ok) {
    throw new Error(result.error || "googletrans_failed");
  }
  return result.translations;
}

function translationDisabled(): boolean {
  const provider = process.env.NEWS_CARD_TRANSLATION_PROVIDER;
  return provider === "off" || provider === "none" || provider === "0";
}

function collectTranslationRequests(cards: AtomicNewsEventCard[]) {
  const maxTexts = readPositiveInt(
    process.env.NEWS_TRANSLATION_MAX_TEXTS,
    DEFAULT_MAX_TRANSLATED_TEXTS,
  );
  const requests: Array<{ key: string; text: string }> = [];
  const seen = new Set<string>();

  for (const card of cards) {
    addRequest(
      requests,
      seen,
      titleKey(card.id),
      card.original_headline || card.event_title,
    );
    addRequest(requests, seen, summaryKey(card.id), card.short_summary);
    if (requests.length >= maxTexts) break;
  }

  return requests.slice(0, maxTexts);
}

function addRequest(
  requests: Array<{ key: string; text: string }>,
  seen: Set<string>,
  key: string,
  value: unknown,
) {
  if (typeof value !== "string") return;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || !isEnglishHeavy(text) || seen.has(text.toLowerCase())) return;
  seen.add(text.toLowerCase());
  requests.push({ key, text });
}

function applyTranslations(
  cards: AtomicNewsEventCard[],
  translations: Map<string, string>,
): AtomicNewsEventCard[] {
  return cards.map((card) => {
    const titleKo = translations.get(titleKey(card.id));
    const summaryKo = translations.get(summaryKey(card.id));
    const sourcePreviews = (card.source_previews ?? []).map((source) =>
      translateSourcePreview(source, titleKo, summaryKo),
    );
    const primarySource = card.primary_source
      ? translateSourcePreview(card.primary_source, titleKo, summaryKo)
      : sourcePreviews[0];

    return {
      ...card,
      event_title_ko: titleKo ?? card.event_title_ko,
      summary_ko: summaryKo ?? card.summary_ko,
      source_previews: sourcePreviews,
      primary_source: primarySource,
      ui: {
        ...card.ui,
        badge_ko:
          card.price_impact_direction === "negative"
            ? "약세 요인"
            : card.price_impact_direction === "positive"
              ? "강세 요인"
              : (card.ui?.badge_ko ?? "시장 뉴스"),
        confidence_label_ko:
          titleKo || summaryKo ? "번역 후보" : card.ui?.confidence_label_ko,
      },
    };
  });
}

function translateSourcePreview(
  source: SourcePreview,
  titleKo?: string,
  summaryKo?: string,
): SourcePreview {
  return {
    ...source,
    title_ko: titleKo ?? source.title_ko,
    summary_ko: summaryKo ?? source.summary_ko,
  };
}

function normalizeKoreanTranslation(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || isEnglishHeavy(normalized)) return undefined;
  return normalized;
}

function runPythonTranslator(params: {
  python: string;
  script: string;
  payload: string;
  timeoutMs: number;
}): Promise<
  { ok: true; translations: string[] } | { ok: false; error: string }
> {
  return new Promise((resolve) => {
    const child = spawn(params.python, [params.script], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ ok: false, error: "googletrans_timeout" });
    }, params.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: error.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const parsed = parsePythonTranslatorOutput(stdout);
      if (code !== 0) {
        resolve({
          ok: false,
          error:
            translatorError(parsed) || stderr.trim() || `python_exit_${code}`,
        });
        return;
      }

      try {
        if (parsed.ok === true && Array.isArray(parsed.translations)) {
          resolve({
            ok: true,
            translations: parsed.translations.map((value) =>
              typeof value === "string" ? value : "",
            ),
          });
          return;
        }
        resolve({
          ok: false,
          error: translatorError(parsed) || "invalid_googletrans_output",
        });
      } catch (error) {
        resolve({
          ok: false,
          error: error instanceof Error ? error.message : "invalid_json_output",
        });
      }
    });

    child.stdin.end(params.payload);
  });
}

function parsePythonTranslatorOutput(stdout: string): {
  ok?: boolean;
  translations?: unknown;
  error?: unknown;
  message?: unknown;
} {
  try {
    return JSON.parse(stdout) as {
      ok?: boolean;
      translations?: unknown;
      error?: unknown;
      message?: unknown;
    };
  } catch {
    return {};
  }
}

function translatorError(parsed: {
  error?: unknown;
  message?: unknown;
}): string | undefined {
  if (typeof parsed.error !== "string" || !parsed.error.trim())
    return undefined;
  const message =
    typeof parsed.message === "string" && parsed.message.trim()
      ? parsed.message.trim()
      : undefined;
  return message ? `${parsed.error.trim()}: ${message}` : parsed.error.trim();
}

function titleKey(id: string): string {
  return `${id}:title`;
}

function summaryKey(id: string): string {
  return `${id}:summary`;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isEnglishHeavy(value: string): boolean {
  const latinCount = (value.match(/[A-Za-z]/g) ?? []).length;
  const hangulCount = (value.match(/[가-힣]/g) ?? []).length;
  return latinCount >= 24 && latinCount > Math.max(8, hangulCount * 1.4);
}
