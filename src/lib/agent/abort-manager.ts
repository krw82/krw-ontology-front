// NOTE: This in-memory implementation only works in single-instance deployments.
// For multi-instance, replace with DB status polling or Redis pub/sub.

const activeControllers = new Map<string, AbortController>();

export function registerRun(runId: string): AbortController {
  const controller = new AbortController();
  activeControllers.set(runId, controller);
  return controller;
}

export function abortRun(runId: string): boolean {
  const controller = activeControllers.get(runId);
  if (!controller) return false;
  controller.abort();
  activeControllers.delete(runId);
  return true;
}

export function cleanupRun(runId: string) {
  // Idempotent: delete on a missing key is a no-op
  activeControllers.delete(runId);
}

export function unregisterRun(runId: string) {
  activeControllers.delete(runId);
}
