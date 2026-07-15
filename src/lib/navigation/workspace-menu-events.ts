export const OPEN_WORKSPACE_MENU_EVENT = "krw:open-workspace-menu";

export function dispatchOpenWorkspaceMenu(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_MENU_EVENT));
}
