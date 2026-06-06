import type {
  AtomicNewsEventCard,
  ExecutionBudgetStatus,
  SourcePreview,
} from "@/types/api-contracts";
import type { Json } from "@/types/database";

export type NewsPriceMoveDirection = "down" | "up" | "unknown";

export interface NewsDiscoveryIntent {
  originalQuestion: string;
  englishQuestion: string;
  direction: NewsPriceMoveDirection;
  ticker?: string;
  companyName?: string;
  resolvedEntities: Array<Record<string, unknown>>;
  lookbackHours: number;
}

export interface NewsDiscoverySearchResult {
  intent: NewsDiscoveryIntent;
  rawSearchResult: Record<string, unknown>;
  selectedSourcePolicy: {
    allowed_domains: string[];
    excluded_domains: string[];
    market_news_only: true;
  };
}

export interface NewsDiscoveryCardComposition {
  cards: AtomicNewsEventCard[];
  empty_state?: Record<string, unknown>;
  raw_model_output?: unknown;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd: number;
  };
}

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

export interface DirectNewsDiscoveryRunResult {
  ok: true;
  runId: string;
  assistantMessageId: string;
  chatArtifactCount: number;
  estimatedCostUsd: number;
  executionBudget: ExecutionBudgetStatus;
}

export interface FailedDirectNewsDiscoveryRunResult {
  ok: false;
  reason: "active_run_exists" | "duplicate_request" | "internal_error";
  runId?: string;
  assistantMessageId?: string;
  message: string;
}

export type NewsDiscoveryJson = Json;
