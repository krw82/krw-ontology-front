"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import CompanyCard, {
  type CompanyCardData,
} from "@/components/CompanyCard";
import FloatingAskBar from "@/components/FloatingAskBar";

type CompaniesResponse = {
  companies: CompanyCardData[];
  count: number;
};

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<CompanyCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"relevance" | "ticker">("relevance");

  useEffect(() => {
    let stale = false;

    async function loadCompanies() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/companies", { cache: "no-store" });
        const data = (await res.json()) as CompaniesResponse;
        if (!res.ok) throw new Error("Failed to load company index");
        if (!stale) setCompanies(data.companies);
      } catch (err) {
        if (!stale) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load company index",
          );
        }
      } finally {
        if (!stale) setLoading(false);
      }
    }

    loadCompanies();
    return () => {
      stale = true;
    };
  }, []);

  const filteredCompanies = useMemo(() => {
    let nextCompanies = companies;

    if (search.trim()) {
      const q = search.toLowerCase();
      nextCompanies = nextCompanies.filter(
        (c) =>
          c.ticker.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          (c.coverage ?? "").toLowerCase().includes(q) ||
          (c.core_strength ?? "").toLowerCase().includes(q) ||
          (c.critical_risk ?? "").toLowerCase().includes(q),
      );
    }

    if (sortBy === "ticker") {
      nextCompanies = [...nextCompanies].sort((a, b) =>
        a.ticker.localeCompare(b.ticker),
      );
    }

    return nextCompanies;
  }, [companies, search, sortBy]);

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />

      <div className="flex flex-1 max-w-[1600px] mx-auto w-full relative">
        <main className="flex-grow w-full px-md md:px-xl pt-[96px] pb-[96px] overflow-y-auto">
          {/* Header Section */}
          <header className="mb-[96px]">
            <h1 className="text-[64px] leading-[1.0] tracking-[-1.6px] font-normal text-ink mb-lg">
              Company Browser
            </h1>
            <p className="text-[32px] leading-[1.13] tracking-[-0.4px] font-normal text-body max-w-3xl">
              Browse the companies currently available in the local ontology
              index before starting an evidence-grounded chat.
            </p>
            <div className="mt-md text-[16px] leading-[1.5] font-medium text-muted">
              {loading
                ? "Loading indexed companies..."
                : `${companies.length} indexed companies available`}
            </div>
          </header>

          {/* Search & Filter Controls */}
          <section className="mb-xl flex flex-col md:flex-row gap-base items-center justify-between bg-canvas p-base rounded-[24px] border border-hairline shadow-sm">
            <div className="w-full md:w-1/2 relative">
              <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-outline text-[32px]">
                search
              </span>
              <input
                className="w-full bg-surface rounded-[24px] h-[48px] pl-12 pr-sm border border-hairline focus:border-primary-container focus:ring-0 text-[16px] leading-[1.5] font-normal transition-colors focus:outline-none"
                placeholder="Search entity graph..."
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search companies"
              />
            </div>
            <div className="flex gap-sm w-full md:w-auto overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
              {/* L-03: Removed no-op Filter button */}
              <button
                className="px-md py-sm bg-surface-strong rounded-full text-[16px] leading-[1.15] font-semibold text-ink whitespace-nowrap hover:bg-surface-dim transition-colors"
                type="button"
                onClick={() =>
                  setSortBy(sortBy === "relevance" ? "ticker" : "relevance")
                }
              >
                Sort by: {sortBy === "relevance" ? "Relevance" : "Ticker A-Z"}
              </button>
            </div>
          </section>

          {error && (
            <div className="mb-xl rounded-[16px] border border-error/20 bg-error-container/10 p-lg text-error text-[16px] leading-[1.5]">
              <span className="material-symbols-outlined text-[18px] mr-xs align-middle">
                error
              </span>
              {error}
            </div>
          )}

          {/* Entity Grid */}
          {loading ? (
            <div
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-lg"
              aria-busy="true"
            >
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="bg-canvas border border-hairline rounded-[24px] p-lg animate-pulse"
                >
                  <div className="h-10 w-28 bg-surface-soft rounded mb-sm" />
                  <div className="h-4 w-44 bg-surface-soft rounded mb-lg" />
                  <div className="space-y-sm">
                    <div className="h-4 bg-surface-soft rounded" />
                    <div className="h-4 bg-surface-soft rounded w-5/6" />
                    <div className="h-4 bg-surface-soft rounded w-2/3" />
                  </div>
                  <div className="h-px bg-hairline-soft my-lg" />
                  <div className="h-4 bg-surface-soft rounded w-3/4" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-lg">
              {filteredCompanies.map((company) => (
                <CompanyCard key={company.ticker} company={company} />
              ))}
            </div>
          )}

          {!loading && filteredCompanies.length === 0 && (
            <div className="text-center py-xxl">
              <p className="text-[18px] leading-[1.33] font-semibold text-muted">
                No companies found matching your search.
              </p>
            </div>
          )}

          {/* Footer */}
          <footer className="w-full py-[96px] border-t border-hairline mt-[96px]">
            <div className="flex flex-col md:flex-row justify-between items-center w-full gap-lg">
              <div className="text-[16px] leading-[1.25] font-semibold text-ink">
                &copy; 2026 KRW Ontology. Institutional-grade research and data
                analysis.
              </div>
              <div className="flex gap-lg flex-wrap justify-center">
                {["Legal", "Privacy", "Methodology", "Disclosure", "API"].map(
                  (link) => (
                    <Link
                      key={link}
                      className="text-muted text-[14px] leading-[1.4] font-medium hover:text-primary transition-colors opacity-100 hover:opacity-80"
                      href="/"
                    >
                      {link}
                    </Link>
                  ),
                )}
              </div>
            </div>
          </footer>
        </main>
      </div>

      {/* Floating AI Chat Bar */}
      <FloatingAskBar />
    </div>
  );
}
