/**
 * Rust 리서치 엔진이 채팅 첨부·URL 컨텍스트를 받기 전까지 업로드 UI를 끄는
 * 스위치. /api/chat/run이 attachment_ids/user_urls를 400으로 거부하는 동안에는
 * true로 되돌리지 않는다.
 */
export const CHAT_ATTACHMENT_CONTEXT_SUPPORTED = false;
