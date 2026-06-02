import { afterEach, describe, expect, it, vi } from "vitest";
import type { SdkDiagnostics } from "@/lib/agent/runner";
import {
  isSdkDiagnosticsEnabled,
  mergeSdkDiagnosticsForPersistence,
} from "@/lib/agent/sdk-diagnostics";

describe("SDK diagnostics persistence", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires an explicit diagnostics flag even in dev-like environments", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WEB_COMMIT", "dev");
    vi.stubEnv("CLAUDE_SDK_DIAGNOSTICS", "0");

    expect(isSdkDiagnosticsEnabled()).toBe(false);

    vi.stubEnv("CLAUDE_SDK_DIAGNOSTICS", "1");

    expect(isSdkDiagnosticsEnabled()).toBe(true);
  });

  it("drops prompts and local paths before persistence", () => {
    const merged = mergeSdkDiagnosticsForPersistence(
      {
        observedModels: ["claude-opus-4-5"],
        promptPreview: "old prompt",
        cwd: "/Users/example/private",
      },
      {
        observedAt: "2026-05-31T00:00:00.000Z",
        requestedModel: "claude-sonnet-4-5",
        cwd: "/Users/example/private/project",
        pluginPath: "/Users/example/private/plugin",
        promptPreview: "sensitive prompt",
      } satisfies SdkDiagnostics,
      new Date("2026-05-31T01:00:00.000Z"),
    );

    expect(merged).toMatchObject({
      observedAt: "2026-05-31T00:00:00.000Z",
      requestedModel: "claude-sonnet-4-5",
      observedModels: ["claude-opus-4-5"],
      updatedAt: "2026-05-31T01:00:00.000Z",
    });
    expect(merged).not.toHaveProperty("cwd");
    expect(merged).not.toHaveProperty("pluginPath");
    expect(merged).not.toHaveProperty("promptPreview");
  });
});
