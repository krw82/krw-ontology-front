"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AnimatePresence, motion } from "motion/react";
import TopNav from "@/components/TopNav";
import ChatMessage from "@/components/ChatMessage";
import CompanyLogo from "@/components/CompanyLogo";
import Composer, {
  type ComposerHandle,
  type ComposerSendOptions,
  type ComposerSendResult,
} from "@/components/Composer";
import QueueRemotionAnimation from "@/components/QueueRemotionAnimation";
import SuggestedPromptActions from "@/components/SuggestedPromptActions";
import RunStatusDock from "@/components/RunStatusDock";
import { useChat } from "@/hooks/useChat";
import { useChatMobileDock } from "@/hooks/useChatMobileDock";
import { useEntitlement } from "@/hooks/useEntitlement";
import { useResearchModePreference } from "@/hooks/useResearchModePreference";
import {
  getSessionTickers,
  buildChatSessionHref,
} from "@/lib/chat/history-state";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";
import {
  getCompanyDisplayCopyForTicker,
  getSuggestedPromptDisplaysForTickers,
} from "@/content/companies/display";
import { trackClientEventSilently } from "@/lib/analytics/client";
import { findQuestionTopic } from "@/lib/marketing/site";
import { createClientId } from "@/lib/client-id";
import { normalizeTicker } from "@/lib/ontology/ticker";
import { normalizeRunKind, type RunKind } from "@/lib/run-kind";
import {
  buildGuruSessionHref,
  getGuruLens,
  getGuruLensDisplayName,
  getGuruLensPromptPrefix,
  getGuruSuggestedPrompts,
  normalizeGuruLensKey,
  type GuruLensOption,
} from "@/lib/guru-lenses";
import type { ResearchMode } from "@/lib/research-mode";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  UserCompanyNotebook,
  UserCompanyMark,
} from "@/types/api-contracts";
import type { EntitlementStatus } from "@/types/entitlement";

const DRAFT_MESSAGE_STORAGE_PREFIX = "krw:chat-draft-message:";
const ALWAYS_SHOW_NOTEBOOK_ONBOARDING_IN_DEV =
  process.env.NODE_ENV === "development";
const ALWAYS_SHOW_CREDIT_LIMIT_CARD_IN_DEV =
  process.env.NODE_ENV === "development";

type DraftMessagePayload = {
  content: string;
  requestId: string;
  runKind?: RunKind;
  userUrl?: string;
  userUrls?: string[];
  attachmentIds?: string[];
};

function draftMessageStorageKey(draftMessageId: string): string {
  return `${DRAFT_MESSAGE_STORAGE_PREFIX}${draftMessageId}`;
}

function storeDraftMessage(
  draftMessageId: string,
  payload: DraftMessagePayload,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(
      draftMessageStorageKey(draftMessageId),
      JSON.stringify(payload),
    );
    return true;
  } catch {
    return false;
  }
}

function readDraftMessage(draftMessageId: string): DraftMessagePayload | null {
  if (typeof window === "undefined") return null;
  const key = draftMessageStorageKey(draftMessageId);
  const rawPayload = window.sessionStorage.getItem(key);
  if (!rawPayload) return null;

  try {
    const payload = JSON.parse(rawPayload) as Partial<DraftMessagePayload>;
    const content = payload.content?.trim();
    const requestId = payload.requestId?.trim();
    const rawRunKind =
      typeof payload.runKind === "string" ? payload.runKind : undefined;
    const runKind = rawRunKind ? normalizeRunKind(rawRunKind) : undefined;
    const userUrls = Array.isArray(payload.userUrls)
      ? payload.userUrls
          .map((url) => (typeof url === "string" ? url.trim() : ""))
          .filter(Boolean)
      : [];
    const userUrl = payload.userUrl?.trim() || userUrls[0];
    const attachmentIds = Array.isArray(payload.attachmentIds)
      ? payload.attachmentIds
          .map((id) => (typeof id === "string" ? id.trim() : ""))
          .filter(Boolean)
      : [];
    if (!content || !requestId) return null;
    return {
      content,
      requestId,
      ...(runKind ? { runKind } : {}),
      ...(userUrl ? { userUrl } : {}),
      ...(userUrls.length > 0 ? { userUrls } : {}),
      ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
    };
  } catch {
    const content = rawPayload.trim();
    return content ? { content, requestId: createClientId() } : null;
  }
}

function removeDraftMessage(draftMessageId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(draftMessageStorageKey(draftMessageId));
}

function sanitizeError(message: string): string {
  // Strip stack traces and internal details
  const cleaned = message.split("\n")[0];
  const lower = cleaned.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("429")) {
    return "현재 KRW-AI 계정/API 요청 한도에 도달했습니다. 잠시 후 다시 시도하거나, 실제 ANTHROPIC_API_KEY를 설정한 뒤 서버를 재시작해주세요.";
  }
  if (cleaned.length > 200) return cleaned.slice(0, 200) + "...";
  return cleaned;
}

function isCreditLimitErrorMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return /크레딧|credit|한도|quota/i.test(message);
}

function formatCreditResetTime(entitlement: EntitlementStatus | null): string {
  const rawResetTime =
    entitlement?.usage.resets_at || entitlement?.usage.period_end || "";
  const resetTime = new Date(rawResetTime);
  if (Number.isNaN(resetTime.getTime())) return "다음 주간 충전 시점";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(resetTime);
}

