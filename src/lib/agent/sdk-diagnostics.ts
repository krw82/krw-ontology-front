import type { SdkDiagnostics } from "@/lib/agent/runner";

const SENSITIVE_DIAGNOSTIC_KEYS = new Set([
  "cwd",
  "pluginPath",
  "promptPreview",
]);

export function isSdkDiagnosticsEnabled(): boolean {
  return process.env.CLAUDE_SDK_DIAGNOSTICS === "1";
}

export function sanitizeSdkDiagnosticsRecord(
  diagnostics: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(diagnostics).filter(
      ([key, value]) =>
        value !== undefined && !SENSITIVE_DIAGNOSTIC_KEYS.has(key),
    ),
  );
}

export function mergeSdkDiagnosticsForPersistence(
  current: Record<string, unknown>,
  diagnostics: SdkDiagnostics,
  now = new Date(),
): Record<string, unknown> {
  const currentSafe = sanitizeSdkDiagnosticsRecord(current);
  const nextSafe = sanitizeSdkDiagnosticsRecord(
    diagnostics as unknown as Record<string, unknown>,
  );
  const merged: Record<string, unknown> = {
    ...currentSafe,
    ...nextSafe,
    updatedAt: now.toISOString(),
  };

  if (
    !Array.isArray(nextSafe.observedModels) &&
    Array.isArray(currentSafe.observedModels)
  ) {
    merged.observedModels = currentSafe.observedModels;
  }

  return merged;
}
