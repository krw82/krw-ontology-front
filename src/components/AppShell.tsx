"use client";

import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import ChatSidebar from "@/components/ChatSidebar";
import TopNav, { type TopNavUserProfile } from "@/components/TopNav";
import ProductOnboardingTour from "@/components/ProductOnboardingTour";
import WorkspaceScrollRestoration from "@/components/navigation/WorkspaceScrollRestoration";
import { stripLocalePrefix } from "@/i18n/routing";
import { getWorkspaceShellMode } from "@/lib/navigation/workspace-routes";

const IS_DEV_ENV = process.env.NODE_ENV === "development";

interface AppShellProps {
  children: React.ReactNode;
  initialUserProfile?: TopNavUserProfile | null;
  initialAuthResolved?: boolean;
  preserveInitialUserProfile?: boolean;
}

function WorkspaceHeaderFallback() {
  return (
    <div
      aria-hidden="true"
      className="sticky top-0 z-50 h-[72px] w-full flex-shrink-0 border-b border-hairline bg-canvas/95 md:h-[64px]"
    >
      <div className="mx-auto flex h-full w-full max-w-[1600px] items-center justify-between gap-sm px-base sm:px-md">
        <div className="flex items-center gap-sm">
          <div className="h-11 w-11 rounded-[8px] border border-hairline bg-surface-soft" />
          <div className="h-6 w-20 rounded bg-surface-soft" />
        </div>
        <div className="h-11 w-11 rounded-[8px] bg-surface-soft" />
      </div>
    </div>
  );
}

function BrowseOnboardingLayer({ pathname }: { pathname: string }) {
  const searchParams = useSearchParams();
  const forceLegacyTour = searchParams.get("tour") === "1";
  const onboardingContinuePath = searchParams.get("continue");

  if (!forceLegacyTour && !IS_DEV_ENV) return null;

  return (
    <ProductOnboardingTour
      pathname={pathname}
      force={forceLegacyTour}
      continuePath={onboardingContinuePath}
    />
  );
}

function ChatWorkspaceShell({
  children,
  pathname,
}: {
  children: React.ReactNode;
  pathname: string;
}) {
  const searchParams = useSearchParams();
  const unlocalizedPathname = stripLocalePrefix(pathname);
  const activeSessionId = searchParams.get("sessionId");
  const refreshSignal = `${pathname}?${searchParams.toString()}`;
  const forceOnboarding =
    searchParams.get("tour") === "1" || searchParams.get("onboarding") === "1";
  const onboardingContinuePath = searchParams.get("continue");

  return (
    <div className="min-h-[100dvh] w-full bg-canvas md:flex md:h-[100dvh] md:min-h-[100svh] md:overflow-hidden">
      <div className="min-w-0 md:flex md:min-h-0 md:flex-1 md:flex-col md:overflow-hidden">
        {children}
      </div>
      <ChatSidebar activeSessionId={activeSessionId} refreshSignal={refreshSignal} />
      {unlocalizedPathname === "/chat" ||
      unlocalizedPathname.startsWith("/chat/") ? (
        <ProductOnboardingTour
          pathname={pathname}
          tour="chat"
          force={forceOnboarding}
          continuePath={onboardingContinuePath}
        />
      ) : null}
    </div>
  );
}

function ChatWorkspaceFallback({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] w-full bg-canvas md:flex md:h-[100dvh] md:min-h-[100svh] md:overflow-hidden">
      <div className="min-w-0 md:flex md:min-h-0 md:flex-1 md:flex-col md:overflow-hidden">
        {children}
      </div>
    </div>
  );
}

export default function AppShell({
  children,
  initialUserProfile = null,
  initialAuthResolved = false,
  preserveInitialUserProfile = false,
}: AppShellProps) {
  const pathname = usePathname();
  const unlocalizedPathname = stripLocalePrefix(pathname);
  const shellMode = getWorkspaceShellMode(pathname);

  if (shellMode === "standard") {
    const isCompanyWorkspace =
      unlocalizedPathname === "/companies" ||
      unlocalizedPathname.startsWith("/companies/");
    const showLocaleSwitcher =
      isCompanyWorkspace ||
      unlocalizedPathname === "/institutional-holdings" ||
      unlocalizedPathname.startsWith("/institutional-holdings/");
    const isEnglishCompanyPath = pathname.startsWith("/en/companies");

    return (
      <div className="flex min-h-[100dvh] w-full flex-col bg-canvas text-ink">
        <Suspense fallback={<WorkspaceHeaderFallback />}>
          <TopNav
            initialUserProfile={initialUserProfile}
            initialAuthResolved={initialAuthResolved}
            preserveInitialUserProfile={preserveInitialUserProfile}
            brandHref="/pulse"
            brandAriaLabel={
              isEnglishCompanyPath ? "Go to Pulse" : "펄스로 이동"
            }
            showLocaleSwitcher={showLocaleSwitcher}
          />
        </Suspense>
        <div
          className="min-w-0 flex-1"
          data-workspace-scroll-content
        >
          {children}
        </div>
        <Suspense fallback={null}>
          <WorkspaceScrollRestoration />
        </Suspense>
        {isCompanyWorkspace && unlocalizedPathname === "/companies" ? (
          <Suspense fallback={null}>
            <BrowseOnboardingLayer pathname={pathname} />
          </Suspense>
        ) : null}
      </div>
    );
  }

  if (shellMode === "immersive") {
    return (
      <Suspense fallback={<ChatWorkspaceFallback>{children}</ChatWorkspaceFallback>}>
        <ChatWorkspaceShell pathname={pathname}>{children}</ChatWorkspaceShell>
      </Suspense>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  );
}
