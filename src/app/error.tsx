"use client";

import { toUserFacingBoundaryError } from "@/lib/chat/user-facing-error";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-xl bg-canvas">
      <div className="w-16 h-16 bg-error-container/10 rounded-full flex items-center justify-center mb-lg">
        <span className="material-symbols-outlined text-[32px] text-error">
          error
        </span>
      </div>
      <h2 className="text-[20px] leading-[1.4] font-semibold text-ink mb-sm">
        오류가 발생했습니다
      </h2>
      <p className="text-[16px] leading-[1.5] text-muted mb-lg max-w-[440px] text-center">
        {toUserFacingBoundaryError(error.message)}
      </p>
      {error.digest && (
        <p className="mb-base font-mono text-[12px] font-bold tracking-[0.08em] text-muted">
          문의 코드: {error.digest}
        </p>
      )}
      <button
        onClick={reset}
        className="px-lg py-sm bg-primary-container text-on-primary rounded-full text-[16px] leading-[1.15] font-semibold hover:bg-primary-active transition-colors"
      >
        다시 시도
      </button>
    </div>
  );
}
