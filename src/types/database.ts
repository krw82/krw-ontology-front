export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// Table row types - used as explicit generic params in supabase queries
export interface ChatSessionRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  title: string;
  claude_session_id: string | null;
  scope_type: "global" | "company";
  default_tickers: string[] | null;
  default_document_types: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow extends Record<string, unknown> {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "pending" | "streaming" | "completed" | "failed";
  created_at: string;
}

export interface AgentRunRow extends Record<string, unknown> {
  id: string;
  session_id: string;
  user_message_id: string;
  assistant_message_id: string | null;
  request_id: string;
  claude_session_id: string | null;
  model: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  lease_expires_at: string | null;
  started_at: string;
  finished_at: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  web_commit: string;
  krw_ontology_commit: string;
  ontology_release_id: string | null;
  index_generated_at: string | null;
  company_count: number | null;
  document_count: number | null;
  error_code: string | null;
  error_message: string | null;
  sdk_diagnostics: Json | null;
}

export interface ToolCallRow extends Record<string, unknown> {
  id: string;
  run_id: string;
  tool_name: string;
  arguments_json: string;
  result_summary: string | null;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
}

export interface CitationRow extends Record<string, unknown> {
  id: string;
  message_id: string;
  run_id: string;
  object_id: string | null;
  ticker: string | null;
  document_type: string | null;
  period: string | null;
  section: string | null;
  quote_text: string | null;
  claim_text: string | null;
  evidence_grade: string | null;
  source_quality: string | null;
  trace_json: Json | null;
}

export interface UsageDailyRow extends Record<string, unknown> {
  user_id: string;
  date: string;
  question_count: number;
  estimated_cost_usd: number;
}

export interface ConcurrencyLeaseRow extends Record<string, unknown> {
  id: string;
  run_id: string;
  acquired_at: string;
  expires_at: string;
  released_at: string | null;
}

// Supabase Database type for createClient generic
export interface Database {
  public: {
    Tables: {
      chat_sessions: {
        Row: ChatSessionRow;
        Insert: Omit<ChatSessionRow, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<ChatSessionRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      messages: {
        Row: MessageRow;
        Insert: Omit<MessageRow, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<MessageRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      agent_runs: {
        Row: AgentRunRow;
        Insert: Pick<
          AgentRunRow,
          | "session_id"
          | "user_message_id"
          | "request_id"
          | "model"
          | "status"
          | "web_commit"
          | "krw_ontology_commit"
        > &
          Partial<
            Omit<
              AgentRunRow,
              | "session_id"
              | "user_message_id"
              | "request_id"
              | "model"
              | "status"
              | "web_commit"
              | "krw_ontology_commit"
            >
          > & {
          id?: string;
          started_at?: string;
        };
        Update: Partial<Omit<AgentRunRow, "id" | "started_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      tool_calls: {
        Row: ToolCallRow;
        Insert: Omit<ToolCallRow, "id"> & { id?: string };
        Update: Partial<Omit<ToolCallRow, "id">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      citations: {
        Row: CitationRow;
        Insert: Omit<CitationRow, "id" | "trace_json"> & {
          id?: string;
          trace_json?: Json | null;
        };
        Update: Partial<Omit<CitationRow, "id">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      usage_daily: {
        Row: UsageDailyRow;
        Insert: Omit<UsageDailyRow, "date"> & { date?: string };
        Update: Partial<UsageDailyRow>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      concurrency_leases: {
        Row: ConcurrencyLeaseRow;
        Insert: Omit<ConcurrencyLeaseRow, "id" | "acquired_at"> & {
          id?: string;
          acquired_at?: string;
        };
        Update: Partial<Omit<ConcurrencyLeaseRow, "id">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      increment_usage_daily: {
        Args: {
          p_user_id: string;
          p_date: string;
          p_cost: number;
        };
        Returns: undefined;
      };
      try_acquire_lease: {
        Args: {
          p_session_id: string;
          p_user_message_id: string;
          p_request_id: string;
          p_model: string;
          p_web_commit: string;
          p_krw_ontology_commit: string;
          p_expires_at: string;
          p_global_limit: number;
        };
        Returns: Array<{ id: string }>;
      };
    };
    Enums: Record<string, string>;
    CompositeTypes: Record<string, never>;
  };
}
