import { describe, expect, it } from "vitest";
import { buildMarkitdownChildEnv } from "./markitdown-converter";

describe("markitdown converter sandbox", () => {
  it("does not pass server secrets into the parser subprocess env", () => {
    const env = buildMarkitdownChildEnv({
      PATH: "/usr/bin",
      LANG: "en_US.UTF-8",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      TOSS_PAYMENTS_SECRET_KEY: "toss-secret",
      CLAUDE_API_KEY: "claude-secret",
    });

    expect(env).toMatchObject({
      PATH: "/usr/bin",
      LANG: "en_US.UTF-8",
      PYTHONNOUSERSITE: "1",
    });
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(env.TOSS_PAYMENTS_SECRET_KEY).toBeUndefined();
    expect(env.CLAUDE_API_KEY).toBeUndefined();
  });
});
