import { spawn } from "node:child_process";
import { MAX_EXTRACTED_MARKDOWN_CHARS } from "@/lib/document-ingestion/config";

const MARKITDOWN_TIMEOUT_MS = 120_000;

export class MarkitdownConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkitdownConversionError";
  }
}

export async function convertDocumentToMarkdown(
  filePath: string,
): Promise<string> {
  const command = process.env.MARKITDOWN_COMMAND || "markitdown";
  const timeoutMs = Number.parseInt(
    process.env.MARKITDOWN_TIMEOUT_MS || `${MARKITDOWN_TIMEOUT_MS}`,
    10,
  );

  return new Promise((resolve, reject) => {
    const child = spawn(command, [filePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() =>
        reject(new MarkitdownConversionError("문서 변환 시간이 초과되었습니다.")),
      );
    }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : MARKITDOWN_TIMEOUT_MS);
    timeout.unref?.();

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_EXTRACTED_MARKDOWN_CHARS) {
        child.kill("SIGKILL");
        finish(() =>
          reject(
            new MarkitdownConversionError(
              "문서 내용이 너무 깁니다. 더 짧은 문서를 첨부해주세요.",
            ),
          ),
        );
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 8_000) {
        stderr = `${stderr.slice(0, 8_000)}...`;
      }
    });

    child.on("error", (error) => {
      finish(() =>
        reject(
          new MarkitdownConversionError(
            `문서 변환기를 실행하지 못했습니다: ${error.message}`,
          ),
        ),
      );
    });

    child.on("close", (code) => {
      finish(() => {
        const markdown = stdout.trim();
        if (code !== 0) {
          reject(
            new MarkitdownConversionError(
              stderr.trim() || "문서 변환에 실패했습니다.",
            ),
          );
          return;
        }

        if (!markdown) {
          reject(
            new MarkitdownConversionError(
              "문서에서 읽을 수 있는 텍스트를 찾지 못했습니다.",
            ),
          );
          return;
        }

        resolve(markdown);
      });
    });
  });
}
