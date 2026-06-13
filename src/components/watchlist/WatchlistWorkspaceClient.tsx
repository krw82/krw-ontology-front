"use client";

import { useMemo, useState, useTransition } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import {
  buildChatSessionHref,
  buildNewChatHref,
} from "@/lib/chat/history-state";
import type {
  UserCompanyCard,
  UserCompanyMark,
  UserCompanyQuestion,
  UserCompanyQuestionStatus,
  UserCompanyThesis,
  UserCompanyThesisStatus,
  UserResearchNote,
  UserResearchNoteType,
  UserThesisCheck,
  WatchlistCompanyDetailResponse,
  WatchlistCompanySummary,
} from "@/types/api-contracts";

interface WatchlistWorkspaceClientProps {
  detail: WatchlistCompanyDetailResponse;
}

type ApiPayload = Record<string, unknown> | null;

const NOTE_TYPE_OPTIONS: Array<{ value: UserResearchNoteType; label: string }> = [
  { value: "manual", label: "일반 노트" },
  { value: "risk_memo", label: "리스크" },
  { value: "filing_check", label: "공시 점검" },
  { value: "thesis_check", label: "Thesis 점검" },
  { value: "earnings_setup", label: "실적 전" },
  { value: "earnings_review", label: "실적 후" },
];

const THESIS_STATUS_OPTIONS: Array<{
  value: UserCompanyThesisStatus;
  label: string;
}> = [
  { value: "active", label: "유효" },
  { value: "needs_review", label: "점검 필요" },
  { value: "mixed", label: "혼재" },
  { value: "weakened", label: "약화" },
];

const WORKSPACE_NAV = [
  { href: "#overview", label: "개요" },
  { href: "#questions", label: "열린 질문" },
  { href: "#card", label: "종목 카드" },
  { href: "#thesis", label: "내 Thesis" },
  { href: "#notes", label: "리서치 노트" },
  { href: "#recent", label: "최근 질문" },
];

