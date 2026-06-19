import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";

const DEFAULT_STORAGE_ROOT = "/tmp/krw-document-attachments";

export function getDocumentStorageRoot(): string {
  return path.resolve(
    /* turbopackIgnore: true */ process.env.DOCUMENT_STORAGE_ROOT ||
      DEFAULT_STORAGE_ROOT,
  );
}

export function documentAttachmentRelativePath(params: {
  userId: string;
  attachmentId: string;
  fileName: string;
}): string {
  const extension = path.extname(params.fileName).toLowerCase() || ".pdf";
  return path.join(params.userId, params.attachmentId, `original${extension}`);
}

export function resolveDocumentStoragePath(relativePath: string): string {
  const root = getDocumentStorageRoot();
  const resolved = path.resolve(/* turbopackIgnore: true */ root, relativePath);
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  if (resolved !== root && !resolved.startsWith(rootPrefix)) {
    throw new Error("Invalid document storage path");
  }

  return resolved;
}

export async function writeDocumentAttachment(params: {
  relativePath: string;
  content: Buffer;
}): Promise<string> {
  const fullPath = resolveDocumentStoragePath(params.relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, params.content);
  return fullPath;
}

export async function removeDocumentAttachment(
  relativePath: string | null | undefined,
): Promise<void> {
  if (!relativePath) return;
  const fullPath = resolveDocumentStoragePath(relativePath);
  await rm(path.dirname(fullPath), { force: true, recursive: true });
}
