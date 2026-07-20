import type { Metadata } from "next";
import InstitutionalHoldingsClient from "@/components/institutional-holdings/InstitutionalHoldingsClient";
import {
  getInstitutionalHoldingsDashboard,
  getInstitutionalManagerDirectory,
} from "@/lib/sec-13f/service";
import { normalizeCik } from "@/lib/sec-13f/parser";
import { KNOWN_13F_MANAGERS, type InstitutionalHoldingsDashboard } from "@/lib/sec-13f/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "기관 13F 보유 공시 | KRW.O",
  description: "SEC EDGAR 원본 13F information table 기준 기관 보유 공시를 확인합니다.",
};

type InstitutionalHoldingsPageProps = {
  searchParams: Promise<{ cik?: string | string[] }>;
};

function stringParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function loadPageData(selectedCik: string | null): Promise<{
  managers: InstitutionalHoldingsDashboard["managers"];
  dashboard: InstitutionalHoldingsDashboard | null;
  loadError: string | null;
}> {
  const managers = await getInstitutionalManagerDirectory().catch(
    () => KNOWN_13F_MANAGERS,
  );

  if (!selectedCik) {
    return {
      managers,
      dashboard: null,
      loadError: null,
    };
  }

  try {
    return {
      managers,
      dashboard: await getInstitutionalHoldingsDashboard(selectedCik),
      loadError: null,
    };
  } catch {
    return {
      managers,
      dashboard: null,
      loadError: "13F 보유 데이터를 불러오지 못했습니다.",
    };
  }
}

export default async function InstitutionalHoldingsPage({
  searchParams,
}: InstitutionalHoldingsPageProps) {
  const query = await searchParams;
  const selectedCik = normalizeCik(stringParam(query.cik) ?? "");
  const pageData = await loadPageData(selectedCik);

  return (
    <div className="bg-canvas text-ink">
      <InstitutionalHoldingsClient
        managers={pageData.managers}
        initialDashboard={pageData.dashboard}
        initialLoadError={pageData.loadError}
      />
    </div>
  );
}