function CreditLimitErrorCard({
  entitlement,
}: {
  entitlement: EntitlementStatus | null;
}) {
  const resetLabel = formatCreditResetTime(entitlement);
  const billingHref = entitlement?.upgrade.href || "/settings/billing";

  return (
    <div
      className="overflow-hidden rounded-[8px] border border-hairline bg-canvas shadow-[0_18px_48px_rgba(10,11,13,0.08)]"
      role="alert"
    >
      <div className="h-1 bg-primary" aria-hidden="true" />
      <div className="p-base sm:p-lg">
        <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="w-full min-w-0 flex-1 [overflow-wrap:normal]">
            <p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-primary">
              WEEKLY LIMIT
            </p>
            <h3 className="mt-2 text-[20px] font-black leading-7 text-ink sm:text-[22px]">
              주간 분석 한도를 모두 사용했습니다.
            </h3>
            <p className="mt-2 w-full max-w-[36rem] break-normal text-[14px] font-semibold leading-6 text-body [overflow-wrap:normal] [word-break:keep-all] sm:text-[15px]">
              다음 충전 전까지 새 분석은 시작할 수 없습니다. 기존 리서치와
              노트북은 계속 볼 수 있습니다.
            </p>
          </div>
        </div>

        <div className="mt-base grid gap-2 border-t border-hairline pt-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-muted">
              다음 충전
            </p>
            <p className="mt-1 text-[15px] font-black leading-5 text-ink">
              {resetLabel}
            </p>
          </div>
          <Link
            href={billingHref}
            className="inline-flex h-11 items-center justify-center gap-1 rounded-[8px] bg-surface-dark px-sm text-[14px] font-extrabold text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            업그레이드 플랜 보기
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-[18px]"
            >
              arrow_forward
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}

type CompaniesResponse = {
  companies?: Array<{
    ticker: string;
    name?: string | null;
    sector?: string | null;
  }>;
};

type CompanyMeta = {
  ticker: string;
  name: string | null;
  sector: string | null;
};

type ShareStarter = {
  question_content: string;
  tickers: string[];
  title?: string | null;
};

type ChatWorkspace = "chat" | "guru";

type DiscoverGuideStep = "url" | "file" | "idea";

type DiscoverGuideFlowProps = {
  locale: string;
  step: DiscoverGuideStep;
  disabled?: boolean;
  urlValue: string;
  urlError?: string | null;
  ideaValue: string;
  ideaError?: string | null;
  onUrlValueChange: (value: string) => void;
  onCommitUrl: () => void;
  onSkipUrl: () => void;
  onAddFile: () => void;
  onSkipFile: () => void;
  onIdeaValueChange: (value: string) => void;
  onSubmitIdea: () => void;
  onSelectExample: (prompt: string) => void;
};

function normalizeDiscoverUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function DiscoverGuideFlow({
  locale,
  step,
  disabled = false,
  urlValue,
  urlError,
  ideaValue,
  ideaError,
  onUrlValueChange,
  onCommitUrl,
  onSkipUrl,
  onAddFile,
  onSkipFile,
  onIdeaValueChange,
  onSubmitIdea,
  onSelectExample,
}: DiscoverGuideFlowProps) {
  const isKo = locale === "ko";
  const stepOrder: DiscoverGuideStep[] = ["url", "file", "idea"];
  const activeIndex = stepOrder.indexOf(step);
  const examples = isKo
    ? [
        "AI 데이터센터 전력 수요 수혜 기업 중 FCF로 CapEx를 버티는 후보 3개만 찾아줘.",
        "클라우드 소프트웨어 기업 중 RPO와 구독 매출이 함께 늘어나는 후보 3개만 찾아줘.",
        "반도체 공급망 기업 중 AI 매출 노출은 크고 재고 부담은 낮은 후보 3개만 찾아줘.",
      ]
    : [
        "Find 3 AI data-center power beneficiaries that can fund CapEx with FCF.",
        "Find 3 cloud software companies where RPO and subscription revenue are both growing.",
        "Find 3 semiconductor supply-chain companies with high AI revenue exposure and lower inventory risk.",
      ];
  const copy = {
    url: isKo
      ? {
          eyebrow: "선택사항",
          title: "참고할 URL이 있나요?",
          description:
            "뉴스나 리포트 링크가 있으면 먼저 시장 맥락을 잡습니다. 없어도 바로 넘어갈 수 있습니다.",
          primary: "다음",
          secondary: "건너뛰기",
          urlPlaceholder: "https://example.com/report",
        }
      : {
          eyebrow: "Optional",
          title: "Do you have a URL to reference?",
          description:
            "Add a news or report link to set market context first. You can skip this.",
          primary: "Next",
          secondary: "Skip",
          urlPlaceholder: "https://example.com/report",
        },
    file: isKo
      ? {
          eyebrow: "선택사항",
          title: "첨부할 파일이 있나요?",
          description:
            "PDF, txt, md 문서를 질문과 함께 보낼 수 있습니다. 없으면 다음으로 넘어가세요.",
          primary: "파일 선택하기",
          secondary: "건너뛰기",
          fileHint: "선택이 완료되면 다음 단계로 이동합니다.",
        }
      : {
          eyebrow: "Optional",
          title: "Do you have a file to attach?",
          description:
            "Attach PDF, txt, or md documents with the question, or skip this step.",
          primary: "Choose file",
          secondary: "Skip",
          fileHint: "The flow continues after a file is selected.",
        },
    idea: isKo
      ? {
          eyebrow: "시작",
          title: "어떤 아이디어로 종목을 발굴할까요?",
          description:
            "산업, 변화, 리스크, 재무 조건을 한 문장으로 적으면 관련 회사를 넓게 찾아봅니다.",
          primary: "종목 발굴 시작",
          secondary: "예시",
          ideaPlaceholder: "예: AI 데이터센터 수혜지만 부채 부담이 낮은 기업",
        }
      : {
          eyebrow: "Start",
          title: "What idea should we use to discover stocks?",
          description:
            "Describe an industry, shift, risk, or financial condition and we will explore related companies.",
          primary: "Start discovery",
          secondary: "Examples",
          ideaPlaceholder: "e.g. AI data-center beneficiaries with lower debt burden",
        },
  }[step];

  const handlePrimary = () => {
    if (step === "url") {
      onCommitUrl();
      return;
    }
    if (step === "file") {
      onAddFile();
      return;
    }
    onSubmitIdea();
  };
  const handleSecondary = () => {
    if (step === "url") {
      onSkipUrl();
      return;
    }
    if (step === "file") {
      onSkipFile();
      return;
    }
    onSubmitIdea();
  };

  return (
    <div className="mx-auto w-full max-w-[38rem] text-left">
      <div
        className="mb-2 grid grid-cols-3 gap-1.5"
        aria-label={isKo ? "종목 발굴 단계" : "Discovery steps"}
      >
        {stepOrder.map((item, index) => (
          <span
            key={item}
            className={[
              "h-1.5 rounded-full transition-colors",
              index <= activeIndex ? "bg-primary" : "bg-surface-dim",
            ].join(" ")}
            aria-hidden="true"
          />
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.section
          key={step}
          className="overflow-hidden rounded-[8px] border border-hairline bg-canvas shadow-[0_18px_48px_rgba(10,11,13,0.08)]"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          <div className="flex items-center justify-between border-b border-hairline px-sm py-2 sm:px-base sm:py-sm">
            <p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-primary">
              {copy.eyebrow}
            </p>
            <p className="font-mono text-[11px] font-black tracking-[0.14em] text-muted">
              {String(activeIndex + 1).padStart(2, "0")} / 03
            </p>
          </div>

          <div className="p-sm sm:p-lg">
            <div className="min-w-0">
              <h3 className="text-[19px] font-black leading-7 text-ink sm:text-[24px] sm:leading-8">
                {copy.title}
              </h3>
              <p className="mt-1.5 text-[14px] font-semibold leading-6 text-body sm:mt-2 sm:text-[15px]">
                {copy.description}
              </p>
            </div>

            {step === "url" ? (
              <div className="mt-sm">
                <label className="sr-only" htmlFor="discover-url-input">
                  {copy.title}
                </label>
                <input
                  id="discover-url-input"
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="h-12 w-full rounded-[8px] border border-hairline bg-surface-soft px-sm text-[15px] font-bold leading-6 text-ink shadow-sm transition-colors placeholder:text-muted focus:border-primary focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/25"
                  placeholder={copy.urlPlaceholder}
                  value={urlValue}
                  onChange={(event) => onUrlValueChange(event.currentTarget.value)}
                  disabled={disabled}
                />
                {urlError ? (
                  <p className="mt-2 text-[12px] font-bold leading-5 text-error">
                    {urlError}
                  </p>
                ) : null}
              </div>
            ) : null}

            {step === "file" ? (
              <div className="mt-sm rounded-[8px] border border-hairline bg-surface-soft px-sm py-xs text-[13px] font-bold leading-5 text-muted">
                {copy.fileHint}
              </div>
            ) : null}

            {step === "idea" ? (
              <div className="mt-sm grid gap-3">
                <label className="sr-only" htmlFor="discover-idea-input">
                  {copy.title}
                </label>
                <textarea
                  id="discover-idea-input"
                  className="min-h-[112px] w-full resize-none rounded-[8px] border border-hairline bg-surface-soft px-sm py-sm text-[16px] font-bold leading-7 text-ink shadow-sm transition-colors placeholder:text-muted focus:border-primary focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/25"
                  placeholder={copy.ideaPlaceholder}
                  value={ideaValue}
                  onChange={(event) => onIdeaValueChange(event.currentTarget.value)}
                  disabled={disabled}
                />
                {ideaError ? (
                  <p className="text-[12px] font-bold leading-5 text-error">
                    {ideaError}
                  </p>
                ) : null}
              </div>
            ) : null}

            {step === "idea" ? (
              <div className="mt-sm grid gap-2">
                <p className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-muted">
                  {copy.secondary}
                </p>
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="group flex min-h-12 w-full items-center justify-between gap-3 rounded-[8px] border border-hairline bg-surface px-sm py-xs text-left text-[14px] font-bold leading-5 text-ink transition-colors hover:border-outline hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-55"
                    onClick={() => onSelectExample(example)}
                    disabled={disabled}
                  >
                    <span className="min-w-0">{example}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <div
              className={[
                "mt-sm grid gap-2",
                step === "idea" ? "" : "sm:grid-cols-[minmax(0,1fr)_auto]",
              ].join(" ")}
            >
              <button
                type="button"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[8px] bg-surface-dark px-5 py-3 text-[15px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-55"
                onClick={handlePrimary}
                disabled={disabled}
              >
                {copy.primary}
              </button>
              {step !== "idea" ? (
                <button
                  type="button"
                  className="inline-flex min-h-12 items-center justify-center rounded-[8px] border border-hairline bg-canvas px-5 py-3 text-[15px] font-extrabold leading-5 text-body transition-colors hover:bg-surface-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-55"
                  onClick={handleSecondary}
                  disabled={disabled}
                >
                  {copy.secondary}
                </button>
              ) : null}
            </div>
          </div>
        </motion.section>
      </AnimatePresence>
    </div>
  );
}

function GuruLensContextHeader({
  lens,
  locale,
  compact = false,
}: {
  lens: GuruLensOption;
  locale: string;
  compact?: boolean;
}) {
  const isKo = locale === "ko";
  const description = isKo ? lens.descriptionKo : lens.descriptionEn;
  const detail = isKo ? lens.detailKo : lens.detailEn;
  const displayName = getGuruLensDisplayName(lens, locale);

  return (
    <div
      className={[
        "mx-auto w-full max-w-4xl border-b border-hairline pb-base",
        compact ? "mb-base" : "mb-lg",
      ].join(" ")}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border border-hairline bg-surface-soft text-primary">
          <span aria-hidden="true" className="material-symbols-outlined text-[22px]">
            {lens.icon}
          </span>
        </div>
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-primary">
            Guru lens
          </p>
          <h2 className="mt-1 text-[24px] font-black leading-8 text-ink sm:text-[32px] sm:leading-9">
            {displayName}
          </h2>
          <p className="mt-2 text-[15px] font-bold leading-6 text-body">
            {description}
          </p>
          <p className="mt-1 max-w-2xl text-[13px] font-semibold leading-6 text-muted">
            {detail}
          </p>
        </div>
      </div>
      {!compact ? (
        <Link
          href={locale === DEFAULT_LOCALE ? "/guru" : `/guru?locale=${locale}`}
          className="mt-sm inline-flex min-h-10 items-center gap-1 rounded-[8px] border border-hairline bg-canvas px-3 text-[13px] font-extrabold text-body transition-colors hover:border-outline hover:bg-surface-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[17px]">
            arrow_back
          </span>
          {isKo ? "다른 구루 선택" : "Choose another guru"}
        </Link>
      ) : null}
    </div>
  );
}

function ChatContent({ workspace = "chat" }: { workspace?: ChatWorkspace }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ticker = searchParams.get("ticker");
  const queryParam = searchParams.get("query");
  const shareToken = searchParams.get("shareToken");
  const templateId = searchParams.get("templateId");
  const draftMessageId = searchParams.get("draftMessageId");
  const localeParam = searchParams.get("locale");
  const runKindParam = searchParams.get("runKind");
  const guruParam = searchParams.get("guru");
  const isDiscoverRoute = pathname === "/discover";
  const isGuruRoute = pathname === "/guru";
  const isGuruWorkspace = workspace === "guru" || isGuruRoute;
  const templateTopic = templateId ? findQuestionTopic(templateId) : null;
  const existingSessionId = searchParams.get("sessionId");
  const responseLocale = isLocale(localeParam) ? localeParam : DEFAULT_LOCALE;
  const requestedRunKind = isGuruWorkspace
    ? "guru_advisor"
    : isDiscoverRoute
    ? "idea_generation"
    : runKindParam
      ? normalizeRunKind(runKindParam)
      : undefined;
  const isIdeaGeneration = requestedRunKind === "idea_generation";
  const isGuruAdvisor = requestedRunKind === "guru_advisor";

  const sessionId = existingSessionId;
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [shareStarter, setShareStarter] = useState<ShareStarter | null>(null);
  const [companyMetaByTicker, setCompanyMetaByTicker] = useState<
    Record<string, CompanyMeta>
  >({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerHostRef = useRef<HTMLDivElement>(null);
  const hasLoadedRef = useRef(false);
  const cancelledRef = useRef(false);
  const lastRefreshedRunIdRef = useRef<string | null>(null);
  const budgetAlertTrackedRef = useRef<string | null>(null);
  const prefilledQuestionTrackedRef = useRef<string | null>(null);
  const loadedShareTokenRef = useRef<string | null>(null);
  const startedDraftMessageIdsRef = useRef<Set<string>>(new Set());
  const prevMessagesCountRef = useRef(0);
  const { entitlement, refresh: refreshEntitlement } = useEntitlement();
  const [researchMode, setResearchMode] = useResearchModePreference(sessionId);
  const effectiveResearchMode: ResearchMode = isIdeaGeneration
    ? "deep"
    : researchMode;
  const [composerDraftResetKey, setComposerDraftResetKey] = useState(0);
  const [discoverGuideStep, setDiscoverGuideStep] =
    useState<DiscoverGuideStep>("url");
  const [discoverUrlDraft, setDiscoverUrlDraft] = useState("");
  const [discoverUrlError, setDiscoverUrlError] = useState<string | null>(null);
  const [discoverIdeaDraft, setDiscoverIdeaDraft] = useState("");
  const [discoverIdeaError, setDiscoverIdeaError] = useState<string | null>(null);
  const composerRef = useRef<ComposerHandle>(null);

  const isDraftRoute = pathname === "/chat/new" || isDiscoverRoute || isGuruRoute;
  const shareStarterTicker = normalizeTicker(shareStarter?.tickers[0] ?? "");
  const activeTicker = isGuruAdvisor
    ? null
    : normalizeTicker(ticker ?? "") ?? shareStarterTicker;
  const selectedGuruLensKey = normalizeGuruLensKey(guruParam) ?? "auto";
  const selectedGuruLens = getGuruLens(selectedGuruLensKey);
  const withGuruLensPrefix = useCallback(
    (message: string) =>
      `${getGuruLensPromptPrefix(selectedGuruLens, responseLocale)}\n${message.trim()}`,
    [responseLocale, selectedGuruLens],
  );

  // H-07: cleanup on unmount to prevent race condition
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (existingSessionId || !activeTicker) return;

    let stale = false;
    const tickerToValidate = activeTicker;

    async function validateTicker() {
      const normalizedTicker = tickerToValidate.trim().toUpperCase();
      try {
        const res = await fetch(
          `/api/companies?ticker=${encodeURIComponent(normalizedTicker)}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as CompaniesResponse;
        const isIndexed =
          res.ok &&
          data.companies?.some(
            (company) => company.ticker === normalizedTicker,
          );
        const matchedCompany = data.companies?.find(
          (company) => company.ticker === normalizedTicker,
        );

        if (matchedCompany && !stale && !cancelledRef.current) {
          setCompanyMetaByTicker((current) => ({
            ...current,
            [normalizedTicker]: {
              ticker: normalizedTicker,
              name:
                matchedCompany.name && matchedCompany.name !== normalizedTicker
                  ? matchedCompany.name
                  : null,
              sector: matchedCompany.sector ?? null,
            },
          }));
        }

        if (!isIndexed && !stale && !cancelledRef.current) {
          setSessionError(
            `현재 온톨로지 인덱스에 없는 회사입니다: ${normalizedTicker}`,
          );
        }
      } catch {
        if (!stale && !cancelledRef.current) {
          setSessionError("회사 인덱스를 확인하지 못했습니다.");
        }
      }
    }

    validateTicker();

    return () => {
      stale = true;
    };
  }, [activeTicker, existingSessionId]);

  const effectiveSessionError =
    existingSessionId || !activeTicker ? null : sessionError;

  const handleSessionCreated = useCallback(
    (createdSessionId: string) => {
      if (!isDraftRoute && existingSessionId) return;
      if (isGuruAdvisor) {
        router.replace(
          buildGuruSessionHref(
            createdSessionId,
            responseLocale,
            selectedGuruLens.key,
          ),
          { scroll: false },
        );
        return;
      }
      router.replace(
        buildChatSessionHref(createdSessionId, {
          locale: responseLocale,
          ticker: activeTicker,
        }),
        { scroll: false },
      );
    },
    [
      activeTicker,
      existingSessionId,
      isDraftRoute,
      isGuruAdvisor,
      responseLocale,
      router,
      selectedGuruLens.key,
    ],
  );

  const chat = useChat({
    sessionId: sessionId ?? "",
    scopeType: activeTicker ? "company" : "global",
    defaultTickers: activeTicker ? [activeTicker] : [],
    researchMode: effectiveResearchMode,
    runKind: requestedRunKind,
    responseLocale,
    onSessionCreated: handleSessionCreated,
  });
  const sendMessage = chat.sendMessage;
  const sendNewsEventSelection = chat.sendNewsEventSelection;
  const cancelRun = chat.cancelRun;
  const isQueued = chat.status === "queued" || chat.activity?.stage === "queued";
  const isRunning = chat.status === "running";
  const isActiveRun = isQueued || isRunning;

  // ---------------------------------------------------------------------------
  // Mobile dock state machine
  // ---------------------------------------------------------------------------

  const {
    isBodyScrollChat,
    mobileHeaderHidden,
    isComposerCompact,
    keyboardOffset,
    composerHeight,
    composerFocusRequestKey,
    shouldStickToBottomRef,
    getScrollSurface,
    getScrollViewportHeight,
    scrollToBottom,
    revealComposer,
    revealComposerForTyping,
    handleComposerPointerDown,
    handleComposerFocusChange,
    setComposerExpanded,
  } = useChatMobileDock({
    sessionKey: sessionId,
    scrollRef,
    composerHostRef,
    messageCount: chat.messages.length,
    isStreaming: isActiveRun,
  });

  // ---------------------------------------------------------------------------
  // Session hydration & lifecycle
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (chat.status !== "completed" && chat.status !== "failed") return;
    if (!chat.runId || lastRefreshedRunIdRef.current === chat.runId) return;

    lastRefreshedRunIdRef.current = chat.runId;
    void refreshEntitlement();
  }, [chat.runId, chat.status, refreshEntitlement]);

  // H-08: stable loadSession via ref-based guard
  const loadSessionRef = useRef(chat.loadSession);

  useEffect(() => {
    loadSessionRef.current = chat.loadSession;
  }, [chat.loadSession]);

  useEffect(() => {
    hasLoadedRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !draftMessageId) return;

    const draftMessage = readDraftMessage(draftMessageId);
    if (!draftMessage) return;
    if (startedDraftMessageIdsRef.current.has(draftMessageId)) return;

    hasLoadedRef.current = true;
    const timeoutId = window.setTimeout(() => {
      if (startedDraftMessageIdsRef.current.has(draftMessageId)) return;
      startedDraftMessageIdsRef.current.add(draftMessageId);
      void sendMessage(draftMessage.content, {
        requestId: draftMessage.requestId,
        runKind: draftMessage.runKind,
        userUrl: draftMessage.userUrl,
        userUrls: draftMessage.userUrls,
        attachmentIds: draftMessage.attachmentIds,
      }).finally(() => {
        if (cancelledRef.current) return;
        removeDraftMessage(draftMessageId);
        const cleanedSessionHref = isGuruAdvisor
          ? buildGuruSessionHref(sessionId, responseLocale, selectedGuruLens.key)
          : buildChatSessionHref(sessionId, {
              locale: responseLocale,
              ticker: activeTicker,
            });
        window.history.replaceState(
          window.history.state,
          "",
          cleanedSessionHref,
        );
      });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [
    activeTicker,
    draftMessageId,
    isGuruAdvisor,
    responseLocale,
    sendMessage,
    selectedGuruLens.key,
    sessionId,
  ]);

  useEffect(() => {
    if (!sessionId || hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    loadSessionRef.current();
  }, [sessionId]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const isHydratingSession = Boolean(sessionId && chat.isHydratingSession);
  const isBudgetBlocked = entitlement?.usage.can_run === false;
  const isCreditLimitError = isCreditLimitErrorMessage(chat.error);
  const shouldPreviewCreditLimitCard =
    ALWAYS_SHOW_CREDIT_LIMIT_CARD_IN_DEV && !chat.error;
  const shouldShowCreditLimitCard =
    isCreditLimitError || shouldPreviewCreditLimitCard;
  const shouldShowChatError = Boolean(chat.error) || shouldPreviewCreditLimitCard;
  const hasConversationContent =
    chat.messages.length > 0 ||
    Boolean(chat.streamingContent) ||
    isActiveRun ||
    Boolean(chat.error);
  const hasCompletedAssistantAnswer = chat.messages.some(
    (message) =>
      message.role === "assistant" &&
      message.status === "completed" &&
      message.content.trim().length > 0,
  );
  const shouldShowDiscoverGuide =
    isIdeaGeneration &&
    chat.messages.length === 0 &&
    !isHydratingSession &&
    !isActiveRun &&
    !effectiveSessionError;
  const shouldHideDiscoverComposer = shouldShowDiscoverGuide;
  const streamingTransition = {
    duration: 0.14,
    ease: [0.16, 1, 0.3, 1] as const,
    y: 4,
  };

  // ---------------------------------------------------------------------------
  // Auto-scroll to bottom
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!hasConversationContent) return;
    if (!shouldStickToBottomRef.current) return;
    if (!isActiveRun && chat.messages.length === prevMessagesCountRef.current) {
      return;
    }

    const frameId = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frameId);
  }, [
    chat.messages.length,
    chat.streamingContent,
    hasConversationContent,
    isActiveRun,
    scrollToBottom,
    shouldStickToBottomRef,
  ]);

  useEffect(() => {
    prevMessagesCountRef.current = chat.messages.length;
  }, [chat.messages.length]);

  // ---------------------------------------------------------------------------
  // Hash-based message scrolling
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!sessionId || chat.messages.length === 0) return;
    const hash = window.location.hash.slice(1);
    if (!hash.startsWith("message-")) return;

    const frameId = window.requestAnimationFrame(() => {
      const target = document.getElementById(hash);
      const surface = getScrollSurface();
      if (!target || !surface) return;

      const surfaceTop = isBodyScrollChat
        ? 0
        : surface.getBoundingClientRect().top;
      const targetTop =
        target.getBoundingClientRect().top - surfaceTop + surface.scrollTop;
      surface.scrollTop = Math.max(
        0,
        targetTop - getScrollViewportHeight(surface) / 2,
      );
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [
    chat.messages.length,
    getScrollSurface,
    getScrollViewportHeight,
    isBodyScrollChat,
    sessionId,
  ]);

  // ---------------------------------------------------------------------------
  // Context tickers & suggested prompts
  // ---------------------------------------------------------------------------

  const contextTickers = getSessionTickers(chat.session, activeTicker);
  const contextTickersKey = contextTickers.join(",");
  const contextCompanies = contextTickers.map((contextTicker) => {
    const normalizedTicker = contextTicker.trim().toUpperCase();
    return (
      companyMetaByTicker[normalizedTicker] ?? {
        ticker: normalizedTicker,
        name: null,
        sector: null,
      }
    );
  });
  const contextLabel = contextCompanies
    .map((company) =>
      company.name ? `${company.name} (${company.ticker})` : company.ticker,
    )
    .join(", ");
  const contextTickerText = contextCompanies
    .map((company) => company.ticker)
    .join(" / ");
  const contextDisplayText = contextCompanies
    .map((company) => {
      const copy = getCompanyDisplayCopyForTicker(responseLocale, company.ticker);
      return copy.companyNameKo || copy.name || company.name || company.ticker;
    })
    .join(" / ");
  const contextNameText = contextCompanies
    .map((company) => company.name)
    .filter((name): name is string => Boolean(name))
    .join(", ");
  const contextSectorText = Array.from(
    new Set(
      contextCompanies
        .map((company) => company.sector)
        .filter((sector): sector is string => Boolean(sector)),
    ),
  ).join(" / ");
  const headerActionTicker = contextTickers[0] ?? null;
  const primaryContextCompany = contextCompanies[0] ?? null;
  const guruSuggestedPrompts = getGuruSuggestedPrompts(
    selectedGuruLens,
    responseLocale,
  );
  const selectedGuruDisplayName = getGuruLensDisplayName(
    selectedGuruLens,
    responseLocale,
  );
  const suggestedPrompts = isGuruAdvisor
    ? guruSuggestedPrompts
    : getSuggestedPromptDisplaysForTickers(responseLocale, contextTickers);
  const emptyStateCopy = isIdeaGeneration
    ? responseLocale === "ko"
      ? {
          headingWithContext: "어떤 종목을 발굴할까요?",
          headingWithoutContext: "어떤 종목을 발굴할까요?",
          descriptionWithoutContext:
            "아이디어, 산업, 리스크, 재무 조건을 넣으면 관련 회사를 넓게 찾아봅니다.",
        }
      : {
          headingWithContext: "What stocks should we discover?",
          headingWithoutContext: "What stocks should we discover?",
          descriptionWithoutContext:
            "Enter an idea, industry, risk, or financial condition to explore related companies broadly.",
        }
    : isGuruAdvisor
      ? responseLocale === "ko"
        ? {
            headingWithContext: selectedGuruDisplayName,
            headingWithoutContext: selectedGuruDisplayName,
            descriptionWithoutContext:
              `${selectedGuruLens.descriptionKo} ${selectedGuruLens.detailKo}`,
          }
        : {
            headingWithContext: selectedGuruDisplayName,
            headingWithoutContext: selectedGuruDisplayName,
            descriptionWithoutContext:
              `${selectedGuruLens.descriptionEn} ${selectedGuruLens.detailEn}`,
          }
    : responseLocale === "ko"
        ? {
          headingWithContext: `${contextDisplayText}에서 무엇을 확인할까요?`,
          headingWithoutContext: "와이드 리서치",
          descriptionWithoutContext:
            "회사를 모를 때는 아이디어·산업·리스크 조건으로 연관 기업을 넓게 찾아봅니다.",
        }
      : {
          headingWithContext: `What should we check for ${contextDisplayText}?`,
          headingWithoutContext: "Wide research",
          descriptionWithoutContext:
            "When you do not know the company yet, use idea, industry, and risk conditions to expand the candidate set.",
        };
  const queryValue = queryParam?.trim() || null;
  const shareQuestionValue = shareStarter?.question_content.trim() || null;
  const templateQuestion =
    templateTopic &&
    activeTicker?.trim().toUpperCase() === templateTopic.questionChain.ticker
      ? templateTopic.questionChain.primaryQuestion
      : (templateTopic?.question ?? null);
  const initialComposerValue =
    queryValue ?? shareQuestionValue ?? templateQuestion ?? undefined;
  const prefillSource = queryValue
    ? "url_query"
    : shareQuestionValue
      ? "share_cta"
      : templateTopic
      ? "template_id"
      : null;
  const hasComposerPrefillParams = Boolean(
    queryParam || templateId || shareToken || shareStarter,
  );
  const serializedSearchParams = searchParams.toString();

  // ---------------------------------------------------------------------------
  // Session creation for drafts
  // ---------------------------------------------------------------------------

  const createSessionForDraft = useCallback(async (): Promise<string | null> => {
    const normalizedTicker = activeTicker?.trim().toUpperCase();
    const requestBody: CreateSessionRequest = {
      scope_type: normalizedTicker ? "company" : "global",
      default_tickers: normalizedTicker ? [normalizedTicker] : [],
      default_document_types: [],
    };

    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      setSessionError(
        errorData?.error?.message || "새 채팅을 만들지 못했습니다.",
      );
      return null;
    }

    const data = (await response.json()) as CreateSessionResponse;
    return data.session.id;
  }, [activeTicker, setSessionError]);

  const clearComposerPrefillParams = useCallback(() => {
    if (!hasComposerPrefillParams) return;

    const nextParams = new URLSearchParams(serializedSearchParams);
    nextParams.delete("query");
    nextParams.delete("templateId");
    nextParams.delete("shareToken");
    const nextQuery = nextParams.toString();
    const basePath = isGuruAdvisor
      ? "/guru"
      : isDiscoverRoute
      ? "/discover"
      : isDraftRoute
        ? "/chat/new"
        : "/chat";
    setShareStarter(null);
    router.replace(`${basePath}${nextQuery ? `?${nextQuery}` : ""}`, {
      scroll: false,
    });
  }, [
    hasComposerPrefillParams,
    isDiscoverRoute,
    isDraftRoute,
    isGuruAdvisor,
    router,
    serializedSearchParams,
  ]);

  useEffect(() => {
    const token = shareToken?.trim();
    if (!token) {
      loadedShareTokenRef.current = null;
      return;
    }

    if (loadedShareTokenRef.current === token) return;
    loadedShareTokenRef.current = token;
    const shareTokenValue = token;
    setShareStarter(null);

    let stale = false;

    async function loadShareStarter() {
      try {
        const response = await fetch(
          `/api/share/${encodeURIComponent(shareTokenValue)}/starter`,
          { cache: "no-store" },
        );
        const data = (await response.json().catch(() => null)) as
          | Partial<ShareStarter>
          | { error?: { message?: string } }
          | null;

        if (stale || cancelledRef.current) return;

        if (!response.ok || !data || !("question_content" in data)) {
          setSessionError("공유된 질문을 불러오지 못했습니다.");
          return;
        }

        const question = data.question_content?.trim();
        if (!question) {
          setSessionError("공유된 질문을 불러오지 못했습니다.");
          return;
        }

        setSessionError(null);
        setShareStarter({
          question_content: question,
          tickers: Array.isArray(data.tickers)
            ? data.tickers.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          title: typeof data.title === "string" ? data.title : null,
        });
      } catch {
        if (!stale && !cancelledRef.current) {
          setSessionError("공유된 질문을 불러오지 못했습니다.");
        }
      }
    }

    loadShareStarter();

    return () => {
      stale = true;
    };
  }, [shareToken]);

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const trimmedQuestion = initialComposerValue?.trim();
    if (!trimmedQuestion || !prefillSource) return;

    const eventKey = `${prefillSource}:${templateTopic?.slug ?? "custom"}:${trimmedQuestion}:${contextTickersKey || "global"}`;
    if (prefilledQuestionTrackedRef.current === eventKey) return;
    prefilledQuestionTrackedRef.current = eventKey;

    const analyticsTickers = contextTickersKey
      ? contextTickersKey.split(",").filter(Boolean)
      : [];

    trackClientEventSilently("question_prefilled", {
      source: prefillSource,
      template_id: templateTopic?.slug ?? null,
      ticker: analyticsTickers[0] ?? null,
      tickers: analyticsTickers,
      question_length: trimmedQuestion.length,
    });
  }, [contextTickersKey, initialComposerValue, prefillSource, templateTopic?.slug]);

  useEffect(() => {
    if (contextTickers.length === 0) return;

    let stale = false;
    const missingTickers = contextTickers
      .map((contextTicker) => contextTicker.trim().toUpperCase())
      .filter((contextTicker) => !companyMetaByTicker[contextTicker]);

    if (missingTickers.length === 0) return;

    async function loadCompanyMeta() {
      const entries = await Promise.all(
        missingTickers.map(async (missingTicker) => {
          try {
            const res = await fetch(
              `/api/companies?ticker=${encodeURIComponent(missingTicker)}`,
              { cache: "no-store" },
            );
            const data = (await res.json()) as CompaniesResponse;
            const company = data.companies?.find(
              (item) => item.ticker === missingTicker,
            );
            return [
              missingTicker,
              {
                ticker: missingTicker,
                name:
                  company?.name && company.name !== missingTicker
                    ? company.name
                    : null,
                sector: company?.sector ?? null,
              },
            ] as const;
          } catch {
            return [
              missingTicker,
              { ticker: missingTicker, name: null, sector: null },
            ] as const;
          }
        }),
      );

      if (stale || cancelledRef.current) return;
      setCompanyMetaByTicker((current) => ({
        ...current,
        ...Object.fromEntries(entries),
      }));
    }

    loadCompanyMeta();

    return () => {
      stale = true;
    };
  }, [companyMetaByTicker, contextTickers, contextTickersKey]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSend = useCallback(
    async (
      content: string,
      options?: ComposerSendOptions,
    ): Promise<ComposerSendResult> => {
      const trimmed = content.trim();
      if (!trimmed) {
        return {
          ok: false,
          message: "메시지를 입력해야 합니다.",
        };
      }

      shouldStickToBottomRef.current = true;
      setComposerExpanded({
        stickToBottom: true,
        resetManualScroll: true,
      });

      const outboundContent = isGuruAdvisor
        ? withGuruLensPrefix(trimmed)
        : trimmed;

      if (!sessionId) {
        const createdSessionId = await createSessionForDraft();

        if (!createdSessionId) {
          return {
            ok: false,
            message: "채팅 세션을 만들지 못했습니다.",
          };
        }

        const nextDraftMessageId = createClientId();
        const nextRequestId = createClientId();

        if (
          !storeDraftMessage(nextDraftMessageId, {
            content: outboundContent,
            requestId: nextRequestId,
            ...(isIdeaGeneration ? { runKind: "idea_generation" } : {}),
            ...(isGuruAdvisor ? { runKind: "guru_advisor" } : {}),
            userUrl: options?.userUrl,
            userUrls: options?.userUrls,
            attachmentIds: options?.attachmentIds,
          })
        ) {
          setSessionError("새 채팅 메시지를 준비하지 못했습니다.");
          return {
            ok: false,
            message: "새 채팅 메시지를 준비하지 못했습니다.",
          };
        }

        setComposerDraftResetKey((value) => value + 1);
        setShareStarter(null);

        const nextParams = new URLSearchParams({
          sessionId: createdSessionId,
          draftMessageId: nextDraftMessageId,
        });
        if (activeTicker) {
          nextParams.set("ticker", activeTicker);
        }
        if (isGuruAdvisor && selectedGuruLens.key !== "auto") {
          nextParams.set("guru", selectedGuruLens.key);
        }
        if (responseLocale !== DEFAULT_LOCALE) {
          nextParams.set("locale", responseLocale);
        }
        const nextHref = isGuruAdvisor
          ? `/guru?${nextParams.toString()}`
          : `/chat?${nextParams.toString()}`;
        router.replace(nextHref, {
          scroll: false,
        });
        return { ok: true };
      }

      clearComposerPrefillParams();
      try {
        const result = await sendMessage(outboundContent, {
          runKind: isGuruAdvisor ? "guru_advisor" : undefined,
          userUrl: options?.userUrl,
          userUrls: options?.userUrls,
          attachmentIds: options?.attachmentIds,
        });
        if (result.ok) return { ok: true };
        return { ok: false, message: result.message };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "메시지를 보내지 못했습니다. 다시 시도해주세요.",
        };
      }
    },
    [
      activeTicker,
      clearComposerPrefillParams,
      createSessionForDraft,
      router,
      sendMessage,
      sessionId,
      responseLocale,
      isGuruAdvisor,
      isIdeaGeneration,
      selectedGuruLens.key,
      setComposerExpanded,
      setSessionError,
      shouldStickToBottomRef,
      withGuruLensPrefix,
    ],
  );

  async function handlePromptSend(prompt: string) {
    setComposerDraftResetKey((current) => current + 1);
    await handleSend(prompt);
  }

  const requestComposerAction = useCallback(
    (type: Parameters<ComposerHandle["requestAction"]>[0]) => {
      composerRef.current?.requestAction(type);
    },
    [],
  );

  const handleDiscoverCommitUrl = useCallback(() => {
    const normalizedUrl = normalizeDiscoverUrl(discoverUrlDraft);
    if (!normalizedUrl) {
      setDiscoverUrlError(
        responseLocale === "ko"
          ? "확인할 URL을 입력하거나 건너뛰기를 눌러주세요."
          : "Enter a URL to continue, or skip this step.",
      );
      return;
    }

    const committed = composerRef.current?.commitUserUrls([normalizedUrl]);
    if (!committed) {
      setDiscoverUrlError(
        responseLocale === "ko"
          ? "http 또는 https URL만 입력할 수 있습니다."
          : "Only http or https URLs can be attached.",
      );
      return;
    }

    setDiscoverUrlDraft(normalizedUrl);
    setDiscoverUrlError(null);
    setDiscoverGuideStep("file");
  }, [discoverUrlDraft, responseLocale]);

  const handleDiscoverSkipUrl = useCallback(() => {
    setDiscoverUrlError(null);
    setDiscoverGuideStep("file");
  }, []);

  const handleDiscoverAddFile = useCallback(() => {
    requestComposerAction("file");
  }, [requestComposerAction]);

  const handleDiscoverSkipFile = useCallback(() => {
    setDiscoverGuideStep("idea");
  }, []);

  const handleDiscoverSubmitIdea = useCallback(() => {
    const trimmedIdea = discoverIdeaDraft.trim();
    if (!trimmedIdea) {
      setDiscoverIdeaError(
        responseLocale === "ko"
          ? "발굴할 아이디어나 산업, 리스크 키워드를 입력해주세요."
          : "Enter an idea, industry, or risk keyword to start discovery.",
      );
      return;
    }

    setDiscoverIdeaError(null);
    composerRef.current?.submitWithValue(trimmedIdea);
  }, [discoverIdeaDraft, responseLocale]);

  const handleDiscoverUserUrlsChange = useCallback((hasUserUrls: boolean) => {
    if (hasUserUrls) {
      setDiscoverUrlError(null);
      setDiscoverGuideStep((current) => (current === "url" ? "file" : current));
    }
  }, []);

  const handleDiscoverAttachmentsChange = useCallback(
    (hasAttachments: boolean) => {
      if (hasAttachments) {
        setDiscoverGuideStep((current) =>
          current === "file" ? "idea" : current,
        );
      }
    },
    [],
  );

  const handleCancel = useCallback(async () => {
    await cancelRun();
  }, [cancelRun]);

  const handleNewsEventSelection = useCallback(
    async (params: { artifactId: string; eventId: string }) => {
      await sendNewsEventSelection(params);
    },
    [sendNewsEventSelection],
  );

  // Escape key to cancel streaming
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isActiveRun) {
        handleCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleCancel, isActiveRun]);

  useEffect(() => {
    const alertLevel = entitlement?.usage.alert_level;
    if (!alertLevel || alertLevel === "ok") return;

    const eventKey = `${entitlement.plan.key}:${entitlement.usage.period_start}:${alertLevel}:${entitlement.usage.budget_used_usd}:${entitlement.usage.budget_reserved_usd}`;
    if (budgetAlertTrackedRef.current === eventKey) return;
    budgetAlertTrackedRef.current = eventKey;

    trackClientEventSilently(
      alertLevel === "blocked" ? "usage_limit_reached" : "usage_warning_shown",
      {
        plan: entitlement.plan.key,
        budget_used_usd: entitlement.usage.budget_used_usd,
        budget_reserved_usd: entitlement.usage.budget_reserved_usd,
        budget_limit_usd: entitlement.usage.budget_limit_usd,
        percent_used: entitlement.usage.percent_used,
      },
    );
  }, [entitlement]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const mobileComposerSpacerHeight = isBodyScrollChat
    ? shouldHideDiscoverComposer
      ? 0
      : isComposerCompact
        ? 88 + keyboardOffset
        : composerHeight + keyboardOffset + 28
    : undefined;

  return (
    <div className="min-h-[100dvh] bg-canvas pt-[72px] md:flex md:h-full md:min-h-0 md:flex-col md:overflow-hidden md:pt-0">
      {/* Top Nav */}
      <TopNav
        brandHref="/companies"
        brandAriaLabel="회사 목록으로 이동"
        hideAccountMenu
        showSidebarTrigger
        mobileOverlay
        mobileCollapsed={mobileHeaderHidden}
        actionSlot={
          headerActionTicker ? (
            <ChatWatchlistHeaderActions
              ticker={headerActionTicker}
              showNotebookOnboarding={
                ALWAYS_SHOW_NOTEBOOK_ONBOARDING_IN_DEV ||
                hasCompletedAssistantAnswer
              }
            />
          ) : null
        }
      />

      {/* Main Workspace */}
      <main id="main-content" className="mx-auto w-full max-w-[1280px] md:flex md:min-h-0 md:flex-1 md:overflow-hidden">
        {/* Chat Canvas */}
        <div className="relative min-w-0 bg-canvas md:flex md:flex-1 md:flex-col">
          {/* Chat History */}
          <div
            ref={scrollRef}
            className="px-base sm:px-xl md:flex-1 md:overflow-y-auto"
            aria-label="채팅 메시지"
            aria-relevant="additions text"
            role="log"
          >
            {/* Spacer */}
            <div className="h-xl sm:h-[96px] md:hidden" />

            {/* Company research context */}
            {contextTickers.length > 0 && (
              <div className="mx-auto mb-base w-full max-w-3xl">
                <div
                  data-onboarding-target="chat-context"
                  className="flex max-w-full items-center gap-3 sm:gap-4"
                  aria-label={`분석 대상: ${contextLabel}`}
                >
                  {primaryContextCompany ? (
                    <CompanyLogo
                      ticker={primaryContextCompany.ticker}
                      companyName={
                        contextDisplayText || primaryContextCompany.name || primaryContextCompany.ticker
                      }
                      imageSize={112}
                      className="h-12 w-12 text-[12px] sm:h-14 sm:w-14"
                    />
                  ) : null}
                  <div className="min-w-0">
                    <p className="font-mono text-[14px] font-black leading-5 tracking-[0.08em] text-primary sm:text-[15px]">
                      {contextTickerText}
                    </p>
                    <p className="mt-0.5 truncate text-[12px] font-bold leading-5 text-muted sm:text-[13px]">
                      {[contextNameText || "기업 리서치", contextSectorText]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {isGuruAdvisor &&
            selectedGuruLens.key !== "auto" &&
            (hasConversationContent || isHydratingSession) && (
              <GuruLensContextHeader
                lens={selectedGuruLens}
                locale={responseLocale}
                compact
              />
            )}

            {/* L-09: Loading skeleton for session */}
            {/* H-06: Session creation error */}
            {effectiveSessionError && (
              <div className="mx-auto max-w-3xl">
                <div
                  className="rounded-[8px] border border-error/20 bg-error-container/10 p-base text-[15px] leading-[1.5] text-error sm:p-lg sm:text-[16px]"
                  role="alert"
                >
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined mr-xs text-[18px] align-middle"
                  >
                    error
                  </span>
                  {effectiveSessionError}
                </div>
              </div>
            )}

            {isHydratingSession && (
              <div
                className="mx-auto w-full max-w-4xl space-y-lg"
                aria-label="채팅 불러오는 중"
                role="status"
              >
                <div className="flex justify-end">
                  <div className="h-[72px] w-[72%] animate-pulse rounded-[8px] bg-surface-strong" />
                </div>
                <div className="space-y-sm pl-0 sm:pl-[48px]">
                  <div className="h-5 w-36 animate-pulse rounded-full bg-surface-strong" />
                  <div className="h-4 w-full animate-pulse rounded-full bg-surface-strong" />
                  <div className="h-4 w-[88%] animate-pulse rounded-full bg-surface-strong" />
                  <div className="h-4 w-[64%] animate-pulse rounded-full bg-surface-strong" />
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="mx-auto w-full min-w-0 max-w-4xl space-y-lg sm:space-y-xl">
              {chat.messages
                .filter((msg): msg is typeof msg & { role: "user" | "assistant" } =>
                  msg.role === "user" || msg.role === "assistant"
                )
                .map((msg, idx, arr) => {
                  const isLatestAssistantMessage =
                    msg.role === "assistant" &&
                    idx === arr.length - 1 &&
                    chat.status === "completed";

                  return (
                    <ChatMessage
                      key={msg.id}
                      role={msg.role}
                      content={msg.content}
                      metadata={msg.metadata}
                      status={msg.status}
                      messageId={msg.role === "assistant" ? msg.id : undefined}
                      createdAt={
                        msg.role === "assistant" ? msg.created_at : undefined
                      }
                      citations={
                        isLatestAssistantMessage ? chat.citations : undefined
                      }
                      artifacts={
                        msg.role === "assistant"
                          ? chat.artifactsByMessageId[msg.id]
                          : undefined
                      }
                      charts={
                        msg.role === "assistant"
                          ? chat.chartsByMessageId[msg.id]
                          : undefined
                      }
                      artifactSelections={chat.artifactSelections}
                      onSelectNewsEvent={handleNewsEventSelection}
                      onFollowUpQuestionSelect={(question) => {
                        void handlePromptSend(question);
                      }}
                      followUpQuestionDisabled={isActiveRun || isBudgetBlocked}
                      newsEventSelectionDisabled={isActiveRun || isBudgetBlocked}
                      showHeader={idx === 0 || arr[idx - 1]?.role !== "assistant"}
                      toolCalls={
                        isLatestAssistantMessage ? chat.toolCalls : undefined
                      }
                      workDurationMs={
                        isLatestAssistantMessage && msg.role === "assistant"
                          ? chat.runDurationsByMessageId[msg.id]
                          : null
                      }
                    />
                  );
                })}

              <AnimatePresence mode="wait" initial={false}>
                {isActiveRun && chat.streamingContent && (
                  <motion.div
                    key="streaming-content"
                    initial={{ opacity: 0, y: streamingTransition.y }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -streamingTransition.y }}
                    transition={{
                      duration: streamingTransition.duration,
                      ease: streamingTransition.ease,
                    }}
                  >
                    <ChatMessage
                      role="assistant"
                      content={chat.streamingContent}
                      isStreaming={true}
                      activity={chat.activity}
                      citations={chat.citations}
                      runStartedAt={chat.runStartedAt}
                      showHeader={
                        chat.messages.length === 0 ||
                        chat.messages[chat.messages.length - 1]?.role !== "assistant"
                      }
                      toolCalls={chat.toolCalls}
                    />
                  </motion.div>
                )}
                {isActiveRun && !chat.streamingContent && (
                  <motion.div
                    key="streaming-loading"
                    initial={{ opacity: 0, y: streamingTransition.y }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -streamingTransition.y }}
                    transition={{
                      duration: streamingTransition.duration,
                      ease: streamingTransition.ease,
                    }}
                  >
                    <ChatMessage
                      role="assistant"
                      content=""
                      isStreaming={true}
                      activity={chat.activity}
                      citations={chat.citations}
                      runStartedAt={chat.runStartedAt}
                      showHeader={
                        chat.messages.length === 0 ||
                        chat.messages[chat.messages.length - 1]?.role !== "assistant"
                      }
                      toolCalls={chat.toolCalls}
                    />
                  </motion.div>
                )}
                {shouldShowChatError && (
                  <motion.div
                    className="w-full"
                    key={
                      shouldPreviewCreditLimitCard
                        ? "credit-limit-preview"
                        : "chat-error"
                    }
                    initial={{ opacity: 0, y: streamingTransition.y }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -streamingTransition.y }}
                    transition={{
                      duration: streamingTransition.duration,
                      ease: streamingTransition.ease,
                    }}
                  >
                    <div className="flex w-full flex-col">
                      <div className="pl-0 sm:pl-[48px]">
                        {shouldShowCreditLimitCard ? (
                          <CreditLimitErrorCard entitlement={entitlement} />
                        ) : (
                          <div
                            className="rounded-[8px] border border-error/20 bg-error-container/10 p-base text-[15px] leading-[1.5] text-error sm:p-lg sm:text-[16px]"
                            role="alert"
                          >
                            <span
                              aria-hidden="true"
                              className="material-symbols-outlined mr-xs text-[18px] align-middle"
                            >
                              error
                            </span>
                            {sanitizeError(chat.error ?? "")}
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Empty state */}
              {chat.messages.length === 0 &&
                !isHydratingSession &&
                !isActiveRun &&
                !sessionError && (
                  <div
                    className={[
                      "mx-auto flex w-full flex-col items-center text-center",
                      shouldShowDiscoverGuide
                        ? "min-h-[calc(100dvh-112px)] max-w-[42rem] justify-start pb-lg pt-md sm:pt-lg md:min-h-[calc(100dvh-96px)]"
                        : "min-h-[46dvh] max-w-2xl justify-center py-lg sm:py-xxl md:min-h-[56dvh]",
                    ].join(" ")}
                  >
                    <motion.div
                      className="w-full min-w-0"
                      data-onboarding-target="chat-empty-heading"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.24, ease: "easeOut" }}
                    >
                      <h2 className="text-balance text-[26px] font-black leading-[1.12] text-ink sm:text-[36px]">
                        {contextTickers.length > 0
                          ? emptyStateCopy.headingWithContext
                          : emptyStateCopy.headingWithoutContext}
                      </h2>
                      {contextTickers.length === 0 ? (
                        <p className="mx-auto mt-3 max-w-[34rem] text-balance text-[15px] font-semibold leading-6 text-body sm:text-[16px]">
                          {emptyStateCopy.descriptionWithoutContext}
                        </p>
                      ) : null}
                    </motion.div>

                    <motion.div
                      className={[
                        "w-full max-w-[38rem] text-left",
                        shouldShowDiscoverGuide ? "mt-4" : "mt-6",
                      ].join(" ")}
                      data-onboarding-target="chat-suggested-prompts"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.24,
                        delay: 0.06,
                        ease: "easeOut",
                      }}
                    >
                      {isIdeaGeneration ? (
                        shouldShowDiscoverGuide ? (
                          <DiscoverGuideFlow
                            locale={responseLocale}
                            step={discoverGuideStep}
                            disabled={
                              isBudgetBlocked || Boolean(effectiveSessionError)
                            }
                            urlValue={discoverUrlDraft}
                            urlError={discoverUrlError}
                            ideaValue={discoverIdeaDraft}
                            ideaError={discoverIdeaError}
                            onUrlValueChange={(value) => {
                              setDiscoverUrlDraft(value);
                              setDiscoverUrlError(null);
                            }}
                            onCommitUrl={handleDiscoverCommitUrl}
                            onSkipUrl={handleDiscoverSkipUrl}
                            onAddFile={handleDiscoverAddFile}
                            onSkipFile={handleDiscoverSkipFile}
                            onIdeaValueChange={(value) => {
                              setDiscoverIdeaDraft(value);
                              setDiscoverIdeaError(null);
                            }}
                            onSubmitIdea={handleDiscoverSubmitIdea}
                            onSelectExample={(prompt) => {
                              setDiscoverIdeaDraft(prompt);
                              setDiscoverIdeaError(null);
                            }}
                          />
                        ) : null
                      ) : (
                        <div className="grid gap-4">
                          <SuggestedPromptActions
                            prompts={suggestedPrompts}
                            groupId={
                              isGuruAdvisor
                                ? "guru-empty-state-prompts"
                                : "empty-state-prompts"
                            }
                            disabled={isActiveRun || Boolean(effectiveSessionError)}
                            analytics={{
                              sourceSurface: isGuruAdvisor
                                ? "guru_empty_state"
                                : "chat_empty_state",
                              ticker: contextTickers[0] ?? null,
                              tickers: contextTickers,
                              promptCategory: isGuruAdvisor
                                ? selectedGuruLens.key
                                : "starter",
                              promptIds: suggestedPrompts.map(
                                (_, index) =>
                                  isGuruAdvisor
                                    ? `guru_${selectedGuruLens.key}_${index + 1}`
                                    : `chat_empty_starter_${index + 1}`,
                              ),
                            }}
                            onSelect={(prompt) => {
                              void handlePromptSend(prompt);
                            }}
                          />
                        </div>
                      )}
                    </motion.div>
                  </div>
              )}

              {/* Spacer for fixed composer overlay — dynamically measured */}
              <div
                className="md:hidden"
                style={{ height: mobileComposerSpacerHeight }}
                aria-hidden="true"
              />
              <div className="hidden h-xl md:block" aria-hidden="true" />
            </div>
          </div>

          {isBudgetBlocked && entitlement && !shouldShowCreditLimitCard && (
            <div className="border-t border-hairline bg-canvas px-base py-sm sm:px-lg">
              <div className="mx-auto max-w-4xl rounded-[8px] border border-error/20 bg-error-container/10 px-base py-sm text-[13px] font-semibold leading-5 text-error">
                <span
                  aria-hidden="true"
                  className="material-symbols-outlined mr-xs text-[18px] align-middle"
                >
                  lock
                </span>
                {entitlement.upgrade.title} {entitlement.upgrade.message}
              </div>
            </div>
          )}

          {isActiveRun && (
            <div className="hidden md:block">
              <RunStatusDock
                onCancel={handleCancel}
                activity={chat.activity}
                toolCalls={chat.toolCalls}
                runStartedAt={chat.runStartedAt}
                variant={isQueued ? "queued" : "running"}
              />
            </div>
          )}

          {/* Full composer (expanded / focused) */}
          <div
            ref={composerHostRef}
            data-onboarding-target="chat-composer"
            className={[
              "pointer-events-none fixed inset-x-0 bottom-0 z-30 transform-gpu pb-[calc(env(safe-area-inset-bottom)+10px)] transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform md:pointer-events-auto md:static md:z-auto md:translate-y-0 md:pb-0 md:opacity-100 md:transition-none",
              isComposerCompact || shouldHideDiscoverComposer
                ? "opacity-0"
                : "opacity-100",
              isActiveRun ? "md:hidden" : "",
            ].join(" ")}
            style={{
              transform: isBodyScrollChat
                ? isComposerCompact || shouldHideDiscoverComposer
                  ? `translate3d(0, calc(100% + 24px), 0)`
                  : `translate3d(0, -${keyboardOffset}px, 0)`
                : "translate3d(0, 0, 0)",
            }}
            aria-hidden={
              isComposerCompact || shouldHideDiscoverComposer ? true : undefined
            }
            inert={
              isComposerCompact || shouldHideDiscoverComposer ? true : undefined
            }
            onPointerDownCapture={handleComposerPointerDown}
          >
            <Composer
              ref={composerRef}
              onSend={handleSend}
              onCancel={handleCancel}
              activity={chat.activity}
              disabled={Boolean(effectiveSessionError) || isBudgetBlocked}
              isGenerating={isActiveRun}
              placeholder={
                effectiveSessionError
                  ? "인덱스에 있는 회사만 채팅할 수 있습니다."
                  : isBudgetBlocked
                  ? "주간 분석 한도에 도달했습니다."
                  : isIdeaGeneration
                  ? responseLocale === "ko"
                    ? "예: 백로그 증가가 매출로 연결될 기업"
                    : "e.g. Companies converting backlog growth into revenue"
                  : isGuruAdvisor
                  ? responseLocale === "ko"
                    ? "구루 렌즈로 투자 질문을 입력하세요..."
                    : "Ask through a guru lens..."
                  : "기업에 대해 질문하세요..."
              }
              toolCalls={chat.toolCalls}
              initialValue={initialComposerValue}
              draftResetKey={composerDraftResetKey}
              runStartedAt={chat.runStartedAt}
              researchMode={effectiveResearchMode}
              onResearchModeChange={setResearchMode}
              urlModeAvailable={
                !isGuruAdvisor && (isIdeaGeneration || contextTickers.length > 0)
              }
              fileModeAvailable={!isGuruAdvisor}
              urlOnlyFallbackMessage={
                isIdeaGeneration
                  ? "이 URL을 바탕으로 관련 종목을 발굴해줘."
                  : undefined
              }
              attachmentCoachmarkEnabled={!isIdeaGeneration && !isGuruAdvisor}
              onUserUrlsChange={
                isIdeaGeneration ? handleDiscoverUserUrlsChange : undefined
              }
              onAttachmentsChange={
                isIdeaGeneration ? handleDiscoverAttachmentsChange : undefined
              }
              inputSurfaceVisible={!shouldHideDiscoverComposer}
              focusRequestKey={composerFocusRequestKey}
              onFocusChange={handleComposerFocusChange}
            />
          </div>

          {/* Compact pill — shown when full composer slides away */}
          <AnimatePresence>
            {isComposerCompact && !shouldHideDiscoverComposer && (
              <motion.div
                key="compact-composer-pill"
                className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-base pb-[calc(env(safe-area-inset-bottom)+10px)] md:hidden"
                style={{
                  transform: `translate3d(0, -${keyboardOffset}px, 0)`,
                }}
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                transition={{
                  duration: 0.18,
                  ease: [0.16, 1, 0.3, 1],
                }}
              >
                <div className="pointer-events-auto flex items-center gap-1 rounded-[14px] border border-hairline bg-canvas p-1.5 shadow-sm">
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-2 rounded-[10px] px-3 text-[13px] font-bold text-ink active:bg-surface-dim"
                    onClick={isActiveRun ? revealComposer : revealComposerForTyping}
                    aria-label={isActiveRun ? "분석 상태 보기" : "질문 입력"}
                  >
                    {isQueued ? (
                      <QueueRemotionAnimation size="compact" />
                    ) : (
                      <span
                        aria-hidden="true"
                        className={[
                          "material-symbols-outlined text-[19px]",
                          isRunning ? "animate-spin" : "",
                        ].join(" ")}
                      >
                        {isRunning ? "progress_activity" : "edit"}
                      </span>
                    )}
                    <span>
                      {isQueued ? "대기 중" : isRunning ? "분석 진행중" : "질문 입력"}
                    </span>
                  </button>

                  {isActiveRun && (
                    <button
                      type="button"
                      className="inline-flex h-9 items-center rounded-[10px] border border-hairline bg-surface px-3 text-[12px] font-bold text-error active:scale-95"
                      onClick={handleCancel}
                      aria-label="응답 생성 중지"
                    >
                      중지
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function ChatWatchlistHeaderActions({
  ticker,
  showNotebookOnboarding,
}: {
  ticker: string;
  showNotebookOnboarding: boolean;
}) {
  const normalizedTicker = normalizeTicker(ticker);
  const [mark, setMark] = useState<UserCompanyMark | null>(null);
  const [notebookUsage, setNotebookUsage] = useState<{
    ticker: string;
    hasBeenUsed: boolean;
  } | null>(null);
  const [pendingAction, setPendingAction] = useState<"watchlist" | "holding" | null>(
    null,
  );

  useEffect(() => {
    if (!normalizedTicker) return;

    let stale = false;
    const tickerForRequest = normalizedTicker;
    async function loadMark() {
      try {
        const response = await fetch(
          `/api/watchlist/${encodeURIComponent(tickerForRequest)}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const payload = (await response.json()) as {
          company?: { mark?: UserCompanyMark };
        };
        if (!stale) setMark(payload.company?.mark ?? null);
      } catch {
        if (!stale) setMark(null);
      }
    }

    void loadMark();
    return () => {
      stale = true;
    };
  }, [normalizedTicker]);

  useEffect(() => {
    if (
      !normalizedTicker ||
      !showNotebookOnboarding ||
      ALWAYS_SHOW_NOTEBOOK_ONBOARDING_IN_DEV
    ) {
      return;
    }

    let stale = false;
    const tickerForRequest = normalizedTicker;

    async function loadNotebookUsage() {
      try {
        const response = await fetch(
          `/api/watchlist/${encodeURIComponent(tickerForRequest)}/notebook`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const payload = (await response.json()) as {
          notebook?: UserCompanyNotebook;
        };
        if (!stale) {
          setNotebookUsage({
            ticker: tickerForRequest,
            hasBeenUsed: Boolean(payload.notebook?.updated_at),
          });
        }
      } catch {
        if (!stale) {
          setNotebookUsage({
            ticker: tickerForRequest,
            hasBeenUsed: false,
          });
        }
      }
    }

    void loadNotebookUsage();
    return () => {
      stale = true;
    };
  }, [normalizedTicker, showNotebookOnboarding]);

  if (!normalizedTicker) return null;

  async function saveMark(action: "watchlist" | "holding") {
    if (!normalizedTicker || pendingAction) return;

    setPendingAction(action);
    try {
      const response = await fetch(
        `/api/watchlist/${encodeURIComponent(normalizedTicker)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "holding"
              ? { is_watchlisted: true, is_holding: true }
              : { is_watchlisted: true },
          ),
        },
      );
      if (!response.ok) throw new Error("Failed to save watchlist mark");
      const payload = (await response.json()) as { mark?: UserCompanyMark };
      if (payload.mark) setMark(payload.mark);
    } finally {
      setPendingAction(null);
    }
  }

  const notebookHasBeenUsed =
    notebookUsage?.ticker === normalizedTicker ? notebookUsage.hasBeenUsed : null;
  const shouldShowNotebookHint =
    showNotebookOnboarding &&
    (ALWAYS_SHOW_NOTEBOOK_ONBOARDING_IN_DEV || notebookHasBeenUsed === false);
  const hasSavedMark = Boolean(mark?.is_watchlisted || mark?.is_holding);

  return (
    <div
      className="relative flex items-center gap-1"
      data-onboarding-target="chat-notebook-actions"
    >
      <ChatHeaderMarkButton
        active={Boolean(mark?.is_watchlisted)}
        disabled={pendingAction !== null}
        icon="bookmark"
        label={pendingAction === "watchlist" ? "저장" : "관심"}
        onClick={() => void saveMark("watchlist")}
      />
      <ChatHeaderMarkButton
        active={Boolean(mark?.is_holding)}
        disabled={pendingAction !== null}
        icon="inventory_2"
        label={pendingAction === "holding" ? "저장" : "보유"}
        onClick={() => void saveMark("holding")}
      />
      {shouldShowNotebookHint ? (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-30 inline-flex max-w-[calc(100vw-32px)] items-center rounded-[8px] border border-primary/25 bg-canvas px-3 py-2 text-left shadow-[0_12px_28px_rgba(15,23,42,0.16)]"
          role="status"
        >
          <span
            aria-hidden="true"
            className="absolute right-9 top-[-5px] h-2.5 w-2.5 rotate-45 border-l border-t border-primary/25 bg-canvas"
          />
          <p className="min-w-0 whitespace-nowrap text-[12px] font-extrabold leading-5 text-ink">
            {hasSavedMark
              ? "이 리서치를 노트북에 남기세요"
              : "저장하고 노트북에서 이어가세요"}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ChatHeaderMarkButton({
  active,
  disabled,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={[
        "inline-flex h-9 items-center justify-center gap-1 rounded-[8px] border px-2 text-[12px] font-extrabold leading-4 transition-colors disabled:cursor-not-allowed disabled:opacity-55 sm:h-10 sm:px-3 sm:text-[13px]",
        active
          ? "border-primary bg-primary-fixed text-on-primary-fixed"
          : "border-hairline bg-canvas text-ink hover:border-primary hover:text-primary",
      ].join(" ")}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[17px]">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

export default function ChatPage({
  workspace = "chat",
}: {
  workspace?: ChatWorkspace;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex h-[100dvh] items-center justify-center bg-canvas">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <ChatContent workspace={workspace} />
    </Suspense>
  );
}
