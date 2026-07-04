import "server-only";

import { normalizeCik, parseInformationTableXml } from "@/lib/sec-13f/parser";
import type { Sec13FFilingPackage } from "@/lib/sec-13f/types";

interface SecSubmissionsResponse {
  cik: string;
  name: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      acceptanceDateTime?: string[];
      acceptedDate?: string[];
      form: string[];
      primaryDocument: string[];
    };
  };
}

interface SecDirectoryIndex {
  directory: {
    item: Array<{
      name: string;
      size?: string;
    }>;
  };
}

interface LatestFilingCandidate {
  accessionNumber: string;
  form: "13F-HR" | "13F-HR/A";
  filingDate: string;
  reportPeriod: string;
  acceptedAt: string | null;
  primaryDocument: string | null;
}

const SEC_DATA_ORIGIN = "https://data.sec.gov";
const SEC_ARCHIVES_ORIGIN = "https://www.sec.gov";

function secUserAgent(): string {
  return (
    process.env.SEC_USER_AGENT?.trim() ||
    "KRW Ontology 13F Ingestion ops@krwontology.local"
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "User-Agent": secUserAgent(),
    },
  });

  if (!response.ok) {
    throw new Error(`SEC request failed ${response.status}: ${url}`);
  }

  return (await response.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/xml,text/xml,text/plain,*/*",
      "User-Agent": secUserAgent(),
    },
  });

  if (!response.ok) {
    throw new Error(`SEC request failed ${response.status}: ${url}`);
  }

  return response.text();
}

function accessionDirectory(cik: string, accessionNumber: string): string {
  return `${SEC_ARCHIVES_ORIGIN}/Archives/edgar/data/${Number(cik)}/${accessionNumber.replace(/-/g, "")}`;
}

function fileUrl(baseUrl: string, fileName: string): string {
  return `${baseUrl}/${fileName.split("/").map(encodeURIComponent).join("/")}`;
}

export function findLatest13fFiling(
  submissions: SecSubmissionsResponse,
): LatestFilingCandidate | null {
  const recent = submissions.filings.recent;
  const candidates: LatestFilingCandidate[] = [];

  recent.form.forEach((form, index) => {
    if (form !== "13F-HR" && form !== "13F-HR/A") return;
    const accessionNumber = recent.accessionNumber[index];
    const filingDate = recent.filingDate[index];
    const reportPeriod = recent.reportDate[index];
    if (!accessionNumber || !filingDate || !reportPeriod) return;

    candidates.push({
      accessionNumber,
      form,
      filingDate,
      reportPeriod,
      acceptedAt:
        recent.acceptanceDateTime?.[index] ?? recent.acceptedDate?.[index] ?? null,
      primaryDocument: recent.primaryDocument[index] || null,
    });
  });

  return (
    candidates.sort((a, b) => {
      const reportCompare = b.reportPeriod.localeCompare(a.reportPeriod);
      if (reportCompare !== 0) return reportCompare;
      return b.filingDate.localeCompare(a.filingDate);
    })[0] ?? null
  );
}

function selectInformationTableXml(index: SecDirectoryIndex): string | null {
  const xmlFiles = index.directory.item
    .map((item) => item.name)
    .filter((name) => name.toLowerCase().endsWith(".xml"));

  return (
    xmlFiles.find((name) => !name.toLowerCase().includes("primary_doc")) ??
    xmlFiles.find((name) => !name.toLowerCase().includes("primary")) ??
    null
  );
}

function selectFilingDetailDocument(
  index: SecDirectoryIndex,
  accessionNumber: string,
): string {
  const lowerAccession = accessionNumber.toLowerCase();
  return (
    index.directory.item
      .map((item) => item.name)
      .find((name) => {
        const lowerName = name.toLowerCase();
        return (
          lowerName.startsWith(lowerAccession) &&
          (lowerName.endsWith("-index.html") || lowerName.endsWith("-index.htm"))
        );
      }) ?? `${accessionNumber}-index.html`
  );
}

export async function fetchLatest13fFilingPackage(
  rawCik: string,
): Promise<Sec13FFilingPackage> {
  const cik = normalizeCik(rawCik);
  if (!cik) {
    throw new Error("Invalid CIK");
  }

  const submissions = await fetchJson<SecSubmissionsResponse>(
    `${SEC_DATA_ORIGIN}/submissions/CIK${cik}.json`,
  );
  const latest = findLatest13fFiling(submissions);
  if (!latest) {
    throw new Error(`No 13F-HR filing found for CIK ${cik}`);
  }

  const baseUrl = accessionDirectory(cik, latest.accessionNumber);
  const directoryIndex = await fetchJson<SecDirectoryIndex>(`${baseUrl}/index.json`);
  const informationTableName = selectInformationTableXml(directoryIndex);
  if (!informationTableName) {
    throw new Error(`No 13F information table XML found for ${latest.accessionNumber}`);
  }

  const informationTableUrl = fileUrl(baseUrl, informationTableName);
  const filingDetailName = selectFilingDetailDocument(
    directoryIndex,
    latest.accessionNumber,
  );
  const primaryDocumentUrl = latest.primaryDocument
    ? fileUrl(baseUrl, latest.primaryDocument)
    : null;
  const xml = await fetchText(informationTableUrl);
  const holdings = parseInformationTableXml(xml);
  if (holdings.length === 0) {
    throw new Error(`No holdings parsed for ${latest.accessionNumber}`);
  }

  return {
    cik,
    managerName: submissions.name,
    accessionNumber: latest.accessionNumber,
    form: latest.form,
    filingDate: latest.filingDate,
    reportPeriod: latest.reportPeriod,
    acceptedAt: latest.acceptedAt,
    filingDetailUrl: fileUrl(baseUrl, filingDetailName),
    primaryDocumentUrl,
    informationTableUrl,
    holdings,
  };
}
