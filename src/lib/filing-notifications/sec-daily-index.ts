import { filingUrls, normalizeCik, type SecFilingCandidate } from "@/lib/filing-notifications/sec-edgar";
import type { SecFilingFormType } from "@/types/database";

const TRACKED_FORMS = new Set<SecFilingFormType>(["8-K", "8-K/A", "6-K", "6-K/A", "4", "4/A"]);

export function dailyMasterIndexUrl(date: Date): string {
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `https://www.sec.gov/Archives/edgar/daily-index/${year}/QTR${quarter}/master.${year}${month}${day}.idx`;
}

/** Parse the pipe-delimited body of SEC's daily master index. */
export function parseSecDailyMasterIndex(text: string): SecFilingCandidate[] {
  const candidates: SecFilingCandidate[] = [];
  for (const line of text.split(/\r?\n/)) {
    const columns = line.split("|");
    if (columns.length !== 5) continue;
    const [rawCik, _companyName, rawFormType, filingDate, filename] = columns.map((value) => value.trim());
    const formType = rawFormType as SecFilingFormType;
    const cik = normalizeCik(rawCik);
    if (!cik || !TRACKED_FORMS.has(formType) || !/^\d{4}-\d{2}-\d{2}$/.test(filingDate)) continue;
    const accessionNumber = accessionFromFilename(filename);
    if (!accessionNumber) continue;
    const primaryDocumentName = filename.split("/").at(-1) || null;
    const urls = filingUrls(cik, accessionNumber, primaryDocumentName);
    candidates.push({
      cik,
      accessionNumber,
      formType,
      isAmendment: formType.endsWith("/A"),
      filingDate,
      reportDate: null,
      acceptedAt: null,
      primaryDocumentName,
      filingDetailUrl: urls.filingDetailUrl,
      primaryDocumentUrl: /^edgar\/data\//.test(filename)
        ? `https://www.sec.gov/Archives/${filename.split("/").map(encodeURIComponent).join("/")}`
        : urls.primaryDocumentUrl,
      sourceMetadata: {
        primaryDocDescription: null,
        secItems: [],
      },
    });
  }
  return candidates;
}

function accessionFromFilename(value: string): string | null {
  const directory = value.match(/\/data\/\d+\/(\d{18})\//)?.[1];
  if (!directory) return null;
  return `${directory.slice(0, 10)}-${directory.slice(10, 12)}-${directory.slice(12)}`;
}
