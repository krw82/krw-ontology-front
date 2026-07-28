"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import ResearchMarkdown from "@/components/ResearchMarkdown";
import CoverageMemoryPanel from "@/components/watchlist/CoverageMemoryPanel";
import { PWA_BEFORE_UPDATE_EVENT } from "@/components/pwa/lifecycle";
import { buildChatSessionHref } from "@/lib/chat/history-state";
import {
  buildComposerDraftKey,
  clearComposerDraft,
  loadComposerDraft,
  saveComposerDraft,
} from "@/lib/chat/composer-draft-store";
import type {
  SessionSummary,
  UserCompanyCoverageLevel,
  UserCompanyMark,
  UserCompanyNotebook,
  UserCompanyNotebookRefreshJob,
  WatchlistCompanyDetailResponse,
  WatchlistCompanySummary,
} from "@/types/api-contracts";

interface WatchlistWorkspaceClientProps {
  detail: WatchlistCompanyDetailResponse;
}

type ApiPayload = Record<string, unknown> | null;
type CoverageLevel = UserCompanyCoverageLevel;

const NOTEBOOK_MAX_LENGTH = 100_000;
const NOTEBOOK_REFRESH_POLL_MS = 1_500;

export default function WatchlistWorkspaceClient({
  detail,
}: WatchlistWorkspaceClientProps) {
  const [company, setCompany] = useState(detail.company);
  const [notebook, setNotebook] = useState<UserCompanyNotebook>(detail.notebook);
  const [draft, setDraft] = useState(detail.notebook.content_md);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshingNotebook, setIsRefreshingNotebook] = useState(false);
  const [refreshJobId, setRefreshJobId] = useState<string | null>(null);
  const [notebookRefreshSettled, setNotebookRefreshSettled] = useState(false);
  const [isPending, startTransition] = useTransition();

  const ticker = company.ticker;
  const notebookDraftKey = useMemo(
    () => buildComposerDraftKey({
      ownerId: detail.company.mark.user_id,
      workspace: "company-notebook",
      ticker,
    }),
    [detail.company.mark.user_id, ticker],
  );
  const notebookTitle = notebook.title || `${ticker} 리서치 노트북`;
  const companyTitle = company.companyNameKo ?? company.name;
  const showTickerInTitle = companyTitle.trim().toUpperCase() !== ticker;
  const activeContent = isEditing ? draft : notebook.content_md;
  const hasChanges = draft !== notebook.content_md;
  const isBusy = isPending || isRefreshingNotebook;
  const shouldPreventPwaUpdate =
    hasChanges || isPending || isRefreshingNotebook || Boolean(refreshJobId);
  const previewContent = activeContent.trim()
    ? activeContent
    : buildEmptyNotebookContent();
  const displayContent = stripNotebookTitle(previewContent, ticker);
  const recentSessions = useMemo(
    () => detail.recent_sessions.slice(0, 6),
    [detail.recent_sessions],
  );

  useEffect(() => {
    let cancelled = false;
    void loadComposerDraft(notebookDraftKey).then((savedDraft) => {
      if (cancelled) return;
      if (savedDraft?.text && savedDraft.text !== notebook.content_md) {
        setDraft(savedDraft.text);
        setIsEditing(true);
      }
      setDraftHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [notebook.content_md, notebookDraftKey]);

  useEffect(() => {
    if (!draftHydrated) return;
    const timeoutId = window.setTimeout(() => {
      if (draft === notebook.content_md) {
        void clearComposerDraft(notebookDraftKey);
        return;
      }
      void saveComposerDraft({ key: notebookDraftKey, text: draft, urls: [] });
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [draft, draftHydrated, notebook.content_md, notebookDraftKey]);

  useEffect(() => {
    if (!shouldPreventPwaUpdate) return;

    const preventUpdateWithNotebookWork = (event: Event) => event.preventDefault();
    window.addEventListener(
      PWA_BEFORE_UPDATE_EVENT,
      preventUpdateWithNotebookWork,
    );
    return () => {
      window.removeEventListener(
        PWA_BEFORE_UPDATE_EVENT,
        preventUpdateWithNotebookWork,
      );
    };
  }, [shouldPreventPwaUpdate]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      let response: Response;
      try {
        response = await fetch(`/api/watchlist/${ticker}/notebook/refresh`, {
          method: "GET",
        });
      } catch {
        return;
      }
      const payload = await readPayload(response);
      if (cancelled || !response.ok) return;

      const job = payload?.job as UserCompanyNotebookRefreshJob | null | undefined;
      if (job && isActiveRefreshJob(job)) {
        setRefreshJobId(job.id);
        setIsRefreshingNotebook(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ticker]);

  useEffect(() => {
    if (!refreshJobId) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      let response: Response;
      try {
        response = await fetch(
          `/api/watchlist/${ticker}/notebook/refresh?jobId=${encodeURIComponent(refreshJobId)}`,
          { method: "GET" },
        );
      } catch {
        if (!cancelled) {
          setError("노트북 정리 상태를 확인하지 못했습니다.");
          setIsRefreshingNotebook(false);
          setRefreshJobId(null);
        }
        return;
      }
      const payload = await readPayload(response);
      if (cancelled) return;

      if (!response.ok) {
        setError(errorMessage(payload, "노트북 정리 상태를 확인하지 못했습니다."));
        setIsRefreshingNotebook(false);
        setRefreshJobId(null);
        return;
      }

      const job = payload?.job as UserCompanyNotebookRefreshJob | null | undefined;
      if (!job) {
        setIsRefreshingNotebook(false);
        setRefreshJobId(null);
        return;
      }

      if (isActiveRefreshJob(job)) {
        setIsRefreshingNotebook(true);
        timeoutId = setTimeout(poll, NOTEBOOK_REFRESH_POLL_MS);
        return;
      }

      setIsRefreshingNotebook(false);
      setRefreshJobId(null);

      if (job.status === "succeeded") {
        const refreshedNotebook = payload?.notebook as
          | UserCompanyNotebook
          | undefined;
        if (refreshedNotebook) {
          setNotebook(refreshedNotebook);
          setDraft(refreshedNotebook.content_md);
          setNotebookRefreshSettled(true);
          void clearComposerDraft(notebookDraftKey);
          setIsEditing(false);
          setCompany(touchNotebookActivity);
        }
        return;
      }

      setError(
        job.error_message || "최근 대화를 반영해 노트북을 정리하지 못했습니다.",
      );
    };

    timeoutId = setTimeout(poll, 500);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [notebookDraftKey, refreshJobId, ticker]);

  useEffect(() => {
    if (!notebookRefreshSettled) return;
    const timeoutId = window.setTimeout(
      () => setNotebookRefreshSettled(false),
      900,
    );
    return () => window.clearTimeout(timeoutId);
  }, [notebookRefreshSettled]);

  const updateCoverageLevel = (coverageLevel: CoverageLevel | null) => {
    setError(null);
    startTransition(() => {
      void (async () => {
        const response = await fetch(`/api/watchlist/${ticker}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coverage_level: coverageLevel }),
        });
        const payload = await readPayload(response);
        if (!response.ok) {
          setError(errorMessage(payload, "종목 상태를 저장하지 못했습니다."));
          return;
        }

        const mark = payload?.mark as UserCompanyMark | undefined;
        if (mark) {
          setCompany((current) => ({
            ...current,
            mark,
            latest_activity_at: new Date().toISOString(),
          }));
        }
      })();
    });
  };

  const handleSaveNotebook = () => {
    setError(null);
    if (draft.length > NOTEBOOK_MAX_LENGTH) {
      setError("노트북은 100,000자 이하로 저장할 수 있습니다.");
      return;
    }

    startTransition(() => {
      void (async () => {
        const response = await fetch(`/api/watchlist/${ticker}/notebook`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: notebookTitle,
            content_md: draft,
            basis_period: notebook.basis_period ?? company.latest_period ?? "",
          }),
        });
        const payload = await readPayload(response);
        if (!response.ok) {
          setError(errorMessage(payload, "리서치 노트북을 저장하지 못했습니다."));
          return;
        }

        const savedNotebook = payload?.notebook as UserCompanyNotebook | undefined;
        if (savedNotebook) {
          setNotebook(savedNotebook);
          setDraft(savedNotebook.content_md);
          void clearComposerDraft(notebookDraftKey);
          setIsEditing(false);
          setCompany(touchNotebookActivity);
        }
      })();
    });
  };

  const handleRefreshNotebook = () => {
    if (isRefreshingNotebook) return;
    setError(null);
    setNotebookRefreshSettled(false);
    setIsRefreshingNotebook(true);
    void (async () => {
      try {
        const response = await fetch(`/api/watchlist/${ticker}/notebook/refresh`, {
          method: "POST",
        });
        const payload = await readPayload(response);
        if (!response.ok) {
          setError(
            errorMessage(payload, "최근 대화를 반영해 노트북을 정리하지 못했습니다."),
          );
          return;
        }

        const job = payload?.job as UserCompanyNotebookRefreshJob | undefined;
        if (job) {
          setRefreshJobId(job.id);
          setIsRefreshingNotebook(isActiveRefreshJob(job));
          return;
        }

        setIsRefreshingNotebook(false);
      } catch {
        setError("최근 대화를 반영해 노트북을 정리하지 못했습니다.");
        setIsRefreshingNotebook(false);
      }
    })();
  };

  const handleCancel = () => {
    setDraft(notebook.content_md);
    void clearComposerDraft(notebookDraftKey);
    setIsEditing(false);
    setError(null);
  };

  return (
    <main
      id="main-content"
      className="px-base pb-xl pt-xl sm:px-md md:px-xl md:pb-[96px] md:pt-[72px]"
    >
      <div className="mx-auto w-full max-w-[1240px]">
        <header className="border-b border-hairline pb-7">
          <Link
            href="/watchlist"
            className="inline-flex items-center gap-1 text-[13px] font-extrabold leading-5 text-muted transition-colors hover:text-primary"
          >
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-[18px]"
            >
              arrow_back
            </span>
            기업 커버리지
          </Link>

          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0">
              <p className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
                {company.sector ?? "Personal Research"}
              </p>
              <h1 className="mt-2 text-balance text-[30px] font-black leading-[1.1] tracking-normal text-ink sm:text-[42px]">
                {notebookTitle}
              </h1>
              {showTickerInTitle && (
                <p className="mt-3 text-[15px] font-bold leading-6 text-muted">
                  {ticker} · {companyTitle}
                </p>
              )}
            </div>

            <button
              type="button"
              disabled={isBusy}
              onClick={() => updateCoverageLevel(
                coverageLevelOf(company.mark) === "interest" ? null : "interest",
              )}
              aria-pressed={coverageLevelOf(company.mark) === "interest"}
              className={[
                "inline-flex min-h-11 items-center gap-2 rounded-[8px] border px-sm text-[14px] font-extrabold transition-colors disabled:cursor-wait disabled:opacity-60 lg:justify-self-end",
                coverageLevelOf(company.mark) === "interest"
                  ? "border-primary bg-primary-fixed text-on-primary-fixed"
                  : "border-hairline bg-canvas text-ink hover:border-primary hover:text-primary",
              ].join(" ")}
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                {coverageLevelOf(company.mark) === "interest" ? "check" : "bookmark"}
              </span>
              {coverageLevelOf(company.mark) === "interest" ? "관심 저장됨" : "관심"}
            </button>
          </div>
        </header>

        {error && (
          <div
            className="mt-4 border border-error-container bg-error-container/40 px-sm py-xs text-[13px] font-bold leading-5 text-error"
          >
            {error}
          </div>
        )}

        <div className="mt-6">
          <CoverageMemoryPanel
            ticker={ticker}
            initialTheses={detail.theses}
            thesisChecks={detail.thesis_checks}
            initialMonitoringRules={detail.monitoring_rules}
            questions={detail.questions}
          />
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_336px] xl:items-start">
          <section
            className="min-w-0 border border-hairline bg-canvas"
            aria-busy={isRefreshingNotebook}
          >
            <div className="border-b border-hairline px-sm py-sm md:px-md">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="min-w-0 flex-1 truncate text-[18px] font-black leading-6 text-ink sm:text-[20px]">
                  {notebookTitle}
                </h2>
                <div className="flex shrink-0 items-center gap-2">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        className="inline-flex h-11 items-center gap-1 rounded-[8px] border border-hairline bg-canvas px-3 text-[13px] font-extrabold text-ink transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-55"
                        disabled={isBusy}
                        onClick={handleCancel}
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-11 items-center gap-1 rounded-[8px] bg-surface-dark px-3 text-[13px] font-extrabold text-on-dark transition-colors hover:bg-primary-active disabled:cursor-not-allowed disabled:opacity-55"
                        disabled={isBusy || !hasChanges}
                        onClick={handleSaveNotebook}
                      >
                        <span
                          aria-hidden="true"
                          className="material-symbols-outlined text-[17px]"
                        >
                          save
                        </span>
                        저장
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="relative">
                        <button
                          type="button"
                          className="inline-flex h-11 items-center gap-1 rounded-[8px] border border-hairline bg-canvas px-2.5 text-[13px] font-extrabold text-ink transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-65 sm:px-sm"
                          disabled={isBusy || recentSessions.length === 0}
                          onClick={handleRefreshNotebook}
                        >
                          <span
                            aria-hidden="true"
                            className={[
                              "material-symbols-outlined text-[17px]",
                              isRefreshingNotebook ? "notebook-refresh-icon" : "",
                            ].join(" ")}
                          >
                            auto_fix_high
                          </span>
                          {isRefreshingNotebook ? "정리 중" : "노트북 다시정리"}
                        </button>
                        {!isRefreshingNotebook ? (
                          <div
                            className="absolute right-0 top-[calc(100%+8px)] z-30 w-[min(248px,calc(100vw-32px))] rounded-[8px] border border-primary/25 bg-canvas px-3 py-2 text-left shadow-[0_12px_28px_rgba(15,23,42,0.16)]"
                            role="status"
                          >
                            <span
                              aria-hidden="true"
                              className="absolute right-9 top-[-5px] h-2.5 w-2.5 rotate-45 border-l border-t border-primary/25 bg-canvas"
                            />
                            <p className="text-[12px] font-extrabold leading-5 text-ink">
                              최근 리서치한 내역을 보고 AI가 정리해줘요.
                            </p>
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-11 items-center gap-1 rounded-[8px] bg-surface-dark px-3 text-[13px] font-extrabold text-on-dark transition-colors hover:bg-primary-active disabled:cursor-not-allowed disabled:opacity-55 sm:px-sm"
                        disabled={isBusy}
                        onClick={() => {
                          setError(null);
                          setIsEditing(true);
                        }}
                      >
                        <span
                          aria-hidden="true"
                          className="material-symbols-outlined text-[17px]"
                        >
                          edit
                        </span>
                        편집
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {isEditing ? (
              <div className="p-sm md:p-md">
                <textarea
                  className="min-h-[560px] w-full resize-y rounded-[8px] border border-hairline bg-surface px-sm py-sm font-mono text-[14px] font-semibold leading-6 text-ink outline-none transition-colors placeholder:text-muted focus:border-primary focus:bg-canvas"
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                  }}
                  maxLength={NOTEBOOK_MAX_LENGTH}
                  spellCheck={false}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] font-bold leading-4 text-muted">
                  <span>{draft.length.toLocaleString()} / 100,000자</span>
                  <span>저장하면 현재 노트북을 덮어씁니다.</span>
                </div>
              </div>
            ) : (
              <div className="relative min-h-[560px] px-sm py-md md:px-lg md:py-lg">
                <div
                  className={[
                    "transition-[filter,opacity] duration-300 ease-[var(--ease-out-expo)]",
                    notebookRefreshSettled ? "notebook-refresh-settled" : "",
                    isRefreshingNotebook
                      ? "pointer-events-none select-none opacity-45 blur-[1px]"
                      : "",
                  ].join(" ")}
                >
                  <ResearchMarkdown
                    content={displayContent}
                    className="max-w-none"
                    normalizePlainText={false}
                  />
                </div>
                {isRefreshingNotebook && <NotebookRefreshOverlay />}
              </div>
            )}
          </section>

          <aside className="grid gap-4">
            <SidebarSection title="이 종목의 채팅 기록">
              {recentSessions.length === 0 ? (
                <p className="text-[13px] font-bold leading-5 text-muted">
                  아직 이 종목으로 저장된 대화가 없습니다.
                </p>
              ) : (
                <div className="divide-y divide-hairline">
                  {recentSessions.map((session) => (
                    <RecentSessionRow
                      key={session.id}
                      session={session}
                      ticker={ticker}
                    />
                  ))}
                </div>
              )}
            </SidebarSection>
          </aside>
        </div>
      </div>
    </main>
  );
}

function NotebookRefreshOverlay() {
  return (
    <div
      className="absolute inset-x-sm top-md z-10 md:inset-x-lg md:top-lg"
      role="status"
      aria-live="polite"
    >
      <div className="notebook-refresh-panel overflow-hidden rounded-[8px] border border-primary/20 bg-canvas/95 shadow-[0_18px_48px_rgba(10,11,13,0.08)] backdrop-blur">
        <div className="notebook-refresh-scan" aria-hidden="true" />
        <p className="sr-only">노트북을 정리하는 중입니다.</p>
        <div className="grid gap-2 p-sm md:p-md" aria-hidden="true">
          <span className="notebook-refresh-line w-full" />
          <span className="notebook-refresh-line w-11/12" />
          <span className="notebook-refresh-line w-8/12" />
        </div>
      </div>
    </div>
  );
}

function SidebarSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border border-hairline bg-canvas p-sm">
      <h2 className="text-[15px] font-black leading-5 text-ink">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function RecentSessionRow({
  session,
  ticker,
}: {
  session: SessionSummary;
  ticker: string;
}) {
  return (
    <Link
      href={buildChatSessionHref(session.id, { ticker })}
      className="block py-3 first:pt-0 last:pb-0"
    >
      <p className="line-clamp-1 text-[13px] font-black leading-5 text-ink">
        {session.title || "제목 없는 대화"}
      </p>
      <p className="mt-1 line-clamp-2 text-[12px] font-semibold leading-5 text-muted">
        {session.last_message_preview || "최근 메시지 없음"}
      </p>
      <p className="mt-1 font-mono text-[11px] font-bold leading-4 text-muted">
        {formatDateTime(session.last_message_at ?? session.updated_at)}
      </p>
    </Link>
  );
}

function touchNotebookActivity(
  company: WatchlistCompanySummary,
): WatchlistCompanySummary {
  const now = new Date().toISOString();
  return {
    ...company,
    latest_activity_at: now,
    mark: {
      ...company.mark,
      last_activity_at: now,
      updated_at: now,
    },
  };
}

function coverageLevelOf(mark: UserCompanyMark): CoverageLevel | null {
  return mark.coverage_level;
}

function buildEmptyNotebookContent(): string {
  return [
    "## 내가 보고 있는 이유",
    "- 왜 이 종목을 계속 보고 있는지.",
    "",
    "## 긍정 논리",
    "- 이 회사가 좋아질 수 있다고 보는 이유.",
    "- 현재 생각을 지지하는 근거.",
    "",
    "## 반대 논리",
    "- 내 생각이 틀릴 수 있는 이유.",
    "- 시장이 우려할 만한 지점.",
    "",
    "## 생각이 바뀔 수 있는 신호",
    "- 어떤 일이 생기면 기존 생각을 다시 봐야 하는지.",
  ].join("\n");
}

function stripNotebookTitle(content: string, ticker: string): string {
  const normalizedTicker = ticker.trim().toUpperCase();
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const firstNonEmptyIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstNonEmptyIndex < 0) return content;

  const firstLine = lines[firstNonEmptyIndex]?.trim() ?? "";
  const expectedHeading = `# ${normalizedTicker} 리서치 노트북`;
  if (firstLine !== expectedHeading) return content;

  return lines
    .filter((_, index) => index !== firstNonEmptyIndex)
    .join("\n")
    .trimStart();
}

function isActiveRefreshJob(job: UserCompanyNotebookRefreshJob): boolean {
  return job.status === "queued" || job.status === "running";
}

async function readPayload(response: Response): Promise<ApiPayload> {
  return (await response.json().catch(() => null)) as ApiPayload;
}

function errorMessage(payload: ApiPayload, fallback: string): string {
  const error = payload?.error;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return fallback;
}

function formatDateTime(value: string | null): string {
  if (!value) return "미저장";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "미저장";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
