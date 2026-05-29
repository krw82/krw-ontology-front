export const OPEN_CHAT_SIDEBAR_EVENT = "krw:open-chat-sidebar";

export function dispatchOpenChatSidebar(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_CHAT_SIDEBAR_EVENT));
}
