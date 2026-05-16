"use client";

import { usePathname, useSearchParams } from "next/navigation";
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
  const showSidebar = shouldShowGlobalSidebar(pathname);

  if (!showSidebar) {
    return <>{children}</>;
  }

  const activeSessionId = searchParams.get("sessionId");
  const refreshSignal = `${pathname}?${searchParams.toString()}`;

  return (
    <div className="flex h-[100dvh] min-h-0 w-full overflow-hidden bg-canvas">
      <ChatSidebar
        activeSessionId={activeSessionId}
        refreshSignal={refreshSignal}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
