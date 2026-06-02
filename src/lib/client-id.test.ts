import { afterEach, describe, expect, it, vi } from "vitest";
import { createClientId } from "@/lib/client-id";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("createClientId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps fallback IDs compatible with request UUID validation", () => {
    vi.stubGlobal("crypto", undefined);

    expect(createClientId()).toMatch(UUID_V4_PATTERN);
  });
});
