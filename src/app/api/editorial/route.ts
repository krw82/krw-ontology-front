import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { forbiddenError, getAuthUser, handleAuthError } from "@/lib/auth";
import { isEditorialAdmin } from "@/lib/editorial/access";
import { PULSE_EDITORIAL_BUCKET } from "@/lib/editorial/repository";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ASSETS = 8;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const fieldsSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().max(2000).default(""),
  ticker: z.string().trim().toUpperCase().regex(/^[A-Z0-9.]{1,12}$/).optional().or(z.literal("")),
  format: z.enum(["single_image", "carousel", "text"]),
  status: z.enum(["draft", "published"]),
  action_label: z.string().trim().max(80).optional().or(z.literal("")),
  action_href: z.string().trim().max(2000).optional().or(z.literal("")).refine(
    (value) => !value || isSafeEditorialActionHref(value),
    "버튼 링크는 사이트 내부 경로 또는 HTTPS 주소여야 합니다.",
  ),
  publish_at: z.string().trim().optional().or(z.literal("")),
});

function errorResponse(status: number, message: string) {
  return Response.json({ error: { code: "validation_error", message } }, { status });
}

function storageFileName(fileName: string, position: number): string {
  const extension = fileName.toLowerCase().match(/\.(?:jpe?g|png|webp)$/)?.[0] ?? ".png";
  return `${String(position).padStart(2, "0")}-image${extension}`;
}

function slugFor(title: string, id: string): string {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${normalized || "editorial"}-${id.slice(0, 8)}`;
}

function isSafeEditorialActionHref(value: string): boolean {
  try {
    const baseUrl = "https://editorial.invalid";
    const parsed = new URL(value, baseUrl);
    return parsed.origin === baseUrl || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parsePublishAt(value: string, required: boolean): string | null {
  if (!value) {
    if (required) throw new Error("발행 일시를 입력해주세요.");
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("발행 일시 형식이 올바르지 않습니다.");
  return new Date(timestamp).toISOString();
}

export async function POST(request: NextRequest) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));
  if (!isEditorialAdmin(user)) return forbiddenError("편집 권한이 필요합니다.");

  const formData = await request.formData();
  const fields = fieldsSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    ticker: formData.get("ticker"),
    format: formData.get("format"),
    status: formData.get("status"),
    action_label: formData.get("action_label"),
    action_href: formData.get("action_href"),
    publish_at: formData.get("publish_at"),
  });
  if (!fields.success) return errorResponse(400, "입력한 콘텐츠 정보를 다시 확인해주세요.");

  const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length > MAX_ASSETS) return errorResponse(400, `이미지는 최대 ${MAX_ASSETS}장까지 등록할 수 있습니다.`);
  if (fields.data.format === "text" && files.length > 0) return errorResponse(400, "텍스트 형식에는 이미지를 첨부할 수 없습니다.");
  if (fields.data.format === "single_image" && files.length !== 1) return errorResponse(400, "단일 이미지 형식에는 이미지 1장이 필요합니다.");
  if (fields.data.format === "carousel" && files.length < 2) return errorResponse(400, "캐러셀 형식에는 이미지 2장 이상이 필요합니다.");
  for (const file of files) {
    if (!allowedMimeTypes.has(file.type) || file.size > MAX_IMAGE_BYTES) {
      return errorResponse(400, "JPG, PNG, WebP 이미지만 장당 8MB 이하로 등록할 수 있습니다.");
    }
  }

  let publishAt: string | null;
  try {
    publishAt = parsePublishAt(fields.data.publish_at ?? "", fields.data.status === "published");
  } catch (error) {
    return errorResponse(400, error instanceof Error ? error.message : "발행 일시를 확인해주세요.");
  }

  const entryId = randomUUID();
  const admin = getSupabaseAdmin();
  const uploadedPaths: string[] = [];
  try {
    const assetRows = [];
    for (const [position, file] of files.entries()) {
      const storagePath = `editorial/${entryId}/${storageFileName(file.name, position)}`;
      const { error: uploadError } = await admin.storage
        .from(PULSE_EDITORIAL_BUCKET)
        .upload(storagePath, Buffer.from(await file.arrayBuffer()), {
          contentType: file.type,
          cacheControl: "31536000",
          upsert: false,
        });
      if (uploadError) throw uploadError;
      uploadedPaths.push(storagePath);
      const alt = String(formData.get(`alt_${position}`) ?? "").trim();
      assetRows.push({
        entry_id: entryId,
        position,
        storage_path: storagePath,
        alt_text: alt || `${fields.data.title} 이미지 ${position + 1}`,
        mime_type: file.type as "image/jpeg" | "image/png" | "image/webp",
        byte_size: file.size,
      });
    }

    const { error: entryError } = await admin.from("pulse_editorial_entries").insert({
      id: entryId,
      slug: slugFor(fields.data.title, entryId),
      status: fields.data.status,
      format: fields.data.format,
      title: fields.data.title,
      body: fields.data.body,
      ticker: fields.data.ticker || null,
      action_label: fields.data.action_label || null,
      action_href: fields.data.action_href || null,
      publish_at: publishAt,
      created_by: user.id,
    });
    if (entryError) throw entryError;
    if (assetRows.length > 0) {
      const { error: assetsError } = await admin.from("pulse_editorial_assets").insert(assetRows);
      if (assetsError) throw assetsError;
    }
  } catch {
    if (uploadedPaths.length > 0) {
      await admin.storage.from(PULSE_EDITORIAL_BUCKET).remove(uploadedPaths).catch(() => undefined);
    }
    return errorResponse(500, "이미지 콘텐츠를 저장하지 못했습니다. 다시 시도해주세요.");
  }

  return Response.json({ id: entryId }, { status: 201 });
}
