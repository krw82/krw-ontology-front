import ChatPageClient from "./ChatPageClient";
import { redirect } from "next/navigation";

type ChatPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function buildDraftRedirectHref(
  searchParams: Awaited<ChatPageProps["searchParams"]>,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "sessionId") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
      continue;
    }
    if (value != null) params.set(key, value);
  }

  const query = params.toString();
  return `/chat/new${query ? `?${query}` : ""}`;
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const resolvedSearchParams = await searchParams;
  const sessionId = firstParam(resolvedSearchParams.sessionId);

  if (!sessionId) {
    redirect(buildDraftRedirectHref(resolvedSearchParams));
  }

  return <ChatPageClient />;
}
