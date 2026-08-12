import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import ChatPageClient from "../ChatPageClient";

export default async function NewChatPage() {
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/chat/new");

  return <ChatPageClient draftOwnerId={user.id} />;
}
