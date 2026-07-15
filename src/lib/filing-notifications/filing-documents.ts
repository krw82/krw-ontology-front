import "server-only";

import { fetchSecText } from "@/lib/filing-notifications/sec-client";
import { parseFilingIndexDocuments } from "@/lib/filing-notifications/sec-filing-index";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SecFilingDocumentRow, SecFilingEventRow } from "@/types/database";

export type FilingDocumentsResult = {
  documents: SecFilingDocumentRow[];
  status: "ready" | "failed";
};

/**
 * The polling worker deliberately reads only submissions JSON. SEC filing-index
 * metadata is fetched and cached only after a user opens a filing detail page.
 */
export async function loadFilingDocuments(event: SecFilingEventRow): Promise<FilingDocumentsResult> {
  const admin = getSupabaseAdmin();
  const { data: existing, error: existingError } = await admin
    .from("sec_filing_documents")
    .select("*")
    .eq("filing_event_id", event.id)
    .order("recommendation_score", { ascending: false })
    .order("sequence", { ascending: true, nullsFirst: false })
    .returns<SecFilingDocumentRow[]>();
  if (existingError) throw new Error(`Failed to load SEC filing documents: ${existingError.message}`);
  if (existing?.length || event.enrichment_status === "ready") {
    return { documents: existing ?? [], status: "ready" };
  }
  if (event.enrichment_status === "failed") {
    return { documents: [], status: "failed" };
  }

  try {
    const html = await fetchSecText(event.filing_detail_url);
    const candidates = parseFilingIndexDocuments({
      html,
      filingDetailUrl: event.filing_detail_url,
      primaryDocumentName: event.primary_document_name,
    });
    if (!candidates.length) {
      await admin.from("sec_filing_events").update({ enrichment_status: "ready" }).eq("id", event.id);
      return { documents: [], status: "ready" };
    }
    const { data, error } = await admin
      .from("sec_filing_documents")
      .upsert(
        candidates.map((document) => ({
          filing_event_id: event.id,
          sequence: document.sequence,
          document_name: document.documentName,
          document_type: document.documentType,
          description: document.description,
          document_url: document.documentUrl,
          size_bytes: document.sizeBytes,
          is_primary: document.isPrimary,
          recommendation_score: document.recommendationScore,
        })),
        { onConflict: "filing_event_id,document_name" },
      )
      .select("*")
      .returns<SecFilingDocumentRow[]>();
    if (error) throw new Error(`Failed to cache SEC filing documents: ${error.message}`);
    await admin.from("sec_filing_events").update({ enrichment_status: "ready" }).eq("id", event.id);
    return { documents: data ?? [], status: "ready" };
  } catch (error) {
    await admin.from("sec_filing_events").update({ enrichment_status: "failed" }).eq("id", event.id);
    console.warn("[filing-documents] filing index lookup failed", {
      accessionNumber: event.accession_number,
      error: error instanceof Error ? error.message : String(error),
    });
    return { documents: [], status: "failed" };
  }
}
