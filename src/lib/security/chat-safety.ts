import type { Locale } from "@/i18n/config";

export type ChatSafetyBlockReason =
  | "secret_or_env_request"
  | "internal_prompt_request"
  | "local_file_request"
  | "internal_config_request";

export interface ChatSafetyAssessment {
  blocked: boolean;
  reason: ChatSafetyBlockReason | null;
}

const DISCLOSURE_INTENT_PATTERN =
  /\b(?:show|reveal|print|dump|read|open|cat|grep|list|ls|exfiltrate|extract|display)\b|(?:알려|보여|출력|읽어|열어|찾아|공개|노출|덤프|가져와|꺼내|확인해)/i;

const QUESTION_INTENT_PATTERN =
  /[?？]\s*$|(?:뭐|무엇|어디|어떻게|알\s*수|확인\s*가능|있어|있나|있음)/i;

const ENV_OR_SECRET_PATTERN =
  /(?:^|[\s`"'([{])(?:\.env(?:\.[\w-]+)?|env\s+file)\b|(?:api[_\s-]?key|secret[_\s-]?key|client[_\s-]?secret|service[_\s-]?role|private[_\s-]?key|access[_\s-]?token|refresh[_\s-]?token|auth[_\s-]?token|credential)s?\b|(?:환경\s*변수|비밀\s*키|시크릿\s*키|서비스\s*롤|프라이빗\s*키|인증\s*토큰|액세스\s*토큰)/i;

const ENV_NAME_PATTERN =
  /\b(?:SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|ZAI_API_KEY|TOSS_PAYMENTS_SECRET_KEY|STRIPE_SECRET_KEY|GOOGLE_CLIENT_SECRET|[A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PRIVATE_KEY|SERVICE_ROLE_KEY|CLIENT_SECRET|PASSWORD)[A-Z0-9_]*)\b/;

const INTERNAL_PROMPT_PATTERN =
  /(?:system\s*prompt|developer\s*message|hidden\s*instruction|internal\s*instruction|prompt\s*template|jailbreak|ignore\s+(?:all\s+)?previous\s+instructions)|(?:시스템\s*프롬프트|개발자\s*메시지|숨겨진\s*지시|내부\s*지시|프롬프트\s*템플릿|이전\s*지시\s*무시)/i;

const LOCAL_FILE_PATTERN =
  /(?:^|[\s`"'(])\/(?:Users|home|app|srv|opt|var|etc|private|tmp)\/[^\s`"')]+|(?:local\s*file|filesystem|file\s*system|source\s*code|repo\s*file)|(?:로컬\s*파일|파일\s*시스템|소스\s*코드|레포\s*파일|프로젝트\s*파일)/i;

const INTERNAL_CONFIG_PATTERN =
  /(?:mcp\s*(?:config|setting|server|tool)|\.mcp\.json|tool\s*(?:config|list|schema)|deployment\s*(?:script|config)|caddyfile|supabase\s*(?:config|service\s*role))|(?:mcp\s*(?:설정|서버|도구)|도구\s*(?:목록|설정|스키마)|배포\s*(?:스크립트|설정)|내부\s*설정|서비스\s*롤)/i;

export function assessChatPromptSafety(content: string): ChatSafetyAssessment {
  const text = content.trim();
  if (!text) return { blocked: false, reason: null };

  const hasDisclosureIntent = DISCLOSURE_INTENT_PATTERN.test(text);
  const hasRequestIntent =
    hasDisclosureIntent || QUESTION_INTENT_PATTERN.test(text);

  if ((ENV_NAME_PATTERN.test(text) || ENV_OR_SECRET_PATTERN.test(text)) && hasRequestIntent) {
    return { blocked: true, reason: "secret_or_env_request" };
  }

  if (INTERNAL_PROMPT_PATTERN.test(text) && hasRequestIntent) {
    return { blocked: true, reason: "internal_prompt_request" };
  }

  if (LOCAL_FILE_PATTERN.test(text) && hasRequestIntent) {
    return { blocked: true, reason: "local_file_request" };
  }

  if (INTERNAL_CONFIG_PATTERN.test(text) && hasRequestIntent) {
    return { blocked: true, reason: "internal_config_request" };
  }

  return { blocked: false, reason: null };
}

export function blockedChatSafetyMessage(locale: Locale): string {
  if (locale === "en") {
    return [
      "This service only supports filing-grounded company and public-market research.",
      "I can’t provide internal settings, environment variables, system prompts, local file contents, credentials, tokens, or deployment configuration.",
    ].join("\n");
  }

  return [
    "이 서비스는 기업 공시 기반 리서치만 지원합니다.",
    "내부 설정, 환경변수, 시스템 프롬프트, 로컬 파일 내용, 인증 정보, 토큰, 배포 설정은 제공할 수 없습니다.",
  ].join("\n");
}
