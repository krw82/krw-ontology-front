"use client";

import { Pressable } from "@/components/ui/Pressable";

export type PwaInstallToastMode =
  | "offer"
  | "ios-instructions"
  | "prompting"
  | "failed";

export default function PwaInstallToast({
  isAppleMobile,
  mode,
  onInstall,
  onDismiss,
}: {
  isAppleMobile: boolean;
  mode: PwaInstallToastMode;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  const isInstructions = mode === "ios-instructions";
  const isPrompting = mode === "prompting";

  return (
    <div className="pwa-install-toast pointer-events-none fixed inset-x-0 z-[170] flex justify-center px-base pb-sm">
      <section
        className="pointer-events-auto flex w-full max-w-[520px] items-center gap-sm rounded-[14px] border border-hairline bg-canvas px-base py-sm text-ink shadow-[0_16px_48px_rgba(10,11,13,0.2)]"
        aria-label="KRW.O 앱 설치"
        role="status"
        aria-live="polite"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-black leading-5">
            {isInstructions
              ? "iPhone·iPad 홈 화면에 추가하세요"
              : "KRW.O를 앱처럼 바로 열기"}
          </p>
          <p className="mt-xxs text-[11px] leading-4 text-muted">
            {isInstructions
              ? "브라우저의 공유 버튼을 누른 뒤 ‘홈 화면에 추가’를 선택하면 됩니다."
              : mode === "failed"
                ? "설치를 시작하지 못했습니다. 브라우저 메뉴에서 다시 시도해 주세요."
                : "피드와 새 공시를 홈 화면에서 한 번에 열 수 있습니다."}
          </p>
        </div>
        <Pressable
          onClick={isInstructions ? onDismiss : onInstall}
          disabled={isPrompting}
          className="shrink-0 rounded-[10px] bg-primary px-sm text-[12px] font-black text-on-primary disabled:cursor-wait disabled:opacity-55"
        >
          {isPrompting
            ? "여는 중"
            : isInstructions
              ? "확인"
              : isAppleMobile
                ? "설치 방법"
                : "설치"}
        </Pressable>
        <Pressable
          onClick={onDismiss}
          disabled={isPrompting}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted disabled:opacity-40"
          hoverEffect="surface"
          aria-label="앱 설치 안내 닫기"
        >
          <span
            className="material-symbols-outlined text-[20px]"
            aria-hidden="true"
          >
            close
          </span>
        </Pressable>
      </section>
    </div>
  );
}
