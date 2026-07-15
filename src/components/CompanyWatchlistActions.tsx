"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import { trackClientEventWithTimeout } from "@/lib/analytics/client";
import { cn } from "@/lib/utils";
import CompanyFilingSubscriptionControl from "@/components/filings/CompanyFilingSubscriptionControl";

type WatchlistAction = "watchlist" | "holding";

type CompanyWatchlistActionsProps = {
  ticker: string;
  isAuthenticated: boolean;
  loginHref: string;
  destinationHref: string;
  initialSavedAction?: WatchlistAction | null;
  labels: {
    watchlist: string;
    holding: string;
    savedWatchlist: string;
    savedHolding: string;
    saving: string;
    error: string;
  };
  analyticsProperties?: Record<string, unknown>;
};

export default function CompanyWatchlistActions({
  ticker,
  isAuthenticated,
  loginHref,
  destinationHref,
  initialSavedAction = null,
  labels,
  analyticsProperties,
}: CompanyWatchlistActionsProps) {
  const [pendingAction, setPendingAction] = useState<WatchlistAction | null>(null);
  const [savedAction, setSavedAction] = useState<WatchlistAction | null>(
    initialSavedAction,
  );
  const [error, setError] = useState<string | null>(null);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row">
        <WatchlistLink href={loginHref} icon="bookmark">
          {labels.watchlist}
        </WatchlistLink>
        <WatchlistLink href={loginHref} icon="inventory_2" emphasis>
          {labels.holding}
        </WatchlistLink>
        <CompanyFilingSubscriptionControl ticker={ticker} loginHref={loginHref} isAuthenticated={false} />
      </div>
    );
  }

  const saveMark = async (action: WatchlistAction) => {
    const removingCurrentAction = savedAction === action;
    setPendingAction(action);
    setError(null);

    try {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          is_watchlisted: !removingCurrentAction,
          is_holding: removingCurrentAction ? false : action === "holding",
        }),
      });

      if (!response.ok) {
        throw new Error((await readErrorMessage(response)) ?? labels.error);
      }

      void trackClientEventWithTimeout("cta_clicked", {
        cta_id: removingCurrentAction
          ? `company_${action}_remove`
          : `company_${action}`,
        cta_label: action === "holding" ? labels.holding : labels.watchlist,
        surface: "company_hero",
        ticker,
        action,
        selected: !removingCurrentAction,
        destination: destinationHref,
        ...analyticsProperties,
      });
      if (!removingCurrentAction && action === "watchlist") {
        void trackClientEventWithTimeout("company_followed", {
          ticker,
          surface: "company_hero",
        });
      }

      setSavedAction(removingCurrentAction ? null : action);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : labels.error);
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row">
        <WatchlistButton
          icon={savedAction === "watchlist" ? "check" : "bookmark"}
          selected={savedAction === "watchlist"}
          disabled={pendingAction !== null}
          onClick={() => void saveMark("watchlist")}
        >
          {buttonLabel({
            action: "watchlist",
            labels,
            pendingAction,
            savedAction,
          })}
        </WatchlistButton>
        <WatchlistButton
          icon={savedAction === "holding" ? "check" : "inventory_2"}
          emphasis
          selected={savedAction === "holding"}
          disabled={pendingAction !== null}
          onClick={() => void saveMark("holding")}
        >
          {buttonLabel({
            action: "holding",
            labels,
            pendingAction,
            savedAction,
          })}
        </WatchlistButton>
      </div>
      <CompanyFilingSubscriptionControl ticker={ticker} loginHref={loginHref} isAuthenticated />
      {error ? (
        <p className="mt-2 text-[13px] font-bold leading-5 text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function WatchlistLink({
  href,
  icon,
  emphasis = false,
  children,
}: {
  href: string;
  icon: string;
  emphasis?: boolean;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={actionClassName(emphasis)}>
      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
        {icon}
      </span>
      {children}
    </Link>
  );
}

function WatchlistButton({
  icon,
  emphasis = false,
  selected = false,
  disabled,
  onClick,
  children,
}: {
  icon: string;
  emphasis?: boolean;
  selected?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      className={actionClassName(emphasis, selected)}
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
        {icon}
      </span>
      {children}
    </button>
  );
}

function buttonLabel({
  action,
  labels,
  pendingAction,
  savedAction,
}: {
  action: WatchlistAction;
  labels: CompanyWatchlistActionsProps["labels"];
  pendingAction: WatchlistAction | null;
  savedAction: WatchlistAction | null;
}) {
  if (pendingAction === action) return labels.saving;
  if (savedAction === action) {
    return action === "holding" ? labels.savedHolding : labels.savedWatchlist;
  }
  return action === "holding" ? labels.holding : labels.watchlist;
}

function actionClassName(emphasis: boolean, selected = false) {
  return cn(
    "inline-flex min-h-12 items-center justify-center gap-1 rounded-[8px] px-5 py-3 text-[15px] font-extrabold leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60",
    selected
      ? "border border-primary bg-primary-fixed text-on-primary-fixed hover:border-primary hover:bg-primary-fixed"
      : null,
    !selected && emphasis
      ? "border border-hairline bg-canvas text-ink hover:border-primary hover:text-primary"
      : null,
    !selected && !emphasis
      ? "border border-hairline bg-canvas text-ink hover:border-primary hover:text-primary"
      : null,
  );
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: unknown };
    };
    return typeof payload.error?.message === "string"
      ? payload.error.message
      : null;
  } catch {
    return null;
  }
}
