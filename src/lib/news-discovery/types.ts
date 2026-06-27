import type { SourcePreview } from "@/types/api-contracts";

export interface NewsSourceRead extends Record<string, unknown> {
  url: string;
  ok: boolean;
  title?: string;
  text?: string;
  published_at?: string | null;
  error?: string;
  truncated?: boolean;
}

export interface NewsSourcePack {
  version: "news-source-pack/v1";
  selected_event_id: string;
  read_at: string;
  source_urls: string[];
  source_previews: SourcePreview[];
  reads: NewsSourceRead[];
  original_text_for_ontology: string;
  ontology_search_brief_en: string;
  source_read_status: "read" | "partial" | "fallback";
  claims_ko: string[];
}
