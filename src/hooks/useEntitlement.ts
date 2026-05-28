"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!enabled) {
      return;
    }

    try {
      const response = await fetch("/api/me/entitlement", {
        cache: "no-store",
        signal,
      });

      if (!response.ok) {
        throw new Error("entitlement_request_failed");
      }

      const payload = (await response.json()) as EntitlementResponse;
      if (!mountedRef.current) return;
      setEntitlement(payload.entitlement ?? null);
      setError(null);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      if (!mountedRef.current) return;
      setError("사용량 정보를 불러오지 못했습니다.");
      setEntitlement(null);
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void refresh(abortController.signal);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [enabled, refresh]);

  const refreshPublic = useCallback(() => refresh(), [refresh]);

  return { entitlement, loading, error, refresh: refreshPublic };
}
