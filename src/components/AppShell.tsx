"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import ChatSidebar from "@/components/ChatSidebar";
import ProductOnboardingTour from "@/components/ProductOnboardingTour";
import { stripLocalePrefix } from "@/i18n/routing";

interface AppShellProps {
  children: React.ReactNode;
}

function isBrowseWorkspace(pathname: string): boolean {
  return (
    pathname === "/companies" ||
    pathname.startsWith("/companies/")
  );
}

function isChatWorkspace(pathname: string): boolean {
  return (
    pathname === "/discover" ||
    pathname === "/chat" ||
    pathname.startsWith("/chat/")
  );
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const reducedMotion = useReducedMotion();
  const unlocalizedPathname = stripLocalePrefix(pathname);
  const isBrowse = isBrowseWorkspace(unlocalizedPathname);
  const isChat = isChatWorkspace(unlocalizedPathname);
  const activeSessionId = searchParams.get("sessionId");
  const refreshSignal = `${pathname}?${searchParams.toString()}`;
  const forceOnboarding =
    searchParams.get("tour") === "1" || searchParams.get("onboarding") === "1";
  const forceLegacyTour = searchParams.get("tour") === "1";
  const onboardingContinuePath = searchParams.get("continue");
  const pageEntrance = {
    opacity: 1,
    y: 0,
    transition: {
      duration: reducedMotion ? 0 : 0.24,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  };

  if (isBrowse) {
    return (
      <div className="min-h-[100dvh] w-full bg-canvas">
        <motion.div
          key={pathname}
          className="min-w-0"
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={pageEntrance}
        >
          {children}
        </motion.div>
        {unlocalizedPathname === "/companies" && forceLegacyTour ? (
          <ProductOnboardingTour
            pathname={pathname}
            force={forceLegacyTour}
            continuePath={onboardingContinuePath}
          />
        ) : null}
      </div>
    );
  }

  if (isChat) {
    return (
      <div className="min-h-[100dvh] w-full bg-canvas md:flex md:h-[100dvh] md:min-h-[100svh] md:overflow-hidden">
        <motion.div
          key={pathname}
          className="min-w-0 md:flex md:min-h-0 md:flex-1 md:flex-col md:overflow-hidden"
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={pageEntrance}
        >
          {children}
        </motion.div>
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

  return (
    <motion.div
      key={pathname}
      className="flex min-h-0 flex-1 flex-col"
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={pageEntrance}
    >
      {children}
    </motion.div>
  );
}
