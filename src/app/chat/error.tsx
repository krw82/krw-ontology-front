"use client";

function sanitizeError(message: string): string {
  const cleaned = message.split("\n")[0];
  const lower = cleaned.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("429")) {
    return "현재 KRW-AI 계정/API 요청 한도에 도달했습니다. 잠시 후 다시 시도하거나, 실제 ANTHROPIC_API_KEY를 설정한 뒤 서버를 재시작해주세요.";
  }
  if (cleaned.length > 200) return cleaned.slice(0, 200) + "...";
  return cleaned;
}

export default function ChatError({
  error,
  reset,
}: {
  error: Error;
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
        채팅 오류
      </h2>
      <p className="text-[16px] leading-[1.5] text-muted mb-lg max-w-[440px] text-center">
        {sanitizeError(error.message)}
      </p>
      <button
        onClick={reset}
        className="px-lg py-sm bg-primary-container text-on-primary rounded-full text-[16px] leading-[1.15] font-semibold hover:bg-primary-active transition-colors"
      >
        다시 시도
      </button>
    </div>
  );
}
