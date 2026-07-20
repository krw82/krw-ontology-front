import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");
const provisioner = join(repoRoot, "scripts", "provision-production-llm-env.mjs");

describe("production LLM env provisioner", () => {
  it("preserves the runtime and provisions idempotent public gateway settings", () => {
    const root = mkdtempSync(join(tmpdir(), "krw-production-llm-env-"));
    try {
      const runtime = join(root, "runtime.env");
      const source = join(root, "source.env");
      const reference = join(root, "reference.env");
      writeFileSync(
        runtime,
        "KEEP_ME=preserved\nNEXT_PUBLIC_APP_URL=https://old.example.com\nSEC_USER_AGENT=KRW test ops@example.com\n",
      );
      writeFileSync(
        source,
        "NEXT_PUBLIC_APP_URL=https://source.example.com\nKRW_LLM_JOB_TOKEN_SECRET=source-job-token-secret-that-is-longer-than-32-chars\nDEEPSEEK_API_KEY=source-deepseek-key-that-is-long-enough\n",
      );
      writeFileSync(
        reference,
        "NEXT_PUBLIC_APP_URL=https://krwontology.com\nKRW_LLM_JOB_TOKEN_SECRET=reference-job-token-secret-that-is-longer-than-32-chars\nDEEPSEEK_API_KEY=reference-deepseek-key-that-is-long-enough\nINTERNAL_API_KEY=reference-internal-api-key-that-is-long-enough\nFILING_BRIEF_GATEWAY_TOKEN=reference-filing-brief-token-that-is-long-enough\nFILING_BRIEF_BATCH_SIZE=2\nFILING_BRIEF_MAX_JOBS_PER_DAY=100\nFILING_BRIEF_MAX_OUTPUT_TOKENS=900\n",
      );

      const first = runProvisioner(runtime, source, reference);
      expect(first.status, first.stderr).toBe(0);
      expect(first.stdout).not.toContain("reference-job-token-secret");
      expect(first.stdout).not.toContain("reference-deepseek-key");
      const firstValues = parseEnv(readFileSync(runtime, "utf8"));
      expect(firstValues.get("KEEP_ME")).toBe("preserved");
      expect(firstValues.get("KRW_LLM_JOB_TOKEN_SECRET")).toBe(
        "reference-job-token-secret-that-is-longer-than-32-chars",
      );
      expect(firstValues.get("DEEPSEEK_API_KEY")).toBe(
        "reference-deepseek-key-that-is-long-enough",
      );
      expect(firstValues.get("DESKTOP_LLM_GATEWAY_BASE_URL")).toBe(
        "https://krwontology.com/llm/anthropic",
      );
      expect(firstValues.get("ANALYSIS_CREDIT_ENFORCEMENT_MODE")).toBe("enforced");
      expect(firstValues.get("TRUSTED_CLIENT_IP_HEADER")).toBe("x-krw-client-ip");
      expect(firstValues.get("FILING_BRIEF_ENABLED")).toBe("1");
      expect(firstValues.get("FILING_BRIEF_GATEWAY_URL")).toBe(
        "http://llm-gateway:8787",
      );
      expect(firstValues.get("FILING_BRIEF_MODEL")).toBe("deepseek-v4-flash");
      expect(firstValues.get("FILING_BRIEF_BATCH_SIZE")).toBe("2");
      expect(firstValues.get("FILING_BRIEF_MAX_JOBS_PER_DAY")).toBe("100");
      expect(firstValues.get("FILING_BRIEF_MAX_OUTPUT_TOKENS")).toBe("900");
      expect(firstValues.get("INTERNAL_API_KEY")).toBe(
        "reference-internal-api-key-that-is-long-enough",
      );
      expect(firstValues.get("FILING_BRIEF_GATEWAY_TOKEN")).toBe(
        "reference-filing-brief-token-that-is-long-enough",
      );
      expect(statSync(runtime).mode & 0o777).toBe(0o600);

      const second = runProvisioner(runtime, source, reference);
      expect(second.status, second.stderr).toBe(0);
      const secondValues = parseEnv(readFileSync(runtime, "utf8"));
      expect(secondValues.get("INTERNAL_API_KEY")).toBe(
        firstValues.get("INTERNAL_API_KEY"),
      );
      expect(secondValues.get("FILING_BRIEF_GATEWAY_TOKEN")).toBe(
        firstValues.get("FILING_BRIEF_GATEWAY_TOKEN"),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails without a DeepSeek credential and leaves the runtime untouched", () => {
    const root = mkdtempSync(join(tmpdir(), "krw-production-llm-env-missing-"));
    try {
      const runtime = join(root, "runtime.env");
      const source = join(root, "source.env");
      const original = "KEEP_ME=preserved\n";
      writeFileSync(runtime, original);
      writeFileSync(source, "UNRELATED=value\n");

      const result = runProvisioner(runtime, source);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("DEEPSEEK_API_KEY must be configured");
      expect(readFileSync(runtime, "utf8")).toBe(original);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("only consumes a securely named ephemeral reference env", () => {
    const root = mkdtempSync(join(tmpdir(), "krw-live-runtime."));
    try {
      const runtime = join(root, "runtime.env");
      const source = join(root, "source.env");
      const reference = join(root, "gcp-runtime.env");
      writeFileSync(runtime, "NEXT_PUBLIC_APP_URL=https://krwontology.com\n");
      writeFileSync(source, "DEEPSEEK_API_KEY=source-deepseek-key-that-is-long-enough\n");
      writeFileSync(reference, "DEEPSEEK_API_KEY=reference-deepseek-key-that-is-long-enough\n");

      const result = runProvisioner(runtime, source, reference, true);
      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(reference)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function runProvisioner(
  runtime: string,
  source: string,
  reference?: string,
  consumeReference = false,
) {
  return spawnSync(
    process.execPath,
    [
      provisioner,
      "--env-file",
      runtime,
      "--source-env",
      source,
      ...(reference ? ["--reference-env", reference] : []),
      ...(consumeReference ? ["--consume-reference-env"] : []),
      "--enable-filing-briefs",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

function parseEnv(value: string) {
  const result = new Map<string, string>();
  for (const line of value.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    result.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return result;
}
