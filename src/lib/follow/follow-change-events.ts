/**
 * 같은 화면에 관심 버튼이 여러 개 마운트되는 경우(챗 헤더 + 답변 CTA),
 * 한 인스턴스의 follow/unfollow 성공을 나머지 인스턴스에 알려 상태를
 * 다시 조회하게 만드는 티커별 이벤트 채널. 브라우저 탭 간 동기화는
 * 범위 밖이다(마운트 시 조회가 다음 방문을 커버한다).
 */
type FollowChangeListener = () => void;

const listenersByTicker = new Map<string, Set<FollowChangeListener>>();

export function subscribeFollowChange(
  ticker: string,
  listener: FollowChangeListener,
): () => void {
  const listeners = listenersByTicker.get(ticker) ?? new Set();
  listeners.add(listener);
  listenersByTicker.set(ticker, listeners);
  return () => {
    const current = listenersByTicker.get(ticker);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listenersByTicker.delete(ticker);
  };
}

export function emitFollowChange(ticker: string): void {
  const listeners = listenersByTicker.get(ticker);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    listener();
  }
}
