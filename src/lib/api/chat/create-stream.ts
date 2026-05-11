/**
 * Creates the SSE response object with the given ReadableStream body.
 * Returns the standard headers for server-sent events.
 */
export function createSSEResponse(body: ReadableStream): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
