import { describe, expect, it } from "vitest";
import {
  finalizeRunResponseContext,
  isCurrentRunResponseContext,
} from "./useChat";

describe("useChat run response context", () => {
  it("treats a response as stale after switching sessions", () => {
    expect(
      isCurrentRunResponseContext({
        generation: 4,
        currentGeneration: 4,
        targetSessionId: "session-a",
        activeSessionId: "session-b",
      }),
    ).toBe(false);
  });

  it("treats an older stream generation as stale", () => {
    expect(
      isCurrentRunResponseContext({
        generation: 4,
        currentGeneration: 5,
        targetSessionId: "session-a",
        activeSessionId: "session-a",
      }),
    ).toBe(false);
  });

  it("does not let stale cleanup clear the new session transport", () => {
    const staleController = new AbortController();
    const currentController = new AbortController();
    const abortRef = { current: currentController as AbortController | null };
    const activeRequestIdRef = { current: "request-b" as string | null };
    const sendInFlightRef = { current: true };

    finalizeRunResponseContext({
      generation: 4,
      currentGeneration: 5,
      targetSessionId: "session-a",
      activeSessionId: "session-b",
      requestId: "request-a",
      abortController: staleController,
      abortRef,
      activeRequestIdRef,
      sendInFlightRef,
    });

    expect(abortRef.current).toBe(currentController);
    expect(activeRequestIdRef.current).toBe("request-b");
    expect(sendInFlightRef.current).toBe(true);
  });

  it("releases the transport for the current response", () => {
    const currentController = new AbortController();
    const abortRef = { current: currentController as AbortController | null };
    const activeRequestIdRef = { current: "request-a" as string | null };
    const sendInFlightRef = { current: true };

    finalizeRunResponseContext({
      generation: 4,
      currentGeneration: 4,
      targetSessionId: "session-a",
      activeSessionId: "session-a",
      requestId: "request-a",
      abortController: currentController,
      abortRef,
      activeRequestIdRef,
      sendInFlightRef,
    });

    expect(abortRef.current).toBeNull();
    expect(activeRequestIdRef.current).toBeNull();
    expect(sendInFlightRef.current).toBe(false);
  });
});