export default function WatchlistWorkspaceClient({
  detail,
}: WatchlistWorkspaceClientProps) {
  const [company, setCompany] = useState(detail.company);
  const [questions, setQuestions] = useState(detail.questions);
  const [notes, setNotes] = useState(detail.notes);
  const [theses, setTheses] = useState(detail.theses);
  const [card, setCard] = useState<UserCompanyCard | null>(detail.card);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [interestReason, setInterestReason] = useState(
    detail.company.mark.interest_reason ?? "",
  );
  const [tagInput, setTagInput] = useState(detail.company.mark.tags.join(", "));
  const [cardForm, setCardForm] = useState(() => ({
    title: detail.card?.title ?? `${detail.company.ticker} 종목 카드`,
    summary: detail.card?.summary ?? "",
    content_md: detail.card?.content_md ?? "",
    basis_period:
      detail.card?.basis_period ?? detail.company.latest_period ?? "",
    basis_document_type:
      detail.card?.basis_document_type ??
      detail.company.document_types[0] ??
      "",
  }));
  const [questionText, setQuestionText] = useState("");
  const [noteForm, setNoteForm] = useState<{
    title: string;
    body: string;
    note_type: UserResearchNoteType;
  }>({
    title: "",
    body: "",
    note_type: "manual",
  });
  const [thesisForm, setThesisForm] = useState<{
    title: string;
    thesis_text: string;
    status: UserCompanyThesisStatus;
  }>({
    title: "",
    thesis_text: "",
    status: "active",
  });

  const ticker = company.ticker;
  const openQuestions = questions.filter((question) => question.status === "open");
  const sortedQuestions = useMemo(() => sortQuestions(questions), [questions]);
  const thesisState = useMemo(
    () => getThesisState(theses, detail.thesis_checks),
    [detail.thesis_checks, theses],
  );
  const newChatHref = buildNewChatHref(new URLSearchParams({ ticker }));
  const cardChatHref = actionChatHref(ticker, buildCompanyCardPrompt(company));
  const primaryThesis = theses[0] ?? null;
  const thesisCheckHref = actionChatHref(
    ticker,
    buildThesisCheckPrompt(company, primaryThesis),
  );
  const memoChatHref = actionChatHref(ticker, buildMemoPrompt(company));
  const suggestedQuestions = useMemo(
    () => buildSuggestedQuestions(company),
    [company],
  );
  const savedQuestionKeys = useMemo(
    () => new Set(questions.map((question) => normalizeQuestion(question.question))),
    [questions],
  );
  const questionChatHref = (question: string) =>
    buildNewChatHref(new URLSearchParams({ ticker, query: question }));
  const companyTitle = company.companyNameKo ?? company.name;
  const showTickerInTitle = companyTitle.trim().toUpperCase() !== ticker;
  const eyebrowLabel = company.sector ?? ticker;

  const updateMark = (patch: Partial<UserCompanyMark>) => {
    setError(null);
    startTransition(() => {
      void (async () => {
        const response = await fetch(`/api/watchlist/${ticker}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const payload = await readPayload(response);
        if (!response.ok) {
          setError(errorMessage(payload, "종목 상태를 저장하지 못했습니다."));
          return;
        }
        const mark = payload?.mark as UserCompanyMark | undefined;
        if (mark) {
          setCompany((current) => touchCompany({ ...current, mark }));
          setInterestReason(mark.interest_reason ?? "");
          setTagInput(mark.tags.join(", "));
        }
      })();
    });
  };

  const handleSaveResearchReason = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateMark({
      interest_reason: interestReason,
      tags: parseTags(tagInput),
    });
  };

  const handleSaveCard = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    startTransition(() => {
      void (async () => {
        const response = await fetch(`/api/watchlist/${ticker}/card`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cardForm),
        });
        const payload = await readPayload(response);
        if (!response.ok) {
          setError(errorMessage(payload, "종목 카드를 저장하지 못했습니다."));
          return;
        }
        const savedCard = payload?.card as UserCompanyCard | undefined;
        if (savedCard) {
          setCard(savedCard);
          setCompany(touchCompany);
        }
      })();
    });
  };

  const handleAddQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const question = questionText.trim();
    if (!question) {
      setError("질문을 입력해주세요.");
      return;
    }

    saveQuestion(question, () => setQuestionText(""));
  };

  const saveQuestion = (question: string, onSaved?: () => void) => {
    startTransition(() => {
      void (async () => {
        const response = await fetch(`/api/watchlist/${ticker}/questions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        });
        const payload = await readPayload(response);
        if (!response.ok) {
          setError(errorMessage(payload, "질문을 저장하지 못했습니다."));
          return;
        }
        const savedQuestion = payload?.question as
          | UserCompanyQuestion
          | undefined;
        if (savedQuestion) {
          setQuestions((current) => [savedQuestion, ...current]);
          onSaved?.();
          setCompany(touchCompany);
        }
      })();
    });
  };

  const updateQuestionStatus = (
    questionId: string,
    status: UserCompanyQuestionStatus,
  ) => {
    setError(null);
    startTransition(() => {
      void (async () => {
        const response = await fetch(
          `/api/watchlist/${ticker}/questions/${questionId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          },
        );
        const payload = await readPayload(response);
        if (!response.ok) {
          setError(errorMessage(payload, "질문 상태를 저장하지 못했습니다."));
          return;
        }
        const savedQuestion = payload?.question as
          | UserCompanyQuestion
          | undefined;
        if (savedQuestion) {
          setQuestions((current) =>
            current.map((question) =>
              question.id === savedQuestion.id ? savedQuestion : question,
            ),
          );
          setCompany(touchCompany);
        }
      })();
    });
  };

  const handleAddNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!noteForm.title.trim()) {
      setError("노트 제목을 입력해주세요.");
      return;
    }

    startTransition(() => {
      void (async () => {
        const response = await fetch(`/api/watchlist/${ticker}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(noteForm),
        });
        const payload = await readPayload(response);
        if (!response.ok) {
          setError(errorMessage(payload, "노트를 저장하지 못했습니다."));
          return;
        }
        const savedNote = payload?.note as UserResearchNote | undefined;
        if (savedNote) {
          setNotes((current) => [savedNote, ...current]);
          setNoteForm({ title: "", body: "", note_type: "manual" });
          setCompany(touchCompany);
        }
      })();
    });
  };

  const deleteNote = (noteId: string) => {
    setError(null);
    startTransition(() => {
      void (async () => {
        const response = await fetch(`/api/watchlist/${ticker}/notes/${noteId}`, {
          method: "DELETE",
        });
        const payload = await readPayload(response);
        if (!response.ok) {
          setError(errorMessage(payload, "노트를 삭제하지 못했습니다."));
          return;
        }
        setNotes((current) => current.filter((note) => note.id !== noteId));
        setCompany(touchCompany);
      })();
    });
  };

  const handleAddThesis = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!thesisForm.title.trim() || !thesisForm.thesis_text.trim()) {
      setError("Thesis 제목과 내용을 입력해주세요.");
      return;
    }

    startTransition(() => {
      void (async () => {
        const response = await fetch(`/api/watchlist/${ticker}/theses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(thesisForm),
        });
        const payload = await readPayload(response);
        if (!response.ok) {
          setError(errorMessage(payload, "Thesis를 저장하지 못했습니다."));
          return;
        }
        const savedThesis = payload?.thesis as UserCompanyThesis | undefined;
        if (savedThesis) {
          setTheses((current) => [savedThesis, ...current]);
          setThesisForm({ title: "", thesis_text: "", status: "active" });
          setCompany(touchCompany);
        }
      })();
    });
  };

  const archiveThesis = (thesisId: string) => {
    setError(null);
    startTransition(() => {
      void (async () => {
        const response = await fetch(
          `/api/watchlist/${ticker}/theses/${thesisId}`,
          { method: "DELETE" },
        );
        const payload = await readPayload(response);
        if (!response.ok) {
          setError(errorMessage(payload, "Thesis를 보관하지 못했습니다."));
          return;
        }
        setTheses((current) =>
          current.filter((thesis) => thesis.id !== thesisId),
        );
        setCompany(touchCompany);
      })();
    });
  };

  return (
    <main
      id="main-content"
      className="px-base pb-[112px] pt-xl sm:px-md md:px-xl md:pb-[96px] md:pt-[72px]"
    >
      <div className="mx-auto w-full max-w-[1320px]">
        <header className="border-b border-hairline pb-8">
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
            내 종목장
          </Link>
          <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0">
              <p className="font-mono text-[13px] font-black leading-5 tracking-[0.08em] text-primary">
                {eyebrowLabel}
              </p>
              <h1 className="mt-2 text-balance text-[32px] font-black leading-[1.08] tracking-normal text-ink sm:text-[46px]">
                {companyTitle}
                {showTickerInTitle && (
                  <span className="ml-3 font-mono text-[0.7em] text-muted">
                    {ticker}
                  </span>
                )}
              </h1>
              <p className="mt-4 max-w-3xl text-[15px] leading-7 text-body sm:text-[17px]">
                {company.description}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ToggleButton
                active={company.mark.is_watchlisted}
                icon="bookmark"
                label="즐겨찾기"
                onClick={() =>
                  updateMark({ is_watchlisted: !company.mark.is_watchlisted })
                }
                disabled={isPending}
              />
              <ToggleButton
                active={company.mark.is_holding}
                icon="inventory_2"
                label="보유"
                onClick={() => updateMark({ is_holding: !company.mark.is_holding })}
                disabled={isPending}
              />
              <Link
                href={newChatHref}
                className="inline-flex h-11 items-center gap-1 rounded-[8px] bg-surface-dark px-sm text-[14px] font-extrabold text-on-dark transition-colors hover:bg-primary-active"
              >
                <span
                  aria-hidden="true"
                  className="material-symbols-outlined text-[18px]"
                >
                  chat_bubble
                </span>
                새 리서치
              </Link>
            </div>
          </div>
        </header>

        <section className="grid border-b border-hairline lg:grid-cols-5">
          <Metric label="마지막 점검" value={formatDate(company.latest_activity_at)} />
          <Metric label="기준 공시" value={basisLabel(company)} />
          <Metric label="열린 질문" value={openQuestions.length.toLocaleString()} />
          <Metric label="노트" value={notes.length.toLocaleString()} />
          <Metric label="Thesis 상태" value={thesisState.label} tone={thesisState.tone} />
        </section>

        <nav
          className="flex gap-4 overflow-x-auto border-b border-hairline py-3"
          aria-label="Workspace sections"
        >
          {WORKSPACE_NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="shrink-0 text-[13px] font-extrabold leading-5 text-muted transition-colors hover:text-primary focus-visible:text-primary"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {error && (
          <div className="mt-4 border border-error-container bg-error-container/40 px-sm py-xs text-[13px] font-bold leading-5 text-error">
            {error}
          </div>
        )}

        <div className="grid gap-8 pt-8 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
          <div className="min-w-0 space-y-8">
            <section id="overview" className="border-b border-hairline pb-8 scroll-mt-24">
              <SectionHeader
                icon="dashboard"
                title="개요"
                meta="리서치 상태"
              />
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <OverviewItem
                  label="관심 이유"
                  value={
                    company.mark.interest_reason ||
                    "아직 이 종목을 보는 이유가 기록되지 않았습니다."
                  }
                />
                <OverviewItem
                  label="다음 점검"
                  value={
                    openQuestions[0]?.question ||
                    "열린 질문을 추가하면 다음 점검 포인트로 남습니다."
                  }
                />
                <OverviewItem
                  label="종목 카드"
                  value={card?.summary || "공시 기반 종목 카드 초안이 없습니다."}
                />
                <OverviewItem
                  label="최근 노트"
                  value={notes[0]?.title || "아직 저장한 리서치 노트가 없습니다."}
                />
              </div>
            </section>

            <section id="card" className="border-b border-hairline pb-8 scroll-mt-24">
              <SectionHeader
                icon="assignment"
                title="종목 카드"
                meta={card ? `수정 ${formatDate(card.updated_at)}` : "초안"}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionLink
                  href={cardChatHref}
                  icon="auto_stories"
                  label={card ? "새 공시 기준으로 업데이트" : "종목 카드 만들기"}
                />
                <SourceChatLink
                  sessionId={card?.source_chat_session_id ?? null}
                  messageId={card?.source_message_id ?? null}
                  ticker={ticker}
                />
              </div>
              <form className="mt-4 grid gap-3" onSubmit={handleSaveCard}>
                <input
                  className={inputClassName}
                  value={cardForm.title}
                  onChange={(event) =>
                    setCardForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  maxLength={200}
                />
                <textarea
                  className={`${textareaClassName} min-h-20`}
                  value={cardForm.summary}
                  onChange={(event) =>
                    setCardForm((current) => ({
                      ...current,
                      summary: event.target.value,
                    }))
                  }
                  placeholder="한 문단 요약"
                  maxLength={1200}
                />
                <textarea
                  className={`${textareaClassName} min-h-[220px] font-mono text-[13px]`}
                  value={cardForm.content_md}
                  onChange={(event) =>
                    setCardForm((current) => ({
                      ...current,
                      content_md: event.target.value,
                    }))
                  }
                  placeholder={"핵심 판단\n\n근거\n\n리스크\n\n다음 점검"}
                  maxLength={30_000}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    className={inputClassName}
                    value={cardForm.basis_period}
                    onChange={(event) =>
                      setCardForm((current) => ({
                        ...current,
                        basis_period: event.target.value,
                      }))
                    }
                    placeholder="기준 기간"
                    maxLength={40}
                  />
                  <input
                    className={inputClassName}
                    value={cardForm.basis_document_type}
                    onChange={(event) =>
                      setCardForm((current) => ({
                        ...current,
                        basis_document_type: event.target.value,
                      }))
                    }
                    placeholder="기준 공시"
                    maxLength={80}
                  />
                </div>
                <FormActions isPending={isPending} label="카드 저장" />
              </form>
            </section>

            <section id="thesis" className="border-b border-hairline pb-8 scroll-mt-24">
              <SectionHeader
                icon="fact_check"
                title="Thesis"
                meta={`${theses.length.toLocaleString()}개`}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionLink
                  href={thesisCheckHref}
                  icon="rule"
                  label={primaryThesis ? "내 투자 가설 점검" : "가설 정리 질문하기"}
                />
              </div>
              <form className="mt-4 grid gap-3" onSubmit={handleAddThesis}>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
                  <input
                    className={inputClassName}
                    value={thesisForm.title}
                    onChange={(event) =>
                      setThesisForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Thesis 제목"
                    maxLength={200}
                  />
                  <select
                    className={inputClassName}
                    value={thesisForm.status}
                    onChange={(event) =>
                      setThesisForm((current) => ({
                        ...current,
                        status: event.target.value as UserCompanyThesisStatus,
                      }))
                    }
                  >
                    {THESIS_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  className={`${textareaClassName} min-h-28`}
                  value={thesisForm.thesis_text}
                  onChange={(event) =>
                    setThesisForm((current) => ({
                      ...current,
                      thesis_text: event.target.value,
                    }))
                  }
                  placeholder="내 투자 가설"
                  maxLength={20_000}
                />
                <FormActions isPending={isPending} label="Thesis 추가" />
              </form>
              <div className="mt-5 divide-y divide-hairline border-t border-hairline">
                {theses.length === 0 ? (
                  <EmptyLine text="기록된 thesis가 없습니다." />
                ) : (
                  theses.map((thesis) => (
                    <article key={thesis.id} className="py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[15px] font-black leading-5 text-ink">
                            {thesis.title}
                          </p>
                          <p className="mt-1 text-[12px] font-bold leading-4 text-muted">
                            {thesisStatusLabel(thesis.status)} ·{" "}
                            {formatDate(thesis.updated_at)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <SourceChatLink
                            sessionId={thesis.source_chat_session_id}
                            messageId={thesis.source_message_id}
                            ticker={ticker}
                          />
                          <button
                            type="button"
                            className="inline-flex h-8 items-center rounded-[8px] border border-hairline px-xs text-[12px] font-extrabold text-muted transition-colors hover:border-error hover:text-error"
                            onClick={() => archiveThesis(thesis.id)}
                            disabled={isPending}
                          >
                            보관
                          </button>
                        </div>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-[14px] font-medium leading-6 text-body">
                        {thesis.thesis_text}
                      </p>
                    </article>
                  ))
                )}
              </div>
            </section>

            <section id="recent" className="scroll-mt-24">
              <SectionHeader icon="history" title="최근 질문" meta={`${detail.recent_sessions.length}개`} />
              <div className="mt-4 divide-y divide-hairline border-y border-hairline">
                {detail.recent_sessions.length === 0 ? (
                  <EmptyLine text="최근 이 종목으로 한 질문이 없습니다." />
                ) : (
                  detail.recent_sessions.map((session) => (
                    <Link
                      key={session.id}
                      href={buildChatSessionHref(session.id)}
                      className="block py-4 transition-colors hover:bg-surface-soft"
                    >
                      <p className="truncate text-[14px] font-black leading-5 text-ink">
                        {session.title}
                      </p>
                      <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-5 text-muted">
                        {session.last_message_preview ?? "대화 기록"}
                      </p>
                    </Link>
                  ))
                )}
              </div>
            </section>
          </div>

          <aside className="min-w-0 space-y-8">
            <section className="border-b border-hairline pb-8">
              <SectionHeader icon="bookmark_manager" title="리서치 이유" />
              <form className="mt-4 grid gap-3" onSubmit={handleSaveResearchReason}>
                <textarea
                  className={`${textareaClassName} min-h-28`}
                  value={interestReason}
                  onChange={(event) => setInterestReason(event.target.value)}
                  placeholder="왜 추적하는지"
                  maxLength={1200}
                />
                <input
                  className={inputClassName}
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  placeholder="태그, 쉼표로 구분"
                />
                <FormActions isPending={isPending} label="이유 저장" />
              </form>
            </section>

            <section id="questions" className="border-b border-hairline pb-8 scroll-mt-24">
              <SectionHeader
                icon="help"
                title="열린 질문"
                meta={`${openQuestions.length.toLocaleString()}개`}
              />
              <form className="mt-4 grid gap-3" onSubmit={handleAddQuestion}>
                <textarea
                  className={`${textareaClassName} min-h-24`}
                  value={questionText}
                  onChange={(event) => setQuestionText(event.target.value)}
                  placeholder="확인할 질문"
                  maxLength={1200}
                />
                <FormActions isPending={isPending} label="질문 추가" />
              </form>
              <div className="mt-5 divide-y divide-hairline border-t border-hairline">
                {sortedQuestions.length === 0 ? (
                  <EmptyLine text="저장한 질문이 없습니다." />
                ) : (
                  sortedQuestions.map((question) => (
                    <article key={question.id} className="py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[14px] font-extrabold leading-6 text-ink">
                            {question.question}
                          </p>
                          <p className="mt-1 text-[12px] font-bold leading-4 text-muted">
                            {questionStatusLabel(question.status)} ·{" "}
                            {formatDate(question.updated_at)}
                          </p>
                        </div>
                      </div>
                      {question.status === "open" && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link
                            href={questionChatHref(question.question)}
                            className={smallButtonClassName}
                          >
                            질문하기
                          </Link>
                          <button
                            type="button"
                            className={smallButtonClassName}
                            onClick={() =>
                              updateQuestionStatus(question.id, "answered")
                            }
                            disabled={isPending}
                          >
                            해결
                          </button>
                          <button
                            type="button"
                            className={smallButtonClassName}
                            onClick={() =>
                              updateQuestionStatus(question.id, "dismissed")
                            }
                            disabled={isPending}
                          >
                            보류
                          </button>
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
            </section>

            <section className="border-b border-hairline pb-8">
              <SectionHeader
                icon="playlist_add_check"
                title="다음 점검 질문"
                meta="추천"
              />
              <div className="mt-4 divide-y divide-hairline border-y border-hairline">
                {suggestedQuestions.map((question) => {
                  const alreadySaved = savedQuestionKeys.has(
                    normalizeQuestion(question),
                  );

                  return (
                    <div key={question} className="py-4">
                      <p className="text-[14px] font-extrabold leading-6 text-ink">
                        {question}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                          href={questionChatHref(question)}
                          className={smallButtonClassName}
                        >
                          질문하기
                        </Link>
                        <button
                          type="button"
                          className={smallButtonClassName}
                          onClick={() => saveQuestion(question)}
                          disabled={isPending || alreadySaved}
                        >
                          {alreadySaved ? "추가됨" : "체크리스트에 추가"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section id="notes" className="scroll-mt-24">
              <SectionHeader
                icon="edit_note"
                title="리서치 노트"
                meta={`${notes.length.toLocaleString()}개`}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionLink
                  href={memoChatHref}
                  icon="summarize"
                  label="리서치 노트로 정리"
                />
              </div>
              <form className="mt-4 grid gap-3" onSubmit={handleAddNote}>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
                  <input
                    className={inputClassName}
                    value={noteForm.title}
                    onChange={(event) =>
                      setNoteForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="노트 제목"
                    maxLength={200}
                  />
                  <select
                    className={inputClassName}
                    value={noteForm.note_type}
                    onChange={(event) =>
                      setNoteForm((current) => ({
                        ...current,
                        note_type: event.target.value as UserResearchNoteType,
                      }))
                    }
                  >
                    {NOTE_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  className={`${textareaClassName} min-h-28`}
                  value={noteForm.body}
                  onChange={(event) =>
                    setNoteForm((current) => ({
                      ...current,
                      body: event.target.value,
                    }))
                  }
                  placeholder="노트 내용"
                  maxLength={20_000}
                />
                <FormActions isPending={isPending} label="노트 추가" />
              </form>
              <div className="mt-5 divide-y divide-hairline border-t border-hairline">
                {notes.length === 0 ? (
                  <EmptyLine text="저장한 노트가 없습니다." />
                ) : (
                  notes.map((note) => (
                    <article key={note.id} className="py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[14px] font-black leading-5 text-ink">
                            {note.title}
                          </p>
                          <p className="mt-1 text-[12px] font-bold leading-4 text-muted">
                            {noteTypeLabel(note.note_type)} ·{" "}
                            {formatDate(note.updated_at)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <SourceChatLink
                            sessionId={note.source_chat_session_id}
                            messageId={note.source_message_id}
                            ticker={ticker}
                          />
                          <button
                            type="button"
                            className="inline-flex h-8 items-center rounded-[8px] border border-hairline px-xs text-[12px] font-extrabold text-muted transition-colors hover:border-error hover:text-error"
                            onClick={() => deleteNote(note.id)}
                            disabled={isPending}
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                      {note.body && (
                        <p className="mt-3 whitespace-pre-wrap text-[14px] font-medium leading-6 text-body">
                          {note.body}
                        </p>
                      )}
                    </article>
                  ))
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

const inputClassName =
  "h-11 w-full rounded-[8px] border border-hairline bg-canvas px-sm text-[14px] font-semibold leading-5 text-ink placeholder:text-muted focus:border-primary focus:outline-none";
const textareaClassName =
  "w-full resize-y rounded-[8px] border border-hairline bg-canvas px-sm py-xs text-[14px] font-semibold leading-6 text-ink placeholder:text-muted focus:border-primary focus:outline-none";
const smallButtonClassName =
  "inline-flex h-8 items-center rounded-[8px] border border-hairline px-xs text-[12px] font-extrabold text-ink transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-55";

function ToggleButton({
  active,
  icon,
  label,
  onClick,
  disabled,
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      className={[
        "inline-flex h-11 items-center gap-1 rounded-[8px] border px-sm text-[14px] font-extrabold transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        active
          ? "border-primary bg-primary-fixed text-on-primary-fixed"
          : "border-hairline bg-canvas text-muted hover:border-primary hover:text-primary",
      ].join(" ")}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
        {icon}
      </span>
      {label}
    </button>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "positive" | "negative" | "mixed" | "muted";
}) {
  const valueClassName =
    tone === "positive"
      ? "text-semantic-up"
      : tone === "negative"
        ? "text-semantic-down"
        : tone === "mixed"
          ? "text-tertiary"
          : tone === "muted"
            ? "text-muted"
            : "text-ink";

  return (
    <div className="border-hairline py-5 lg:border-r lg:px-5 lg:last:border-r-0">
      <p className="text-[12px] font-extrabold leading-4 text-muted">{label}</p>
      <p
        className={`mt-2 text-[18px] font-black leading-6 ${valueClassName}`}
      >
        {value}
      </p>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  meta,
}: {
  icon: string;
  title: string;
  meta?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[22px] text-primary"
        >
          {icon}
        </span>
        <h2 className="truncate text-[18px] font-black leading-6 text-ink">
          {title}
        </h2>
      </div>
      {meta && (
        <p className="shrink-0 text-[12px] font-bold leading-4 text-muted">
          {meta}
        </p>
      )}
    </div>
  );
}

function ActionLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center gap-1 rounded-[8px] border border-hairline bg-canvas px-xs text-[12px] font-extrabold text-ink transition-colors hover:border-primary hover:text-primary"
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[17px]">
        {icon}
      </span>
      {label}
    </Link>
  );
}

function SourceChatLink({
  sessionId,
  messageId,
  ticker,
}: {
  sessionId: string | null;
  messageId: string | null;
  ticker: string;
}) {
  if (!sessionId || !messageId) return null;

  return (
    <Link
      href={sourceChatHref(sessionId, messageId, ticker)}
      className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-hairline bg-canvas px-xs text-[12px] font-extrabold text-muted transition-colors hover:border-primary hover:text-primary"
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
        chat_bubble
      </span>
      출처 채팅
    </Link>
  );
}

function OverviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-hairline bg-surface-soft p-sm">
      <p className="text-[12px] font-extrabold leading-4 text-muted">{label}</p>
      <p className="mt-2 line-clamp-4 text-[14px] font-semibold leading-6 text-ink">
        {value}
      </p>
    </div>
  );
}

function FormActions({
  isPending,
  label,
}: {
  isPending: boolean;
  label: string;
}) {
  return (
    <div className="flex justify-end">
      <button
        type="submit"
        className="inline-flex h-10 items-center justify-center gap-1 rounded-[8px] bg-surface-dark px-sm text-[13px] font-extrabold text-on-dark transition-colors hover:bg-primary-active disabled:cursor-not-allowed disabled:opacity-55"
        disabled={isPending}
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[17px]">
          save
        </span>
        {label}
      </button>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="py-5 text-[14px] font-bold leading-5 text-muted">{text}</div>
  );
}

function sortQuestions(questions: UserCompanyQuestion[]) {
  const rank: Record<UserCompanyQuestionStatus, number> = {
    open: 0,
    answered: 1,
    dismissed: 2,
  };
  return [...questions].sort((a, b) => {
    const statusDiff = rank[a.status] - rank[b.status];
    if (statusDiff !== 0) return statusDiff;
    return b.updated_at.localeCompare(a.updated_at);
  });
}

function getThesisState(
  theses: UserCompanyThesis[],
  checks: UserThesisCheck[],
): {
  label: string;
  tone: "positive" | "negative" | "mixed" | "muted" | "default";
} {
  const latestCheck = [...checks].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )[0];
  if (latestCheck) {
    if (latestCheck.result_status === "strengthened") {
      return { label: "강화", tone: "positive" };
    }
    if (latestCheck.result_status === "weakened") {
      return { label: "약화", tone: "negative" };
    }
    if (latestCheck.result_status === "mixed") {
      return { label: "혼재", tone: "mixed" };
    }
    if (latestCheck.result_status === "insufficient") {
      return { label: "근거 부족", tone: "muted" };
    }
    return { label: "점검 필요", tone: "default" };
  }

  if (theses.length === 0) return { label: "근거 부족", tone: "muted" };
  return { label: "점검 필요", tone: "default" };
}

function touchCompany(company: WatchlistCompanySummary): WatchlistCompanySummary {
  return {
    ...company,
    latest_activity_at: new Date().toISOString(),
  };
}

function basisLabel(company: WatchlistCompanySummary): string {
  if (company.latest_period) return company.latest_period;
  if (company.document_count > 0) return `${company.document_count}개 공시`;
  return "확인 필요";
}

function formatDate(value: string | null): string {
  if (!value) return "미점검";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "미점검";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parseTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 12),
    ),
  );
}

function actionChatHref(ticker: string, query: string): string {
  return buildNewChatHref(new URLSearchParams({ ticker, query }));
}

function sourceChatHref(
  sessionId: string,
  messageId: string,
  ticker: string,
): string {
  return `${buildChatSessionHref(sessionId, { ticker })}#message-${messageId}`;
}

function buildCompanyCardPrompt(company: WatchlistCompanySummary): string {
  return [
    `${company.ticker}의 최신 공시 기준으로 종목 카드를 만들어줘.`,
    "사업 구조, 핵심 변수, 반복 확인되는 리스크, 다음 확인 포인트를 구분해서 정리해줘.",
    "가격, 목표가, 매수/매도 의견은 제외하고 공시 근거 중심으로 작성해줘.",
  ].join(" ");
}

function buildThesisCheckPrompt(
  company: WatchlistCompanySummary,
  thesis: UserCompanyThesis | null,
): string {
  if (!thesis) {
    return [
      `${company.ticker}를 공시 기준으로 볼 때 개인 투자자가 작성할 수 있는 투자 가설 초안을 정리해줘.`,
      "강화/약화 판단이 아니라, 확인해야 할 핵심 변수와 다음 질문 중심으로 구성해줘.",
    ].join(" ");
  }

  return [
    `${company.ticker}의 최신 공시 기준으로 아래 내 투자 가설을 점검해줘.`,
    `가설: ${thesis.title} - ${thesis.thesis_text}`,
    "공시 근거상 강화 요인, 약화 요인, 아직 불확실한 점, 다음 확인 질문으로 나눠줘.",
    "매수/매도 의견이나 목표가는 쓰지 말아줘.",
  ].join(" ");
}

function buildMemoPrompt(company: WatchlistCompanySummary): string {
  return [
    `${company.ticker}에 대해 지금까지 확인할 리서치 내용을 개인 리서치 노트 형식으로 정리해줘.`,
    "요약, 핵심 근거, 리스크, 다음 확인 질문, 연결할 공시 기준을 구분해줘.",
  ].join(" ");
}

function buildSuggestedQuestions(company: WatchlistCompanySummary): string[] {
  const basis = company.latest_period
    ? `${company.latest_period} 공시 기준`
    : "최신 공시 기준";
  const companyLabel = company.companyNameKo ?? company.name;

  return [
    `${company.ticker}의 ${basis}으로 ${companyLabel}의 핵심 성장 변수와 리스크를 정리해줘.`,
    `${company.ticker}의 공시 기준으로 현재 thesis를 약화시킬 수 있는 신호가 무엇인지 점검해줘.`,
    `${company.ticker}의 다음 실적 또는 공시에서 확인해야 할 질문 3개를 만들어줘.`,
  ];
}

function normalizeQuestion(question: string): string {
  return question.replace(/\s+/g, " ").trim().toLowerCase();
}

function questionStatusLabel(status: UserCompanyQuestionStatus): string {
  if (status === "answered") return "해결";
  if (status === "dismissed") return "보류";
  return "열림";
}

function thesisStatusLabel(status: UserCompanyThesisStatus): string {
  return THESIS_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function noteTypeLabel(type: UserResearchNoteType): string {
  return NOTE_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

async function readPayload(response: Response): Promise<ApiPayload> {
  return response.json().catch(() => null);
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
