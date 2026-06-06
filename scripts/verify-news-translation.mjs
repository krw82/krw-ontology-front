#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

await loadEnvFile(process.argv.slice(2));

const provider = (process.env.NEWS_CARD_TRANSLATION_PROVIDER || "googletrans")
  .trim()
  .toLowerCase();
const disabledProviders = new Set(["off", "none", "0"]);

if (disabledProviders.has(provider)) {
  console.log(`News translation disabled: provider=${provider}`);
  process.exit(0);
}

if (provider !== "googletrans") {
  fail(`Unsupported NEWS_CARD_TRANSLATION_PROVIDER: ${provider}`);
}

const python = process.env.NEWS_TRANSLATION_PYTHON?.trim();
if (!python) {
  fail(
    "NEWS_TRANSLATION_PYTHON is required when NEWS_CARD_TRANSLATION_PROVIDER is enabled",
  );
}

const script =
  process.env.NEWS_TRANSLATION_GOOGLETRANS_SCRIPT?.trim() ||
  path.join(process.cwd(), "scripts", "translate-news-googletrans.py");
const timeoutMs = positiveInt(process.env.NEWS_TRANSLATION_TIMEOUT_MS, 7000);
const payload = JSON.stringify({
  src: "en",
  dest: "ko",
  texts: ["Apple stock fell today."],
});

const startedAt = Date.now();
const result = await runTranslator({ python, script, payload, timeoutMs });
if (!result.ok) fail(result.error);

const translated = result.translations[0]?.trim();
if (!translated || !/[가-힣]/.test(translated)) {
  fail("News translation smoke returned no Korean text");
}

console.log(
  `OK news translation: provider=${provider} python=${python} timeout_ms=${timeoutMs} latency_ms=${Date.now() - startedAt}`,
);

function runTranslator({ python, script, payload, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(python, [script], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, error: "googletrans_timeout" });
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      finish({ ok: false, error: error.message });
    });
    child.on("close", (code) => {
      const parsed = parseOutput(stdout);
      if (code !== 0) {
        finish({
          ok: false,
          error:
            structuredError(parsed) || stderr.trim() || `python_exit_${code}`,
        });
        return;
      }
      if (parsed?.ok === true && Array.isArray(parsed.translations)) {
        finish({
          ok: true,
          translations: parsed.translations.map((value) =>
            typeof value === "string" ? value : "",
          ),
        });
        return;
      }
      finish({
        ok: false,
        error: structuredError(parsed) || "invalid_googletrans_output",
      });
    });

    child.stdin.end(payload);
  });
}

function parseOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function structuredError(parsed) {
  if (!parsed || typeof parsed.error !== "string" || !parsed.error.trim()) {
    return null;
  }
  const message =
    typeof parsed.message === "string" && parsed.message.trim()
      ? parsed.message.trim()
      : null;
  return message ? `${parsed.error.trim()}: ${message}` : parsed.error.trim();
}

function positiveInt(value, fallback) {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function loadEnvFile(argv) {
  const index = argv.indexOf("--env-file");
  if (index === -1) return;
  const envFile = argv[index + 1];
  if (!envFile) fail("Missing value for --env-file");

  const text = await readFile(path.resolve(envFile), "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function fail(message) {
  console.error(`News translation readiness failed: ${message}`);
  process.exit(1);
}
