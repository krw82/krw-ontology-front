export interface SensitiveOutputRedaction {
  content: string;
  redacted: boolean;
}

const PRIVATE_KEY_BLOCK_PATTERN =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

const ENV_ASSIGNMENT_PATTERN =
  /\b[A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PRIVATE_KEY|SERVICE_ROLE_KEY|CLIENT_SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s\n]+)/g;

const SENSITIVE_ENV_NAME_PATTERN =
  /\b(?:SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|ZAI_API_KEY|TOSS_PAYMENTS_SECRET_KEY|STRIPE_SECRET_KEY|GOOGLE_CLIENT_SECRET|[A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PRIVATE_KEY|SERVICE_ROLE_KEY|CLIENT_SECRET|PASSWORD)[A-Z0-9_]*)\b/g;

const TOKEN_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bghp_[A-Za-z0-9_]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
];

const LOCAL_PATH_PATTERN =
  /(?:^|[\s`"'(])\/(?:Users|home|app|srv|opt|var|etc|private|tmp)\/[^\s`"')\]}]+/g;

const ENV_FILE_PATTERN = /(?:^|[\s`"'([{])\.env(?:\.[\w-]+)?\b/g;

export function redactSensitiveOutput(content: string): SensitiveOutputRedaction {
  let output = content;

  output = output.replace(PRIVATE_KEY_BLOCK_PATTERN, "[민감 정보 제거됨]");
  output = output.replace(ENV_ASSIGNMENT_PATTERN, "[민감 환경변수 제거됨]");
  output = output.replace(SENSITIVE_ENV_NAME_PATTERN, "[민감 환경변수 제거됨]");

  for (const pattern of TOKEN_VALUE_PATTERNS) {
    output = output.replace(pattern, "[민감 토큰 제거됨]");
  }

  output = output.replace(LOCAL_PATH_PATTERN, (match) => {
    const prefix = match.startsWith("/") ? "" : match[0] ?? "";
    return `${prefix}[내부 경로 제거됨]`;
  });
  output = output.replace(ENV_FILE_PATTERN, (match) => {
    const prefix = match.startsWith(".") ? "" : match[0] ?? "";
    return `${prefix}[내부 설정 파일 제거됨]`;
  });

  return {
    content: output,
    redacted: output !== content,
  };
}
