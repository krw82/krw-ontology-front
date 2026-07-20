import { redirect } from "next/navigation";
import ChatPageClient from "@/app/chat/ChatPageClient";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const user = await getAuthUser().catch(() => null);
  if (!user) {
    redirect("/login?next=/discover");
  }

  return <ChatPageClient draftOwnerId={user.id} />;
}
