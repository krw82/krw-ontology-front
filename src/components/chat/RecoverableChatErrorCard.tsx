"use client";

type RecoverableChatErrorCardProps = {
  message: string;
  supportCode: string;
  canRetry: boolean;
  hasPriorEvidence: boolean;
  onRetry: () => void;
  onShowPriorEvidence: () => void;
};

export default function RecoverableChatErrorCard({
  message,
  supportCode,
  canRetry,
  hasPriorEvidence,
  onRetry,
  onShowPriorEvidence,
}: RecoverableChatErrorCardProps) {
  return (
    <section
      className="rounded-[8px] border border-error/20 bg-error-container/10 p-base text-ink sm:p-lg"
      role="alert"
      aria-labelledby="chat-run-error-title"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="material-symbols-outlined mt-0.5 text-[20px] text-error"
        >
          error
        </span>
        <div className="min-w-0">
          <h2
            id="chat-run-error-title"
            className="text-[17px] font-black leading-6 text-ink sm:text-[18px]"
          >
            분석을 완료하지 못했습니다.
          </h2>
          <p className="mt-1 text-[14px] font-medium leading-6 text-body sm:text-[15px]">
            {message}
          </p>
          {canRetry && (
            <p className="mt-1 text-[13px] font-semibold leading-5 text-muted">
              방금 질문을 그대로 다시 시도할 수 있습니다.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-error/15 pt-3">
        {canRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-11 items-center justify-center rounded-[8px] bg-primary px-4 text-[13px] font-extrabold text-on-primary transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            다시 시도
          </button>
        )}
        {hasPriorEvidence && (
          <button
            type="button"
            onClick={onShowPriorEvidence}
            className="inline-flex h-11 items-center justify-center rounded-[8px] border border-hairline bg-canvas px-4 text-[13px] font-extrabold text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            기존 근거 보기
          </button>
        )}
      </div>

      <p className="mt-3 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
        문의 코드: {supportCode}
      </p>
    </section>
  );
}
