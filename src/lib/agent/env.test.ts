import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildClaudeAgentEnv } from "./env";

describe("buildClaudeAgentEnv", () => {
  it("removes placeholder API keys before launching Claude Code", () => {
    const env = buildClaudeAgentEnv({
      ANTHROPIC_API_KEY: "sk-placeholder",
    }, {});

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe("krw-ontology-front/0.1.0");
  });

  it("keeps explicit non-placeholder API keys", () => {
    const env = buildClaudeAgentEnv({
      ANTHROPIC_API_KEY: "sk-real",
      ANTHROPIC_BASE_URL: "https://example.test",
    }, {});

    expect(env.ANTHROPIC_API_KEY).toBe("sk-real");
    expect(env.ANTHROPIC_BASE_URL).toBe("https://example.test");
  });

  it("imports Claude user settings auth env when app env has no real key", () => {
    const env = buildClaudeAgentEnv(
      {
        ANTHROPIC_API_KEY: "sk-placeholder",
      },
      {
        ANTHROPIC_AUTH_TOKEN: "user-token",
        ANTHROPIC_BASE_URL: "https://api.example.test",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "example-sonnet",
      },
    );

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("user-token");
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.example.test");
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("example-sonnet");
  });

  it("does not import user settings env over explicit app env", () => {
    const env = buildClaudeAgentEnv(
      {
        ANTHROPIC_AUTH_TOKEN: "app-token",
      },
      {
        ANTHROPIC_AUTH_TOKEN: "user-token",
      },
    );

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("app-token");
  });

  it("imports auth env from CLAUDE_CONFIG_DIR settings", () => {
    const configDir = join(
      tmpdir(),
      `krw-claude-config-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "settings.json"),
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "https://api.deepseek.example/anthropic",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-sonnet",
        },
      }),
    );

    const env = buildClaudeAgentEnv({
      ANTHROPIC_API_KEY: "sk-placeholder",
      CLAUDE_CONFIG_DIR: configDir,
    });

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.example/anthropic");
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("deepseek-sonnet");
  });
});
