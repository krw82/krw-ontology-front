"use client";

import { useEffect, useState } from "react";

const COARSE_POINTER_QUERY = "(pointer: coarse)";

export function useCoarsePointer(): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(COARSE_POINTER_QUERY).matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(COARSE_POINTER_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return matches;
}
