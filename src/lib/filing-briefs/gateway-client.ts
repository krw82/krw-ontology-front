import "server-only";

export type FilingBriefGatewayRequest = {
  jobId: string;
  claimToken: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
};

export type FilingBriefGatewayResponse = {
  content: string;
  model: string;
  requestId: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
  };
};

export class FilingBriefGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "FilingBriefGatewayError";
  }
}

export async function requestFilingBrief(
  request: FilingBriefGatewayRequest,
  options: { baseUrl: string; token: string; timeoutMs?: number },
): Promise<FilingBriefGatewayResponse> {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = Math.max(5_000, Math.min(options.timeoutMs ?? 30_000, 60_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/internal/v1/filing-brief`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        job_id: request.jobId,
        claim_token: request.claimToken,
        model: request.model,
        system_prompt: request.systemPrompt,
        user_prompt: request.userPrompt,
        max_tokens: request.maxOutputTokens,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const error = objectValue(payload?.error);
      const message = stringValue(error?.message) ?? `Filing brief gateway failed (${response.status}).`;
      throw new FilingBriefGatewayError(
        stringValue(error?.code) ?? `gateway_${response.status}`,
        message,
        response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
      );
    }
    const content = stringValue(payload?.content);
    if (!content) {
      throw new FilingBriefGatewayError("empty_content", "Filing brief gateway returned no model content.", true);
    }
    const usage = objectValue(payload?.usage);
    return {
      content,
      model: stringValue(payload?.model) ?? request.model,
      requestId: stringValue(payload?.request_id),
      usage: {
        inputTokens: safeInteger(usage?.input_tokens),
        outputTokens: safeInteger(usage?.output_tokens),
        cacheReadInputTokens: safeInteger(usage?.cache_read_input_tokens),
      },
    };
  } catch (error) {
    if (error instanceof FilingBriefGatewayError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new FilingBriefGatewayError("gateway_timeout", "Filing brief gateway timed out.", true);
    }
    throw new FilingBriefGatewayError(
      "gateway_unavailable",
      error instanceof Error ? error.message : "Filing brief gateway is unavailable.",
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
