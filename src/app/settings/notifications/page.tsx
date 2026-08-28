import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import NotificationSettingsCard from "@/components/filings/NotificationSettingsCard";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "알림 설정",
  description: "푸시 알림과 공시·뉴스 알림 종류를 설정합니다.",
};

export default async function NotificationSettingsPage() {
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/settings/notifications");
  return (
    <div className="bg-canvas text-ink">
      <main
        id="main-content"
        className="mx-auto w-full max-w-2xl px-base pb-2xl pt-lg sm:pt-xl"
      >
        <Link
          href="/settings"
          className="-ml-sm inline-flex min-h-11 items-center gap-xxs rounded-[8px] px-sm text-[13px] font-bold text-muted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-[18px]"
          >
            arrow_back
          </span>
          설정
        </Link>
        <header className="mt-xs">
          <p className="font-mono text-[11px] font-black uppercase tracking-[0.2em] text-primary">
            Notifications
          </p>
          <h1 className="mt-sm text-[32px] font-black leading-none tracking-[-0.05em] text-ink sm:text-[36px]">
            알림
          </h1>
          <p className="mt-sm text-[14px] font-medium leading-6 text-body sm:text-[15px]">
            관심 기업의 새 소식을 받을 방식을 정하세요.
          </p>
        </header>
        <section className="mt-lg">
          <NotificationSettingsCard />
        </section>
      </main>
    </div>
  );
}
