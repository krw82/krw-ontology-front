"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import ChatSidebar from "@/components/ChatSidebar";

interface AppShellProps {
  children: React.ReactNode;
}

function shouldShowGlobalSidebar(pathname: string): boolean {
  return (
    pathname === "/chat" ||
    pathname.startsWith("/chat/") ||
    pathname === "/companies" ||
    pathname.startsWith("/companies/")
  );
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const reducedMotion = useReducedMotion();
  const showSidebar = shouldShowGlobalSidebar(pathname);
  const pageEntrance = {
    opacity: 1,
    y: 0,
    transition: {
      duration: reducedMotion ? 0 : 0.24,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  };

  if (!showSidebar) {
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

  const activeSessionId = searchParams.get("sessionId");
  const refreshSignal = `${pathname}?${searchParams.toString()}`;

  return (
    <div className="flex h-[100dvh] min-h-0 w-full overflow-hidden bg-canvas">
      <ChatSidebar
        activeSessionId={activeSessionId}
        refreshSignal={refreshSignal}
      />
      <motion.div
        key={pathname}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={pageEntrance}
      >
        {children}
      </motion.div>
    </div>
  );
}
