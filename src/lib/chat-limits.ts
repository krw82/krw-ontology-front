export const MAX_CHAT_MESSAGE_CHARS = 20_000;
export const MAX_CHAT_PAYLOAD_CHARS = 120_000;

export function getChatContentLimit(content: string): number {
  return content.includes("<attached_file name=")
    ? MAX_CHAT_PAYLOAD_CHARS
    : MAX_CHAT_MESSAGE_CHARS;
}
