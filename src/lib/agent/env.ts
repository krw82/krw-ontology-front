import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PLACEHOLDER_API_KEYS = new Set(["sk-placeholder", "sk-ant-..."]);
const DEFAULT_CLAUDE_CONFIG_DIR = join(homedir(), ".claude");

const USER_SETTINGS_ENV_KEY_PREFIXES = ["ANTHROPIC_"];
const USER_SETTINGS_ENV_KEYS = new Set(["API_TIMEOUT_MS"]);
const BLOCKED_USER_SETTINGS_ENV_KEYS = new Set(["ANTHROPIC_LOG"]);

type EnvSource = NodeJS.ProcessEnv;

interface ClaudeSettingsFile {
  env?: Record<string, unknown>;
}

export function buildClaudeAgentEnv(
  baseEnv: EnvSource = process.env,
  userSettingsEnv = readClaudeUserSettingsEnv(baseEnv),
): EnvSource {
  const env: EnvSource = {
    ...baseEnv,
    CLAUDE_AGENT_SDK_CLIENT_APP: "krw-ontology-front/0.1.0",
  };

  removePlaceholderApiKey(env);
  mergeClaudeUserSettingsEnv(env, userSettingsEnv);
  removePlaceholderApiKey(env);

  return env;
}

function mergeClaudeUserSettingsEnv(
  env: EnvSource,
  userSettingsEnv: Record<string, unknown>,
): void {
  if (env.CLAUDE_IMPORT_USER_SETTINGS_ENV === "0") return;

  for (const [key, value] of Object.entries(userSettingsEnv)) {
    if (!isAllowedUserSettingsEnvKey(key)) continue;
    if (hasUsableEnvValue(env[key])) continue;
    const envValue = toEnvString(value);
    if (envValue === null) continue;
    env[key] = envValue;
  }
}

function readClaudeUserSettingsEnv(baseEnv: EnvSource): Record<string, unknown> {
  const settingsPath = join(resolveClaudeConfigDir(baseEnv), "settings.json");
  if (!existsSync(settingsPath)) return {};

  try {
    const settings = JSON.parse(
      readFileSync(settingsPath, "utf8"),
    ) as ClaudeSettingsFile;
    return isRecord(settings.env) ? settings.env : {};
  } catch {
    return {};
  }
}

function resolveClaudeConfigDir(env: EnvSource): string {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim();
  return configDir || DEFAULT_CLAUDE_CONFIG_DIR;
}

function removePlaceholderApiKey(env: EnvSource): void {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey || PLACEHOLDER_API_KEYS.has(apiKey)) {
    delete env.ANTHROPIC_API_KEY;
  }
}

function isAllowedUserSettingsEnvKey(key: string): boolean {
  if (BLOCKED_USER_SETTINGS_ENV_KEYS.has(key)) return false;
  return (
    USER_SETTINGS_ENV_KEYS.has(key) ||
    USER_SETTINGS_ENV_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

function hasUsableEnvValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function toEnvString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
