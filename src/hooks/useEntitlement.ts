"use client";

import { useCallback, useEffect, useState } from "react";
import type { EntitlementStatus } from "@/types/entitlement";

interface EntitlementResponse {
  entitlement?: EntitlementStatus;
}

interface UseEntitlementResult {
  entitlement: EntitlementStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useEntitlement(enabled = true): UseEntitlementResult {
  const [entitlement, setEntitlement] = useState<EntitlementStatus | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }

    try {
      const response = await fetch("/api/me/entitlement", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("entitlement_request_failed");
      }

      const payload = (await response.json()) as EntitlementResponse;
      setEntitlement(payload.entitlement ?? null);
      setError(null);
    } catch {
      setError("사용량 정보를 불러오지 못했습니다.");
      setEntitlement(null);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const timeoutId = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [enabled, refresh]);

  return { entitlement, loading, error, refresh };
}
