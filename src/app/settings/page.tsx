import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETTINGS_ENTRIES = [
  {
    href: "/settings/billing",
    icon: "credit_card",
    eyebrow: "PLAN & BILLING",
    title: "플랜 및 결제",
    description:
      "현재 플랜과 사용 가능 기능, 구독 변경·결제·환불을 확인합니다.",
  },
] as const;

export default async function SettingsPage() {
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/settings");

  return (
    <div className="min-h-full bg-canvas text-ink">
      <main
        id="main-content"
        className="mx-auto w-full max-w-4xl px-base py-2xl sm:px-xl md:py-3xl"
      >
        <header className="max-w-2xl">
          <p className="font-mono text-[11px] font-black uppercase tracking-[0.2em] text-primary">
            Account settings
          </p>
          <h1 className="mt-sm text-[36px] font-black leading-none tracking-[-0.05em] text-ink sm:text-[44px]">
            설정
          </h1>
          <p className="mt-base text-[15px] font-medium leading-7 text-body sm:text-[17px]">
            플랜과 결제를 관리하세요.
          </p>
          <p className="mt-sm text-[13px] font-semibold text-muted">
            {user.email}
          </p>
        </header>

        <section className="mt-xl" aria-labelledby="settings-categories-heading">
          <div className="flex items-end justify-between gap-base">
            <div>
              <p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-primary">
                Manage
              </p>
              <h2
                id="settings-categories-heading"
                className="mt-xs text-[22px] font-black tracking-[-0.035em] text-ink"
              >
                플랜 및 결제
              </h2>
            </div>
          </div>

          <div className="mt-base grid w-full max-w-[420px] grid-cols-1 gap-sm">
            {SETTINGS_ENTRIES.map((entry) => (
              <Link
                key={entry.href}
                href={entry.href}
                className="group flex min-h-[220px] flex-col rounded-[12px] border border-hairline bg-white p-lg shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/55 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <span className="flex size-11 items-center justify-center rounded-[10px] bg-primary-fixed text-primary transition-colors group-hover:bg-primary group-hover:text-on-primary">
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-[22px]"
                  >
                    {entry.icon}
                  </span>
                </span>
                <p className="mt-lg font-mono text-[10px] font-black uppercase tracking-[0.15em] text-primary">
                  {entry.eyebrow}
                </p>
                <h3 className="mt-xs text-[20px] font-black tracking-[-0.03em] text-ink">
                  {entry.title}
                </h3>
                <p className="mt-sm text-[13px] font-medium leading-6 text-muted">
                  {entry.description}
                </p>
                <span className="mt-auto inline-flex items-center gap-1 pt-lg text-[13px] font-extrabold text-primary">
                  설정 열기
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-[18px]"
                  >
                    arrow_forward
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
