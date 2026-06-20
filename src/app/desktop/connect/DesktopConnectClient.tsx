"use client";

import { useState } from "react";

type Decision = "approve" | "deny";

export function DesktopConnectClient({
  requestId,
  accountEmail,
  deviceName,
  platform,
  arch,
  appVersion,
}: {
  requestId: string;
  accountEmail: string;
  deviceName: string;
  platform: string | null;
  arch: string | null;
  appVersion: string | null;
}) {
  const [pendingDecision, setPendingDecision] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callbackUri, setCallbackUri] = useState<string | null>(null);

  const decide = async (decision: Decision) => {
    if (pendingDecision) return;
    setPendingDecision(decision);
    setError(null);

    try {
      const response = await fetch(
        "/api/desktop/auth/authorization/approve",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            request_id: requestId,
            decision,
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false || !payload?.redirect_uri) {
        throw new Error(
          payload?.error?.public_message ??
            payload?.error?.message ??
            "Desktop 로그인 요청을 처리하지 못했습니다.",
        );
      }

      setCallbackUri(payload.redirect_uri);
      window.location.assign(payload.redirect_uri);
    } catch (decisionError) {
      setPendingDecision(null);
      setError(
        decisionError instanceof Error
          ? decisionError.message
          : "Desktop 로그인 요청을 처리하지 못했습니다.",
      );
    }
  };

  const metadata = [platform, arch, appVersion ? `v${appVersion}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mt-xl border-y border-hairline">
      <dl className="grid grid-cols-[120px_1fr] gap-x-md gap-y-sm py-lg text-[14px]">
        <dt className="font-semibold text-muted">계정</dt>
        <dd className="min-w-0 break-all font-bold text-ink">{accountEmail}</dd>
        <dt className="font-semibold text-muted">기기</dt>
        <dd className="font-bold text-ink">{deviceName}</dd>
        {metadata && (
          <>
            <dt className="font-semibold text-muted">앱 정보</dt>
            <dd className="font-semibold text-body">{metadata}</dd>
          </>
        )}
      </dl>

      <div className="border-t border-hairline py-lg">
        <p className="text-[13px] font-bold text-muted">허용되는 기능</p>
        <ul className="mt-sm space-y-xs text-[14px] font-semibold leading-6 text-body">
          <li>KRW 계정 및 이용권 확인</li>
          <li>KRW LLM gateway를 통한 AI 모델 사용</li>
          <li>사용량 기록 및 이 기기의 접근 권한 관리</li>
        </ul>
      </div>

      {error && (
        <p
          className="border-t border-error/25 bg-error-container px-sm py-sm text-[14px] font-semibold text-on-error-container"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col gap-sm border-t border-hairline py-lg sm:flex-row">
        <button
          type="button"
          onClick={() => decide("approve")}
          disabled={pendingDecision !== null}
          className="h-[46px] flex-1 rounded-[8px] bg-primary px-base text-[14px] font-extrabold text-on-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pendingDecision === "approve" ? "연결 중..." : "이 Mac 연결"}
        </button>
        <button
          type="button"
          onClick={() => decide("deny")}
          disabled={pendingDecision !== null}
          className="h-[46px] flex-1 rounded-[8px] border border-hairline bg-canvas px-base text-[14px] font-bold text-body disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pendingDecision === "deny" ? "거부 중..." : "거부"}
        </button>
      </div>

      {callbackUri && (
        <p className="pb-lg text-[13px] leading-5 text-muted">
          앱이 자동으로 열리지 않으면{" "}
          <a className="font-bold text-primary underline" href={callbackUri}>
            KRW Desktop으로 돌아가기
          </a>
          를 선택하세요.
        </p>
      )}
    </div>
  );
}
