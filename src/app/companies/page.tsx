import TopNav from "@/components/TopNav";
import CompaniesBrowser from "@/components/CompaniesBrowser";
import { getAuthUser } from "@/lib/auth";
import { listIndexedCompanies } from "@/lib/ontology/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default async function CompaniesPage() {
  const [companies, user] = await Promise.all([
    listIndexedCompanies(),
    getAuthUser().catch(() => null),
  ]);
  const metadata = user?.user_metadata;
  const initialUserProfile = user?.email
    ? {
        email: user.email,
        name:
          stringValue(metadata?.full_name) ??
          stringValue(metadata?.name) ??
          stringValue(metadata?.display_name),
        avatarUrl:
          stringValue(metadata?.avatar_url) ??
          stringValue(metadata?.picture) ??
          stringValue(metadata?.photo_url),
      }
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <TopNav initialUserProfile={initialUserProfile} />
      <CompaniesBrowser initialCompanies={companies} />
    </div>
  );
}
