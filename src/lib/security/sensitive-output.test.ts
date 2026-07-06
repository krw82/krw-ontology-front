import { describe, expect, it } from "vitest";
import { redactSensitiveOutput } from "./sensitive-output";

describe("redactSensitiveOutput", () => {
  it("redacts local paths and env file names", () => {
    const result = redactSensitiveOutput(
      "프로젝트는 ~/krw-ontology-front 이고 .env.production을 확인하세요.",
    );

    expect(result.redacted).toBe(true);
    expect(result.content).toContain("[내부 경로 제거됨]");
    expect(result.content).toContain("[내부 설정 파일 제거됨]");
    expect(result.content).not.toContain("~");
    expect(result.content).not.toContain(".env.production");
  });

  it("redacts environment variable assignments and names", () => {
    const result = redactSensitiveOutput(
      "SUPABASE_SERVICE_ROLE_KEY=secret-value and OPENAI_API_KEY are configured.",
    );

    expect(result.redacted).toBe(true);
    expect(result.content).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(result.content).not.toContain("OPENAI_API_KEY");
    expect(result.content).not.toContain("secret-value");
  });

  it("redacts common token and private key shapes", () => {
    const result = redactSensitiveOutput(
      "token sk-abcdefghijklmnopqrstuvwxyz\n-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    );

    expect(result.redacted).toBe(true);
    expect(result.content).toContain("[민감 토큰 제거됨]");
    expect(result.content).toContain("[민감 정보 제거됨]");
    expect(result.content).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(result.content).not.toContain("BEGIN PRIVATE KEY");
  });

  it("leaves ordinary investment text unchanged", () => {
    const text = "AAPL의 서비스 매출과 매출총이익률을 공시 기준으로 정리합니다.";
    expect(redactSensitiveOutput(text)).toEqual({
      content: text,
      redacted: false,
    });
  });
});
