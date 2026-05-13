import TopNav from "@/components/TopNav";
import CompaniesBrowser from "@/components/CompaniesBrowser";
import { listIndexedCompanies } from "@/lib/ontology/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const companies = await listIndexedCompanies();

  return (
    <div className="flex min-h-[100dvh] flex-col overflow-x-hidden">
      <TopNav />
      <CompaniesBrowser initialCompanies={companies} />
    </div>
  );
}
