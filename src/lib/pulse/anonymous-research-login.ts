/**
 * Anonymous pulse visitors lose the feed after login (their logged-in feed is
 * composed differently), so the login redirect must carry the research intent
 * itself. Route through /chat/new with the same query the logged-in
 * startResearch run would send — mirroring the company/news CTA pattern.
 */
export function anonymousResearchLoginHref(item: {
  ticker: string | null;
  title: string;
}): string | null {
  const ticker = item.ticker?.trim().toUpperCase() ?? "";
  if (!ticker) return null;

  const content = `${ticker} ${item.title}의 투자 관점과 근거를 확인해줘`;
  const chatParams = new URLSearchParams({ query: content, ticker });
  return `/login?next=${encodeURIComponent(`/chat/new?${chatParams.toString()}`)}`;
}
